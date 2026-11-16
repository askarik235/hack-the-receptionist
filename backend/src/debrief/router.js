// The Training app: a debrief for every finished call and the player's technique collection.
// Transcripts are shown with codes blacked out, so no code ever reaches the browser.
import express from "express";
import { codeFor } from "../game/codes.js";
import { trustMoves } from "../game/techniques.js";
import { createRateLimiter } from "../lib/rateLimit.js";
import { isSilenceNote } from "../../../frontend/src/phone/silenceNote.js";

const SHOWN_CALLS = 20;
const BACKFILL_PER_REQUEST = 3;
const CODE_PATTERN = /\b[A-Za-z]{3,10}[\s-]*\d(?:[\s-]*\d){3}\b/g;

// Blacks out anything shaped like a code, plus this player's own code however it was transcribed.
export function redactCodes(text, code) {
  let out = text.replace(CODE_PATTERN, "[code hidden]");
  if (code) {
    const [word, digits] = code.split("-");
    out = out.replace(new RegExp(digits.split("").join("[\\s,.-]*"), "g"), "[code hidden]");
    out = out.replace(new RegExp(`\\b${word}\\b`, "gi"), "[code hidden]");
  }
  return out;
}

export function trainingRouter({ config, db, content, processor = null }) {
  const router = express.Router();
  // Each backfill can ask Napster for up to 3 transcripts; don't let a refresh loop hammer it.
  const allowBackfill = createRateLimiter({ windowMs: 15_000, max: 1 });
  const allowView = createRateLimiter({ windowMs: 60_000, max: 60 });

  const recentCalls = db.prepare(
    `SELECT * FROM calls WHERE player_id = ? AND status IN ('ended', 'failed')
     ORDER BY created_at DESC LIMIT ${SHOWN_CALLS}`
  );
  const unprocessed = db.prepare(
    `SELECT id FROM calls WHERE player_id = ? AND status = 'ended' AND processed_at IS NULL
       AND napster_session_id IS NOT NULL AND ended_at <= ?
     ORDER BY created_at DESC LIMIT ${BACKFILL_PER_REQUEST}`
  );
  const toolLogs = db.prepare("SELECT * FROM tool_calls WHERE call_id = ? ORDER BY id");
  const collection = db.prepare("SELECT technique, first_seen_at, times FROM player_techniques WHERE player_id = ?");

  function outcomeOf(call, logs) {
    if (call.won) return "cleared";
    if (logs.some((t) => t.tool === "request_code" && t.approved)) return "got_code";
    if (call.close_reason === "distrust") return "distrust";
    if (call.close_reason === "case_check") return "case_check";
    if (call.close_reason === "silence") return "silence";
    if (call.status === "failed") return "failed";
    return "ended";
  }

  router.get("/", async (req, res, next) => {
    try {
      const playerId = req.player.id;
      if (!allowView(playerId)) return res.status(429).json({ error: "too_many_requests" });
      // Fallback for calls the webhook didn't cover: analyse a few now.
      if (processor && allowBackfill(playerId)) {
        const ready = unprocessed.all(playerId, Math.floor(Date.now() / 1000) - 3);
        await Promise.all(ready.map((c) => processor.processCall(c.id).catch(() => false)));
      }

      const calls = recentCalls.all(playerId).map((call) => {
        const level = content.levelByNumber.get(call.level);
        const person = content.staffById.get(level.targetId);
        const logs = toolLogs.all(call.id);
        const code = codeFor(config.codeSecret, playerId, call.level, level.code.words);
        const transcript = call.transcript_json ? JSON.parse(call.transcript_json) : null;
        return {
          callId: call.id,
          level: call.level,
          title: level.title,
          target: { name: person.name, role: person.role },
          startedAt: call.created_at,
          durationS: call.ended_at ? Math.max(0, call.ended_at - call.created_at) : null,
          outcome: outcomeOf(call, logs),
          trust: { start: level.trust.start, end: call.trust ?? level.trust.start, codeAt: level.trust.codeAt },
          moves: trustMoves(logs, level),
          techniques: call.techniques_json ? JSON.parse(call.techniques_json) : [],
          analysed: Boolean(call.processed_at),
          // Calls saved before silence notes were filtered still have them; drop them here too.
          transcript:
            transcript
              ?.filter((m) => m.role === "user" || !isSilenceNote(m.text))
              .map((m) => ({ who: m.role === "user" ? "you" : "them", text: redactCodes(m.text, code) })) ?? null,
          lesson: call.won ? { whyItWorked: level.debrief.whyItWorked, defence: level.debrief.defence } : null,
        };
      });

      const collected = new Map(collection.all(playerId).map((row) => [row.technique, row]));
      res.json({
        calls,
        techniques: content.techniques.map((t) => ({
          ...t,
          collected: collected.has(t.id),
          times: collected.get(t.id)?.times ?? 0,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
