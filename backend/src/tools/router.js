// Endpoints that Napster calls during a phone call (explicit tools). Never called by the browser.
// Every request must carry the shared TOOL_SECRET header and signed call tags, and must belong
// to a call that is still open. Responses are read by the character, so they are plain text.
import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { now } from "../db.js";
import { parseExternalClientId } from "../lib/players.js";
import { verifyCallTags } from "../lib/callTags.js";
import { createRateLimiter } from "../lib/rateLimit.js";
import { codeFor } from "../game/codes.js";
import { nameMatches } from "../game/names.js";
import { TOOL_SECRET_HEADER } from "./constants.js";

const MAX_TEXT = 120;

function secretMatches(given, expected) {
  if (typeof given !== "string") return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const cleanText = (value) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT ? value.trim() : null;

// One check per level type. Each returns true if the claimed details pass the "facts" lock.
const CHECKS = {
  // Level 1: the caller must claim to be the target's manager (lenient spelling).
  manager_name: (level, args) => nameMatches(args.claimed_name, level.requestCode.acceptedNames),
};
export const CHECK_TYPES = Object.keys(CHECKS);

export function toolsRouter({ config, db, content, rateLimit = { windowMs: 60_000, max: 10 } }) {
  const router = express.Router();
  const allowCall = createRateLimiter(rateLimit);
  const allowGlobal = createRateLimiter({ windowMs: rateLimit.windowMs, max: rateLimit.max * 30 });

  const findCall = db.prepare(
    "SELECT id, player_id, level, status FROM calls WHERE id = ? AND player_id = ? AND level = ? AND external_client_id = ?"
  );
  const logToolCall = db.prepare(
    `INSERT INTO tool_calls (call_id, level, tool, claimed_name, arguments_json, approved, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  router.use((req, res, next) => {
    if (!secretMatches(req.get(TOOL_SECRET_HEADER), config.toolSecret)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!allowGlobal("all")) return res.status(429).json({ error: "rate_limited" });
    next();
  });

  // Works out which of our calls this tool request belongs to, from Napster's metadata.
  function resolveCall(body) {
    const metadata = body?.metadata;
    const client = parseExternalClientId(metadata?.external_client_id);
    if (!client) return null;
    const tags = verifyCallTags(config.toolSecret, metadata?.tags, client.playerId);
    if (!tags || tags.level !== client.level) return null;
    const call = findCall.get(tags.callId, client.playerId, tags.level, metadata.external_client_id);
    if (!call || !["dialing", "live"].includes(call.status)) return null;
    return call;
  }

  router.post("/request_code", (req, res) => {
    const call = resolveCall(req.body);
    if (!call) return res.status(403).json({ error: "unknown_call" });
    if (!allowCall(call.id)) {
      return res.status(429).json({ result: "unavailable", message: "The system is busy. Try again in a minute." });
    }

    const level = content.levelByNumber.get(call.level);
    const args = req.body.arguments ?? {};
    const claimedName = cleanText(args.claimed_name);
    if (!level || !claimedName) {
      return res.status(400).json({ result: "invalid", message: "The system needs the name of the person asking." });
    }

    const approved = CHECKS[level.requestCode.check](level, { ...args, claimed_name: claimedName });
    const storedArgs = JSON.stringify({ claimed_name: claimedName, reason: cleanText(args.reason) });
    logToolCall.run(call.id, call.level, "request_code", claimedName, storedArgs, approved ? 1 : 0, now());

    if (!approved) return res.json({ result: "refused", message: level.requestCode.refusal });
    const code = codeFor(config.codeSecret, call.player_id, call.level, level.code.words);
    res.json({ result: "approved", message: level.requestCode.approvedTemplate.replace("{code}", code) });
  });

  return router;
}
