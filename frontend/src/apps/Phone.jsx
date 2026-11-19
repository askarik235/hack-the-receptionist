// The in-game smartphone: keypad, contacts, recent calls and the call screen.
// A dial is checked with the server first (free), then the mic is explained, then the call starts.
import { useEffect, useRef, useState } from "react";
import { getCallStatus, lookupNumber } from "../api.js";
import { startCall } from "../phone/callSession.js";
import { addRecent, digitsOf, nameFor, useContacts, useRecents } from "../phone/contacts.js";
import { CALL_ENDED_EVENT } from "./Training.jsx";

const MIC_OK_KEY = "midas.micExplained";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

// What the phone says when a call can't start or has ended.
const REASONS = {
  invalid_number: "That isn't a phone number. Check the digits and try again.",
  not_in_service: "The number you dialled is not in service.",
  no_answer: "No answer. Nobody at this number will pick up yet.",
  unavailable: "The person you are calling is not available. Please try again later.",
  line_busy: "The line is busy. Try again in a minute.",
  too_many_calls: "Too many calls in a short time. Wait a minute, then dial again.",
  lines_closed: "The office lines are closed for today. This demo has a daily call limit; try again later.",
  not_set_up: "This line isn't set up on the game server. Run npm run setup, then try again.",
  mic_blocked: "Your microphone is blocked. Allow it from the icon in the address bar, then call again.",
  timed_out: "The line went quiet for too long and the call ended.",
  line_down: "The call dropped. Try calling again.",
  hung_up_remote: "They hung up.",
  distrust: "They stopped believing you and hung up. Do more research, then try a different approach.",
  case_check: "They checked your story against their own records, and it didn't match, so they hung up. Check your facts, then try again.",
  silence: "You went quiet for too long and they hung up. Real callers keep the conversation going.",
  time_limit: "Calls are limited to 10 minutes. Dial again to try a new approach.",
  call_failed: "The call didn't go through. Try again.",
  invalid_caller_id: "The caller ID kit doesn't understand that number. Check the digits, or clear it to call from your own number.",
  no_caller_id_kit: "You don't have a caller ID kit yet.",
};
const FRIENDLY_END = new Set(["you_hung_up", "ended", "hung_up_remote"]);

// "045550142" -> "04 555 0142" (landline), "0505550177" -> "050 555 0177" (mobile)
export const formatNumber = (number) => {
  const d = digitsOf(number);
  if (d.length === 9 && d.startsWith("0")) return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
  if (d.length === 10 && d.startsWith("0")) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return number;
};
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function readMicOk() {
  try {
    return localStorage.getItem(MIC_OK_KEY) === "1";
  } catch {
    return false;
  }
}

// callerIdKit: the player has MIDAS's caller ID kit (Level 4 on) and can choose the
// number the other phone shows.
export default function Phone({ callerIdKit = false }) {
  const contacts = useContacts();
  const recents = useRecents();
  const [tab, setTab] = useState("keypad");
  const [typed, setTyped] = useState("");
  const [showAs, setShowAs] = useState("");
  const callerId = callerIdKit ? showAs.trim() : "";
  const [call, setCall] = useState(null); // { phase, number, reason, startedAt, muted, video, speaking, captions }
  const [now, setNow] = useState(Date.now());
  const handle = useRef(null);
  const videoBox = useRef(null);
  const attempt = useRef(0); // bumps on every dial and cancel, so a stale dial can't start a call

  const patch = (changes) => setCall((c) => (c ? { ...c, ...changes } : c));

  // Leaving the phone (closing its window) hangs up.
  useEffect(() => () => handle.current?.hangUp(), []);

  useEffect(() => {
    if (call?.phase !== "live") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [call?.phase]);

  // The trust meter lives on the server; read it while the call is live.
  const callId = call?.callId;
  useEffect(() => {
    if (call?.phase !== "live" || !callId) return;
    let stopped = false;
    async function poll() {
      try {
        const status = await getCallStatus(callId);
        if (stopped) return;
        patch({ trust: status.trust, codeAt: status.codeAt, hangUpAt: status.hangUpAt });
        if (status.status !== "live" && status.status !== "dialing") {
          const reason = ["distrust", "case_check", "silence", "time_limit"].includes(status.closeReason) ? status.closeReason : "hung_up_remote";
          handle.current?.endedByServer(reason);
        }
      } catch {
        /* keep the last value; try again next tick */
      }
    }
    poll();
    const id = setInterval(poll, 1500);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [call?.phase, callId]);

  async function dial(raw) {
    const number = raw.trim();
    if (!number || call) return;
    const mine = ++attempt.current;
    setCall({ phase: "checking", number, callerId, captions: [] });
    try {
      await lookupNumber(number, callerId);
    } catch (err) {
      if (mine === attempt.current) finish(number, err.code ?? "call_failed", 0);
      return;
    }
    if (mine !== attempt.current) return;
    if (readMicOk()) connect(number, callerId);
    else patch({ phase: "mic" });
  }

  async function allowMic(number, shownAs) {
    const mine = attempt.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      try {
        localStorage.setItem(MIC_OK_KEY, "1");
      } catch {
        /* ask again next visit */
      }
      if (mine === attempt.current) connect(number, shownAs);
    } catch {
      if (mine === attempt.current) finish(number, "mic_blocked", 0);
    }
  }

  function cancel() {
    attempt.current++;
    setCall(null);
  }

  function hangUp() {
    if (handle.current) handle.current.hangUp();
    else cancel();
  }

  function connect(number, shownAs) {
    patch({ phase: "calling" });
    let startedAt = null;
    handle.current = startCall({
      number,
      callerId: shownAs,
      container: videoBox.current,
      on: {
        connected: () => {
          startedAt = Date.now();
          setNow(startedAt);
          patch({ phase: "live", startedAt });
        },
        ended: (reason) => {
          handle.current = null;
          finish(number, reason, startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0);
        },
        dialled: (id) => patch({ callId: id }),
        speaking: (speaking) => patch({ speaking }),
        videoReady: () => {},
        idleWarning: () => patch({ idleWarning: true }),
        caption: (line) =>
          setCall((c) => {
            if (!c) return c;
            const lines = [...c.captions];
            const last = lines[lines.length - 1];
            if (last?.partial && last.who === line.who) lines[lines.length - 1] = line;
            else lines.push(line);
            return { ...c, captions: lines.slice(-6), idleWarning: false };
          }),
      },
    });
  }

  function finish(number, reason, seconds) {
    addRecent({ number, seconds, outcome: seconds > 0 ? "answered" : "missed" });
    if (seconds > 0) window.dispatchEvent(new Event(CALL_ENDED_EVENT)); // Training fetches the new debrief
    setCall((c) => ({ ...(c ?? { number, captions: [] }), phase: "ended", reason, seconds, speaking: false }));
  }

  function toggleMute() {
    handle.current?.setMuted(!call.muted);
    patch({ muted: !call.muted });
  }

  function toggleVideo() {
    handle.current?.setVideo(!call.video);
    patch({ video: !call.video });
  }

  const inCall = call && call.phase !== "ended";
  const callerName = call ? nameFor(contacts, call.number) : null;

  return (
    <div className="phone">
      {/* The Napster SDK mounts the caller's video here. Hidden on voice calls. */}
      <div className={`phone-video${inCall && call.video ? " is-on" : ""}`} ref={videoBox} />

      {call ? (
        <div className={`phone-call is-${call.phase}`}>
          {call.phase === "mic" ? (
            <div className="phone-mic">
              <h3>Calls use your microphone</h3>
              <p>
                You talk to the characters out loud. Your browser will ask for the microphone next. Audio goes to the
                game's voice service only for this call.
              </p>
              <p className="phone-mic-note">Everyone you call is fictional. Never share real passwords or personal details.</p>
              <button type="button" className="phone-btn is-primary" onClick={() => allowMic(call.number, call.callerId)}>
                Allow microphone
              </button>
              <button type="button" className="phone-btn" onClick={cancel}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div className="phone-callerid">
                <div className={`phone-avatar${call.speaking ? " is-speaking" : ""}`} aria-hidden="true">
                  {(callerName ?? "?").replace(/^Vitality: /, "").slice(0, 1)}
                </div>
                <h3>{callerName ?? formatNumber(call.number)}</h3>
                {callerName && <p className="phone-number">{formatNumber(call.number)}</p>}
                {call.callerId && call.phase !== "ended" && (
                  <p className="phone-showing">They see: {nameFor(contacts, call.callerId) ?? formatNumber(call.callerId)}</p>
                )}
                <p className="phone-status" aria-live="polite">
                  {call.phase === "checking" && "Dialling…"}
                  {call.phase === "calling" && "Ringing…"}
                  {call.phase === "live" && (call.speaking ? "Talking" : clock(Math.max(0, Math.round((now - call.startedAt) / 1000))))}
                  {call.phase === "ended" &&
                    (FRIENDLY_END.has(call.reason)
                      ? `Call ended${call.seconds ? ` (${clock(call.seconds)})` : ""}`
                      : ["distrust", "case_check", "silence"].includes(call.reason)
                        ? "They hung up"
                        : call.reason === "unavailable"
                          ? "Not available"
                          : "Call failed")}
                </p>
              </div>

              {call.trust !== undefined && (call.phase === "live" || call.reason === "distrust") && (
                <TrustMeter trust={call.trust} codeAt={call.codeAt} hangUpAt={call.hangUpAt} />
              )}

              {call.phase === "ended" && !FRIENDLY_END.has(call.reason) && (
                <p className="phone-reason" role="alert">
                  {REASONS[call.reason] ?? REASONS.call_failed}
                </p>
              )}
              {call.phase === "ended" && call.reason === "hung_up_remote" && <p className="phone-reason">{REASONS.hung_up_remote}</p>}

              {call.phase === "live" && (
                <ol className="phone-captions" aria-label="Live captions" aria-live="polite">
                  {call.idleWarning && <li className="is-system">Say something, or the line will drop.</li>}
                  {call.captions.map((line, i) => (
                    <li key={i} className={`is-${line.who}`}>
                      {line.text}
                    </li>
                  ))}
                </ol>
              )}

              <div className="phone-call-actions">
                {inCall ? (
                  <>
                    <button type="button" className={`phone-round${call.muted ? " is-on" : ""}`} onClick={toggleMute} disabled={call.phase !== "live"} aria-pressed={!!call.muted}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />{call.muted && <path d="M4 4l16 16" />}</svg>
                      <span>{call.muted ? "Unmute" : "Mute"}</span>
                    </button>
                    <button type="button" className="phone-round is-hangup" onClick={hangUp}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14c5-5 13-5 18 0l-2.5 2.5-3.5-1.5v-2.5a10 10 0 0 0-6 0V15l-3.5 1.5z" /></svg>
                      <span>Hang up</span>
                    </button>
                    <button type="button" className={`phone-round${call.video ? " is-on" : ""}`} onClick={toggleVideo} disabled={call.phase !== "live"} aria-pressed={!!call.video}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h12v10H3zM15 11l6-3v8l-6-3" /></svg>
                      <span>Video</span>
                    </button>
                  </>
                ) : (
                  <button type="button" className="phone-btn is-primary" onClick={() => setCall(null)}>
                    Back to keypad
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="phone-panel">
            {tab === "keypad" && (
              <form
                className="phone-keypad"
                onSubmit={(e) => {
                  e.preventDefault();
                  dial(typed);
                }}
              >
                {callerIdKit && (
                  <div className={`phone-spoof${showAs.trim() ? " is-set" : ""}`}>
                    <label htmlFor="phone-show-as">Show as</label>
                    <input
                      id="phone-show-as"
                      inputMode="tel"
                      autoComplete="off"
                      value={showAs}
                      maxLength={20}
                      placeholder="Your own number (hidden)"
                      onChange={(e) => setShowAs(e.target.value.replace(/[^\d+() -]/g, ""))}
                    />
                  </div>
                )}
                <label className="visually-hidden" htmlFor="phone-dial">
                  Number to call
                </label>
                <input
                  id="phone-dial"
                  className="phone-display"
                  inputMode="tel"
                  autoComplete="off"
                  value={typed}
                  maxLength={20}
                  placeholder="Enter a number"
                  onChange={(e) => setTyped(e.target.value.replace(/[^\d+*#() -]/g, ""))}
                />
                <p className="phone-match">{nameFor(contacts, typed) ?? " "}</p>
                <div className="phone-keys">
                  {KEYS.map((k) => (
                    <button key={k} type="button" className="phone-key" onClick={() => setTyped((t) => (t + k).slice(0, 20))}>
                      {k}
                    </button>
                  ))}
                </div>
                <div className="phone-keypad-actions">
                  <span />
                  <button type="submit" className="phone-dial" disabled={!typed.trim()} aria-label="Call">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11 11 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11 11 0 0 0 .6 3.6 1 1 0 0 1-.25 1z" /></svg>
                  </button>
                  <button type="button" className="phone-del" onClick={() => setTyped((t) => t.slice(0, -1))} disabled={!typed} aria-label="Delete last digit">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h11v14H9l-6-7zM12 9l5 6M17 9l-5 6" /></svg>
                  </button>
                </div>
              </form>
            )}

            {tab === "contacts" && (
              <ul className="phone-list">
                {contacts.length === 0 && <li className="phone-empty">No contacts yet. Numbers you find on websites are saved here.</li>}
                {contacts.map((c) => (
                  <li key={c.number}>
                    <button type="button" onClick={() => dial(c.number)}>
                      <strong>{c.name}</strong>
                      <span>{formatNumber(c.number)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {tab === "recents" && (
              <ul className="phone-list">
                {recents.length === 0 && <li className="phone-empty">No calls yet.</li>}
                {recents.map((r) => (
                  <li key={r.at} className={`is-${r.outcome}`}>
                    <button type="button" onClick={() => dial(r.number)}>
                      <strong>{nameFor(contacts, r.number) ?? formatNumber(r.number)}</strong>
                      <span>
                        {r.outcome === "answered" ? clock(r.seconds) : "Not connected"}, 
                        {new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <nav className="phone-tabs" aria-label="Phone">
            {[
              ["keypad", "Keypad"],
              ["contacts", "Contacts"],
              ["recents", "Recents"],
            ].map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? "is-current" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}

// How much the person on the line believes the caller. The code only unlocks above codeAt;
// at hangUpAt or below they hang up.
function TrustMeter({ trust, codeAt, hangUpAt }) {
  const band = trust >= codeAt ? "is-high" : trust <= hangUpAt + 15 ? "is-low" : "";
  return (
    <div className={`trust ${band}`}>
      <div className="trust-head">
        <span>Trust</span>
        <strong>{trust}%</strong>
      </div>
      <div className="trust-track" role="meter" aria-label="How much they trust you" aria-valuemin={0} aria-valuemax={100} aria-valuenow={trust}>
        <div className="trust-fill" style={{ width: `${trust}%` }} />
        <span className="trust-mark is-hangup" style={{ left: `${hangUpAt}%` }} title={`They hang up at ${hangUpAt}%`} />
        <span className="trust-mark is-code" style={{ left: `${codeAt}%` }} title={`They share the code from ${codeAt}%`} />
      </div>
      <p className="trust-hint">
        {trust >= codeAt ? "They believe you. Ask for the code." : trust <= hangUpAt + 15 ? "They're about to hang up." : `Reach ${codeAt}% to get the code.`}
      </p>
    </div>
  );
}
