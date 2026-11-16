// Level codes (decision D4): derived per player and level from CODE_SECRET, never stored or
// written anywhere. The HACK app recomputes the same code to check what the player typed.
import { createHmac } from "node:crypto";
import { safeEqual } from "../lib/safeEqual.js";

export function codeFor(secret, playerId, level, words) {
  const mac = createHmac("sha256", secret).update(`code:v1:${playerId}:${level}`).digest();
  const word = words[mac.readUInt32BE(0) % words.length];
  const digits = String(mac.readUInt32BE(4) % 10000).padStart(4, "0");
  return `${word}-${digits}`;
}

// Accepts what a player might type: "kanaad-4471", "KANAAD 4471", "Kanaad4471".
// Returns "KANAAD-4471", or null if it can't be a code.
export function normalizeCode(input) {
  if (typeof input !== "string" || input.length > 40) return null;
  const match = input.trim().toUpperCase().match(/^([A-Z]{3,10})[\s_-]*(\d{4})$/);
  return match ? `${match[1]}-${match[2]}` : null;
}

// Constant-time comparison of a typed code with the expected one.
export function codesMatch(expected, typed) {
  const normalized = normalizeCode(typed);
  return Boolean(normalized) && safeEqual(normalized, expected);
}

// For pages a level's code opens (VitalNet Mail, VitalNet Files): true only if this player has
// cleared that level and typed their own code for it.
export function createLevelCodeCheck({ db, config, content }) {
  const hasCleared = db.prepare("SELECT 1 FROM cleared_levels WHERE player_id = ? AND level = ?");
  return (playerId, levelNumber, typed) => {
    const level = content.levelByNumber.get(levelNumber);
    if (!level || !hasCleared.get(playerId, levelNumber)) return false;
    return codesMatch(codeFor(config.codeSecret, playerId, levelNumber, level.code.words), typed);
  };
}
