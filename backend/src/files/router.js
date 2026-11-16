// VitalNet Files: the company's document store. A locked folder (Level 5: Sandgrouse) opens with
// the code the CEO read out. Same rule as VitalNet Mail: the documents are only sent to a player
// who has cleared that level and types their own code, so they can't be read from the frontend.
import express from "express";
import { createLevelCodeCheck } from "../game/codes.js";
import { createRateLimiter } from "../lib/rateLimit.js";

const MAX_INPUT = 40;

export function filesRouter({ config, db, content, rateLimit = { windowMs: 60_000, max: 6 } }) {
  const router = express.Router();
  const allowOpen = createRateLimiter(rateLimit);
  const ownCode = createLevelCodeCheck({ db, config, content });

  router.post("/open", (req, res) => {
    const playerId = req.player.id;
    if (!allowOpen(playerId)) return res.status(429).json({ error: "too_many_attempts" });

    const folder = typeof req.body?.folder === "string" && req.body.folder.length <= MAX_INPUT ? req.body.folder.trim().toLowerCase() : null;
    const code = req.body?.code;
    if (!folder || typeof code !== "string" || !code.trim() || code.length > MAX_INPUT) {
      return res.status(400).json({ error: "invalid_request" });
    }

    // Every failure gets the same answer, so it doesn't reveal which part was wrong.
    const wrong = () => res.status(401).json({ error: "wrong_code" });
    const entry = [...content.vaults.entries()].find(([, vault]) => vault.folder === folder);
    if (!entry) return wrong();
    const [levelNumber, vault] = entry;
    if (!ownCode(playerId, levelNumber, code)) return wrong();

    res.json({ folder: vault.folder, title: vault.title, documents: vault.documents });
  });

  return router;
}
