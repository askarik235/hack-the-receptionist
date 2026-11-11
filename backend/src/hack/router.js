// The HACK app: the player types the code they talked out of a character.
// The server recomputes this player's code for their current level (codes are never stored),
// compares in constant time, and on a match clears the level, which unlocks the next one.
import express from "express";
import { now } from "../db.js";
import { codeFor, codesMatch, normalizeCode } from "../game/codes.js";
import { createRateLimiter } from "../lib/rateLimit.js";

export function hackRouter({ config, db, content, rateLimit = { windowMs: 60_000, max: 6 } }) {
  const router = express.Router();
  const allowGuess = createRateLimiter(rateLimit);

  const clearedLevels = db.prepare("SELECT level FROM cleared_levels WHERE player_id = ?");
  // The call where the character actually handed over this player's code.
  const winningCall = db.prepare(
    `SELECT c.id FROM calls c
     WHERE c.player_id = ? AND c.level = ?
       AND EXISTS (SELECT 1 FROM tool_calls t WHERE t.call_id = c.id AND t.tool = 'request_code' AND t.approved = 1)
     ORDER BY c.created_at DESC LIMIT 1`
  );
  const insertCleared = db.prepare("INSERT OR IGNORE INTO cleared_levels (player_id, level, cleared_at, winning_call_id) VALUES (?, ?, ?, ?)");
  const markWon = db.prepare("UPDATE calls SET won = 1 WHERE id = ?");

  const clearLevel = db.transaction((playerId, level) => {
    const callId = winningCall.get(playerId, level)?.id ?? null;
    insertCleared.run(playerId, level, now(), callId);
    if (callId) markWon.run(callId);
  });

  // The lowest level this player has unlocked but not cleared yet.
  function openLevel(playerId) {
    const cleared = new Set(clearedLevels.all(playerId).map((r) => r.level));
    return content.levels.find((l) => !cleared.has(l.level) && (l.level === 1 || cleared.has(l.level - 1))) ?? null;
  }

  router.post("/", (req, res) => {
    const playerId = req.player.id;
    if (!allowGuess(playerId)) return res.status(429).json({ error: "too_many_attempts" });
    if (!normalizeCode(req.body?.code)) return res.status(400).json({ error: "invalid_code" });

    const level = openLevel(playerId);
    if (!level) return res.status(409).json({ error: "nothing_to_hack" });

    // A code only works once a character has actually handed it over to this player (an
    // approved request_code on a call).
    // Without that, the code space (8 words x 10,000) could be guessed by a script. The answer
    // is the same "denied" either way, so it doesn't reveal which check failed.
    const handedOver = winningCall.get(playerId, level.level);
    const expected = codeFor(config.codeSecret, playerId, level.level, level.code.words);
    if (!codesMatch(expected, req.body.code) || !handedOver) return res.json({ result: "denied", level: level.level });

    clearLevel(playerId, level.level);
    const next = content.levelByNumber.get(level.level + 1);
    res.json({
      result: "granted",
      level: level.level,
      title: level.title,
      debrief: level.debrief,
      afterHack: level.afterHack ?? null,
      next: next ? { level: next.level, title: next.title } : null,
    });
  });

  return router;
}
