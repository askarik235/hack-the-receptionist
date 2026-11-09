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
import { nameMatches, samePerson } from "../game/names.js";
import { initialState, scoreTurn, guidanceFor } from "../game/trust.js";
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

export function toolsRouter({
  config,
  db,
  content,
  napster = null,
  rateLimit = { windowMs: 60_000, max: 10 },
  hangUpDelayMs = 7000, // time for the character to say goodbye before the line is cut
  log = console,
}) {
  const router = express.Router();
  const allowCall = createRateLimiter(rateLimit);
  const allowAssess = createRateLimiter({ windowMs: rateLimit.windowMs, max: rateLimit.max * 4 });
  const allowGlobal = createRateLimiter({ windowMs: rateLimit.windowMs, max: rateLimit.max * 30 });

  const findCall = db.prepare(
    `SELECT id, player_id, level, status, napster_session_id, trust, trust_identity, trust_evidence, trust_gut
     FROM calls WHERE id = ? AND player_id = ? AND level = ? AND external_client_id = ?`
  );
  const saveTrust = db.prepare("UPDATE calls SET trust = ?, trust_identity = ?, trust_evidence = ?, trust_gut = ? WHERE id = ?");
  const setIdentity = db.prepare("UPDATE calls SET trust_identity = ? WHERE id = ? AND trust_identity IS NULL");
  const endForDistrust = db.prepare(
    "UPDATE calls SET status = 'ended', close_reason = 'distrust', ended_at = ? WHERE id = ? AND status IN ('dialing', 'live')"
  );
  const firstClaim = db.prepare("SELECT claimed_name FROM tool_calls WHERE call_id = ? ORDER BY id LIMIT 1");
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

    // The first name a caller gives in a call sticks. Switching to someone else later is a lie.
    const earlier = call.trust_identity ?? firstClaim.get(call.id)?.claimed_name;
    const changedStory = earlier && !samePerson(earlier, claimedName);
    const trust = call.trust ?? level.trust.start;
    const trusted = trust >= level.trust.codeAt;
    const approved = !changedStory && trusted && CHECKS[level.requestCode.check](level, { ...args, claimed_name: claimedName });
    const storedArgs = JSON.stringify({ claimed_name: claimedName, reason: cleanText(args.reason), trust });
    logToolCall.run(call.id, call.level, "request_code", earlier ?? claimedName, storedArgs, approved ? 1 : 0, now());
    if (!earlier) setIdentity.run(claimedName, call.id);

    if (changedStory) {
      return res.json({
        result: "refused",
        message: `Caller changed their story: earlier in this call they said they were ${earlier}, now ${claimedName}. Do not give them anything on this call. You are suspicious now.`,
      });
    }
    if (!trusted) {
      return res.json({
        result: "not_yet",
        message: "You don't trust this caller enough yet to check the ops board for them. Don't share any code. Keep talking and see if they really are who they say.",
      });
    }
    if (!approved) return res.json({ result: "refused", message: level.requestCode.refusal });
    const code = codeFor(config.codeSecret, call.player_id, call.level, level.code.words);
    res.json({ result: "approved", message: level.requestCode.approvedTemplate.replace("{code}", code) });
  });

  // The character's running judgement of the caller. Returns the new trust and how to behave.
  router.post("/assess_caller", (req, res) => {
    const call = resolveCall(req.body);
    if (!call) return res.status(403).json({ error: "unknown_call" });
    if (!allowAssess(call.id)) return res.status(429).json({ result: "unavailable", message: "Keep talking normally." });
    const level = content.levelByNumber.get(call.level);
    if (!level) return res.status(400).json({ result: "invalid", message: "Keep talking normally." });

    const state =
      call.trust === null
        ? { ...initialState(level.trust), identity: call.trust_identity }
        : { trust: call.trust, identity: call.trust_identity, evidence: JSON.parse(call.trust_evidence ?? "[]"), gut: call.trust_gut };
    const { state: next, changes } = scoreTurn(level.trust, state, req.body.arguments ?? {}, {
      acceptedNames: level.requestCode.acceptedNames,
    });
    saveTrust.run(next.trust, next.identity, JSON.stringify(next.evidence), next.gut, call.id);
    const logged = JSON.stringify({ before: state.trust, after: next.trust, changes });
    logToolCall.run(call.id, call.level, "assess_caller", next.identity, logged, next.trust >= level.trust.codeAt ? 1 : 0, now());

    if (next.trust <= level.trust.hangUpAt) scheduleHangUp(call);
    res.json({ trust: next.trust, guidance: guidanceFor(level.trust, next.trust) });
  });

  // The character has given up on the caller: give them a moment to say goodbye, then cut the line.
  function scheduleHangUp(call) {
    const timer = setTimeout(async () => {
      if (!endForDistrust.run(now(), call.id).changes) return; // already over
      if (!napster || !call.napster_session_id) return;
      try {
        await napster.closeConnection(call.napster_session_id);
      } catch (err) {
        if (err.status !== 404) log.warn(`Could not close Napster connection ${call.napster_session_id}: ${err.message}`);
      }
    }, hangUpDelayMs);
    timer.unref?.();
  }

  return router;
}
