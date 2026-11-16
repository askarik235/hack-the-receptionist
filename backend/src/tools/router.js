// Endpoints that Napster calls during a phone call (explicit tools). Never called by the browser.
// Every request must carry the shared TOOL_SECRET header and signed call tags, and must belong
// to a call that is still open. Responses are read by the character, so they are plain text.
import express from "express";
import { now } from "../db.js";
import { safeEqual } from "../lib/safeEqual.js";
import { parseExternalClientId } from "../lib/players.js";
import { verifyCallTags } from "../lib/callTags.js";
import { createRateLimiter } from "../lib/rateLimit.js";
import { codeFor } from "../game/codes.js";
import { samePerson, safeName } from "../game/names.js";
import { CHECKS, identityNames, referenceMatches } from "../game/levelRules.js";
import { createWordTravels } from "../game/wordTravels.js";
import { initialState, scoreTurn, guidanceFor, isBurned, REFERENCE_KEY } from "../game/trust.js";
import { TOOL_SECRET_HEADER } from "./constants.js";

const MAX_TEXT = 120;
const MAX_PAYEE = 200;

const cleanText = (value) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT ? value.trim() : null;

const DEFAULT_NOT_YET = "You don't trust this caller enough yet to look this up for them. Don't share any code. Keep talking and see if they really are who they say.";
const REFERENCE_RIGHT_NOTE = " The transfer reference they read out matches the bank's record of Saturday's payment. It's right: never question it or ask for it again.";
const REFERENCE_WRONG_NOTE = " The transfer reference they read out does not match the bank's record of Saturday's payment. Tell them flatly it isn't the one on your report, without giving any part of it, and let them check their file and read it once more.";
const KNOWN_TRICK_NOTE = " This caller's name matches this week's security notice. You know this trick and you can let them know, politely. Don't make up details about the notice. Stay on the line unless you're told to hang up.";
const CALL_OVER = "The call is over: say one short goodbye in your own words and stop talking.";
const TOO_MANY_REFUSALS ="You've already had failed lookups for this caller on this call. Don't look anything else up. Don't share any code. You don't believe them.";

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
    `SELECT id, player_id, level, status, napster_session_id, trust, trust_identity, trust_evidence, trust_gut, caller_id
     FROM calls WHERE id = ? AND player_id = ? AND level = ? AND external_client_id = ?`
  );
  const saveTrust = db.prepare("UPDATE calls SET trust = ?, trust_identity = ?, trust_evidence = ?, trust_gut = ? WHERE id = ?");
  const setIdentity = db.prepare("UPDATE calls SET trust_identity = ? WHERE id = ? AND trust_identity IS NULL");
  const endCall = db.prepare(
    "UPDATE calls SET status = 'ended', close_reason = ?, ended_at = ? WHERE id = ? AND status IN ('dialing', 'live')"
  );
  const firstClaim = db.prepare("SELECT claimed_name FROM tool_calls WHERE call_id = ? AND claimed_name IS NOT NULL ORDER BY id LIMIT 1");
  const refusalsSoFar = db.prepare(
    "SELECT COUNT(*) AS n FROM tool_calls WHERE call_id = ? AND tool = 'request_code' AND json_extract(arguments_json, '$.result') = 'refused'"
  );
  const wordTravels = createWordTravels(db);
  const logToolCall = db.prepare(
    `INSERT INTO tool_calls (call_id, level, tool, claimed_name, arguments_json, approved, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  router.use((req, res, next) => {
    if (!safeEqual(req.get(TOOL_SECRET_HEADER), config.toolSecret)) {
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

    const rc = level.requestCode;
    const reason = cleanText(args.reason);
    const employeeId = cleanText(args.employee_id);
    const department = cleanText(args.department);
    const approvalWord = cleanText(args.approval_word);
    // A spoken wallet address can be long; keep the start of it rather than treating it as missing.
    const payee = typeof args.payee === "string" && args.payee.trim() ? args.payee.trim().slice(0, MAX_PAYEE) : null;
    const transferReference = cleanText(args.transfer_reference);
    // The first name a caller gives in a call sticks. Switching to someone else later is a lie.
    const earlier = call.trust_identity ?? firstClaim.get(call.id)?.claimed_name;
    let trust = call.trust ?? level.trust.start;

    // Checks in order; the first one that fails decides the answer.
    let outcome;
    let check = null;
    const runCheck = () => {
      const facts = {
        claimed_name: claimedName,
        reason,
        employee_id: employeeId,
        department,
        approval_word: approvalWord,
        payee,
        transfer_reference: transferReference,
        expected_reference: expectedReference(call, rc),
        caller_id: call.caller_id,
      };
      return CHECKS[rc.check](rc, facts, content);
    };
    const burned = wordTravels.burnedNames(call.player_id, call.level).find((name) => samePerson(name, claimedName));
    if (earlier && !samePerson(earlier, claimedName)) {
      outcome = {
        result: "refused",
        message: `Caller changed their story: earlier in this call they said they were ${safeName(earlier)}, now ${safeName(claimedName)}. Do not give them anything on this call. You are suspicious now.`,
      };
    } else if (rc.maxRefusals && refusalsSoFar.get(call.id).n >= rc.maxRefusals) {
      outcome = { result: "refused", message: TOO_MANY_REFUSALS };
    } else if (burned && rc.burned) {
      // Word travels: this identity already won an earlier level for this player.
      outcome = { result: "refused", message: rc.burned.replace("{name}", safeName(burned)) };
    } else {
      // A proof already given (Level 5's transfer reference) is checked before the trust gate, so
      // the character learns whether it's right instead of guessing, and a right one counts
      // towards trust even if he forgot to report it.
      const early = rc.referenceLevel && transferReference ? runCheck() : null;
      if (early && (early.why === "name" || early.why === "reference")) {
        check = early;
        outcome = { result: "refused", message: early.message };
      } else {
        if (early) trust = creditReference(call, level, trust);
        if (trust < level.trust.codeAt) {
          outcome = { result: "not_yet", message: (early && rc.notYetVerified) || rc.notYet || DEFAULT_NOT_YET };
        } else {
          check = early ?? runCheck();
          outcome = check.approved
            ? { result: "approved", message: rc.approvedTemplate.replace("{code}", codeFor(config.codeSecret, call.player_id, call.level, level.code.words)) }
            : { result: check.pending ? "not_yet" : "refused", message: check.message };
        }
      }
    }

    // The transfer reference is a code: only whether one was given is kept, never its value.
    const why = outcome.result === "refused" ? check?.why ?? null : null;
    const storedArgs = JSON.stringify({ claimed_name: claimedName, reason, employee_id: employeeId, department, approval_word: approvalWord, payee, gave_reference: Boolean(transferReference), trust, result: outcome.result, why });
    logToolCall.run(call.id, call.level, "request_code", earlier ?? claimedName, storedArgs, outcome.result === "approved" ? 1 : 0, now());
    if (!earlier) setIdentity.run(claimedName, call.id);
    // Some characters (Viktor) end the call after a failed check, after saying goodbye. A slip
    // (wrong reference or reason) may be retried until maxRefusals; anything else ends it now.
    if (outcome.result === "refused" && rc.hangUpOnRefusal) {
      const lastTry = refusalsSoFar.get(call.id).n >= (rc.maxRefusals ?? 1);
      if (!check?.retry || lastTry) {
        outcome.message = check?.retry && rc.lastRefusal ? rc.lastRefusal : `${outcome.message} ${CALL_OVER}`;
        scheduleHangUp(call, "case_check");
      }
    }
    res.json(outcome);
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
    const burnedNames = wordTravels.burnedNames(call.player_id, call.level);
    const args = req.body.arguments ?? {};
    // Level 5: a transfer reference the caller read out is checked here, not judged by the model.
    const verifiesReference = Boolean(level.requestCode?.referenceLevel);
    const heard = verifiesReference ? cleanText(args.transfer_reference) : null;
    const reference = heard ? referenceMatches(expectedReference(call, level.requestCode), heard) : undefined;
    const { state: next, changes } = scoreTurn(level.trust, state, args, {
      acceptedNames: identityNames(level),
      burnedNames,
      verifiesReference,
      reference,
    });
    saveTrust.run(next.trust, next.identity, JSON.stringify(next.evidence), next.gut, call.id);
    const logged = JSON.stringify({ before: state.trust, after: next.trust, changes });
    logToolCall.run(call.id, call.level, "assess_caller", next.identity, logged, next.trust >= level.trust.codeAt ? 1 : 0, now());

    if (next.trust <= level.trust.hangUpAt) scheduleHangUp(call);
    const known = isBurned(next.identity, burnedNames) ? KNOWN_TRICK_NOTE : "";
    const refNote = reference === true || (reference === false && state.evidence.includes(REFERENCE_KEY)) ? REFERENCE_RIGHT_NOTE : reference === false ? REFERENCE_WRONG_NOTE : "";
    res.json({ trust: next.trust, guidance: guidanceFor(level.trust, next.trust) + refNote + known });
  });

  // This player's own transfer reference from the level the check points at (Level 4), or null.
  function expectedReference(call, rc) {
    const proofLevel = rc?.referenceLevel && content.levelByNumber.get(rc.referenceLevel);
    return proofLevel ? codeFor(config.codeSecret, call.player_id, proofLevel.level, proofLevel.code.words) : null;
  }

  // A reference the case check confirmed counts towards trust once, even if the character
  // never reported it in assess_caller. Returns the trust after it.
  function creditReference(call, level, trust) {
    const fact = level.trust.evidence.find((e) => e.key === REFERENCE_KEY);
    const evidence = JSON.parse(call.trust_evidence ?? "[]");
    if (!fact || evidence.includes(fact.key)) return trust;
    const after = Math.min(100, trust + fact.points);
    saveTrust.run(after, call.trust_identity, JSON.stringify([...evidence, fact.key]), call.trust_gut ?? 0, call.id);
    const logged = JSON.stringify({ before: trust, after, changes: [{ key: fact.key, points: fact.points, label: fact.label }] });
    logToolCall.run(call.id, call.level, "assess_caller", call.trust_identity, logged, after >= level.trust.codeAt ? 1 : 0, now());
    return after;
  }

  // The character has given up on the caller: give them a moment to say goodbye, then cut the line.
  // `reason` is how the player's phone explains it: "distrust" (trust ran out) or "case_check".
  function scheduleHangUp(call, reason = "distrust") {
    const timer = setTimeout(async () => {
      if (!endCall.run(reason, now(), call.id).changes) return; // already over
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
