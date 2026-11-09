// After a call: fetch the transcript and cost from Napster, work out which techniques the player
// used, and add them to the player's collection. Called from the session.closed webhook, and
// as a fallback by the Training app for calls the webhook hasn't covered (e.g. no webhook in dev).
import { now } from "../db.js";
import { detectTechniques } from "../game/techniques.js";

const MAX_ITEMS = 400;
const MAX_TEXT = 2000;

export function createCallProcessor({ db, content, napster, log = console }) {
  const findCall = db.prepare("SELECT * FROM calls WHERE id = ?");
  const findBySession = db.prepare("SELECT id FROM calls WHERE napster_session_id = ?");
  const toolLogs = db.prepare("SELECT * FROM tool_calls WHERE call_id = ? ORDER BY id");
  const save = db.prepare("UPDATE calls SET transcript_json = ?, cost = ?, techniques_json = ?, processed_at = ? WHERE id = ?");
  // A call the browser never hung up (tab closed, crash) is over once Napster says so.
  const closeIfOpen = db.prepare(
    "UPDATE calls SET status = 'ended', close_reason = ?, ended_at = ? WHERE id = ? AND status IN ('dialing', 'live')"
  );
  const collect = db.prepare(
    `INSERT INTO player_techniques (player_id, technique, first_call_id, first_seen_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (player_id, technique) DO UPDATE SET times = times + 1`
  );

  const store = db.transaction((call, transcript, cost, techniques) => {
    save.run(JSON.stringify(transcript), cost, JSON.stringify(techniques), now(), call.id);
    for (const id of techniques) collect.run(call.player_id, id, call.id, now());
  });

  // Returns true once the call has been analysed (now or earlier).
  async function processCall(callId, { closeReason = null } = {}) {
    const call = findCall.get(callId);
    if (!call) return false;
    if (call.processed_at) return true;
    const level = content.levelByNumber.get(call.level);
    if (!level) return false;

    let transcript = [];
    let cost = null;
    if (call.napster_session_id) {
      let session;
      try {
        session = await napster.getSession(call.napster_session_id);
      } catch (err) {
        log.warn(`Could not fetch Napster session ${call.napster_session_id}: ${err.message}`);
        return false;
      }
      if (session.status !== "closed" && session.status !== "failed") return false; // still running; try later
      transcript = (session.conversation?.items ?? []).slice(0, MAX_ITEMS).map((item) => ({
        // The docs say "user"/"agent"; real sessions send "User"/"Assistant". Accept both.
        role: String(item.role ?? "").toLowerCase() === "user" ? "user" : "agent",
        text: String(item.text ?? "").slice(0, MAX_TEXT),
        at: item.timestamp ?? null,
      }));
      cost = typeof session.cost === "number" ? session.cost : null;
      closeIfOpen.run(closeReason ?? session.closeReason ?? "closed", session.closedAt ?? now(), call.id);
    }

    const techniques = detectTechniques({ level, toolLogs: toolLogs.all(call.id), transcript });
    store(call, transcript, cost, techniques);
    return true;
  }

  // For the webhook: which of our calls a Napster session belongs to.
  const callForSession = (sessionId) => findBySession.get(sessionId)?.id ?? null;

  return { processCall, callForSession };
}
