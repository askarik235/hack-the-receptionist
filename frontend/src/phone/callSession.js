// One phone call through the Napster Web SDK (2.x config shape; see napster-findings.md §13).
// Our backend creates the session inside getToken, so the SDK only ever sees a fresh token.
// Voice calls hide the avatar; video calls show it in the same session.
import Napster from "@touchcastllc/napster-companion-api";
import "@touchcastllc/napster-companion-api/styles";
import { dialCall, hangUpCall, reportSilence } from "../api.js";
import { createSilenceWatch } from "./silenceWatch.js";

// The hidden note sent when the caller goes quiet. Napster echoes it back as if the character
// said it, so captions skip it (the backend drops it from transcripts: debrief/silenceNote.js).
const SILENCE_NOTE_START = "The caller has gone silent.";
const isSilenceNote = (text) => text.trimStart().startsWith(SILENCE_NOTE_START);

// Server events that mean the call is over, and what the phone shows for them.
const SHUTDOWN = {
  session_expired: "timed_out",
  no_credits_left: "line_down",
  provider_connection_aborted: "line_down",
  reaching_rate_limits: "line_down",
};

// Returns the call controls straight away, so the player can hang up while it is still ringing.
export function startCall({ number, callerId = "", container, on }) {
  let callId = null;
  let instance = null;
  let ended = false;
  let connected = false;
  let videoOn = false;
  let pendingText = "";
  let silenceConfig = null;
  let silence = null; // the silence watcher, once the call is live
  let goodbye = null; // set when the character hangs up on a silent caller
  let forcedReason = null; // why the call is ending, if we already know better than the SDK

  function end(reason) {
    if (ended) return;
    ended = true;
    silence?.stop();
    clearTimeout(goodbye?.timer);
    try {
      instance?.destroy();
    } catch {
      /* already torn down */
    }
    window.removeEventListener("pagehide", onPageHide);
    if (callId) hangUpCall(callId).catch(() => {});
    on.ended(forcedReason ?? reason);
  }
  const onPageHide = () => end("you_hung_up");
  window.addEventListener("pagehide", onPageHide);

  // Keeps the avatar hidden on voice calls, even when the SDK re-shows it as video arrives.
  const applyVideo = () => (videoOn ? instance?.showAvatar() : instance?.hideAvatar());

  async function getToken() {
    if (callId) throw Object.assign(new Error("one session per call"), { code: "call_failed" });
    const { callId: id, token, silence: lines } = await dialCall(number, callerId);
    callId = id;
    silenceConfig = lines ?? null;
    on.dialled?.(id);
    if (ended) {
      hangUpCall(id).catch(() => {}); // the player hung up while we were dialling
      throw Object.assign(new Error("cancelled"), { code: "you_hung_up" });
    }
    return token;
  }

  function onData(message) {
    const { event, data } = message ?? {};
    if (event === "avatar_state_changed" && data?.state === "ready") {
      applyVideo();
      if (data.details?.mode === "audio_video") on.videoReady();
      return;
    }
    if (event === "talk_state_changed") {
      const talking = data?.state === "started" || data?.state === "preparing" || data?.state === "in_progress";
      silence?.agentSpeaking(talking);
      if (goodbye && data?.state === "started") goodbye.started = true;
      if (goodbye?.started && (data?.state === "ended" || data?.state === "canceled")) finishGoodbye();
      return on.speaking(data?.state === "started");
    }
    if (event === "avatar_connection_warning") return on.idleWarning();
    if (event === "message_received") {
      const m = data?.message;
      if (!m?.role) return;
      const role = m.role.toLowerCase();
      if (role === "system") return; // our own hidden notes, never part of the conversation
      const who = role === "user" ? "you" : "them";
      if (who === "you" && m.action === "speech_started") silence?.userSpeaking(true);
      if (who === "you" && (m.action === "speech_stopped" || m.action === "completed")) silence?.userSpeaking(false);
      // Their words stream in as pieces; show the line as it grows.
      if (who === "them" && m.action === "delta" && m.content) {
        pendingText += m.content;
        if (!isSilenceNote(pendingText)) on.caption({ who, text: pendingText, partial: true });
      } else if (m.action === "completed" && m.content) {
        if (who === "them") pendingText = "";
        if (!isSilenceNote(m.content)) on.caption({ who, text: m.content, partial: false });
      }
      return;
    }
    if (SHUTDOWN[event]) end(SHUTDOWN[event]);
  }

  // A hidden note to the character; they say the line in their own voice.
  function say(line) {
    try {
      instance?.sendCommand({
        type: "send_message",
        data: {
          role: "system",
          text: `${SILENCE_NOTE_START} Say exactly this line in your own voice, and nothing else: "${line}"`,
          trigger_response: true,
        },
      });
    } catch {
      /* the call is closing */
    }
  }

  function startSilenceWatch() {
    if (!silenceConfig || silence) return;
    silence = createSilenceWatch({
      config: silenceConfig,
      say,
      uneasy: () => reportSilence(callId, "uneasy").catch(() => {}),
      hangUp: () => {
        // Let the goodbye be heard, then cut the line (or after 8 s if it never plays).
        goodbye = { started: false, timer: setTimeout(finishGoodbye, 8000) };
      },
    });
  }

  async function finishGoodbye() {
    if (ended) return;
    clearTimeout(goodbye?.timer);
    forcedReason = "silence";
    await reportSilence(callId, "hangup").catch(() => {});
    end("silence");
  }

  (async () => {
    try {
      instance = await Napster.init(getToken, {
        layout: { type: "inline", mountContainer: container },
        style: { view: "rectangle", accentColor: "#f2a541" },
        features: {
          controls: { enabled: false }, // our own phone buttons
          loadingIndicator: { enabled: false }, // our own "calling..." screen
          inactiveTimeout: { enabled: false }, // Napster's 3-minute idle close still applies
          disclaimer: { enabled: false }, // the game shows its own training notice
          pictureInPicture: { enabled: false },
          screenShare: { enabled: false },
        },
        onSessionStatusChange: (status) => {
          if (status === "permissionBlocked" || status === "permissionDismissed") return end("mic_blocked");
          if ((status === "readyAudio" || status === "readyVideo") && !connected) {
            connected = true;
            applyVideo();
            startSilenceWatch();
            on.connected();
          } else if (status === "entry" && connected) {
            end("hung_up_remote"); // the session closed on Napster's side
          }
        },
        onError: (err) => end(err?.code ?? "call_failed"),
        onDestroy: () => end("ended"),
        onData,
      });
      if (ended) instance.destroy();
    } catch (err) {
      end(err?.code ?? "call_failed");
    }
  })();

  return {
    hangUp: () => end("you_hung_up"),
    endedByServer: (reason) => end(reason), // e.g. the character stopped trusting the caller
    setMuted: (muted) => (muted ? instance?.muteMic() : instance?.unmuteMic()),
    setVideo: (on) => {
      videoOn = on;
      applyVideo();
    },
  };
}
