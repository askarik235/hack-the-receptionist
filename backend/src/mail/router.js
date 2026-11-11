// VitalNet Mail: the in-game webmail. A level's code (Level 3: the temporary password Erik
// reads out) also opens an inbox. The inbox is only sent to a player who has cleared that
// level and logs in with their own code, so it can't be read from the frontend or guessed.
import express from "express";
import { codeFor, codesMatch } from "../game/codes.js";
import { createRateLimiter } from "../lib/rateLimit.js";

const MAX_INPUT = 80;

// "Nadia.Rahman@vitality-logistics.ae" or " nadia.rahman " -> "nadia.rahman"
export function normalizeUsername(value) {
  if (typeof value !== "string" || value.length > MAX_INPUT) return null;
  const name = value.trim().toLowerCase().split("@")[0];
  return /^[a-z]+\.[a-z]+$/.test(name) ? name : null;
}

export function mailRouter({ config, db, content, rateLimit = { windowMs: 60_000, max: 6 } }) {
  const router = express.Router();
  const allowLogin = createRateLimiter(rateLimit);
  const hasCleared = db.prepare("SELECT 1 FROM cleared_levels WHERE player_id = ? AND level = ?");

  router.post("/login", (req, res) => {
    const playerId = req.player.id;
    if (!allowLogin(playerId)) return res.status(429).json({ error: "too_many_attempts" });

    const username = normalizeUsername(req.body?.username);
    const password = req.body?.password;
    if (!username || typeof password !== "string" || !password.trim() || password.length > MAX_INPUT) {
      return res.status(400).json({ error: "invalid_login" });
    }

    // Every failure gets the same answer, so it doesn't reveal which part was wrong.
    const wrong = () => res.status(401).json({ error: "wrong_login" });
    const entry = [...content.mailboxes.entries()].find(([, box]) => box.username === username);
    if (!entry) return wrong();
    const [levelNumber, box] = entry;
    const level = content.levelByNumber.get(levelNumber);
    if (!hasCleared.get(playerId, levelNumber)) return wrong();
    if (!codesMatch(codeFor(config.codeSecret, playerId, levelNumber, level.code.words), password)) return wrong();

    res.json({ address: box.address, displayName: box.displayName, emails: box.emails });
  });

  return router;
}
