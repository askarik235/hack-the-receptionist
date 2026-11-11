// In-game phone: dialling a number starts a Napster session with that level's character,
// hanging up ends it. Each call is one attempt with a fresh externalClientId (decision D1).
import express from "express";
import { randomBytes } from "node:crypto";
import { now } from "../db.js";
import { externalClientIdFor } from "../lib/players.js";
import { buildCallTags } from "../lib/callTags.js";
import { createRateLimiter } from "../lib/rateLimit.js";
import { readNapsterIds } from "../napster/ids.js";
import { createWordTravels } from "../game/wordTravels.js";

const OPEN = ["dialing", "live"];
const STALE_AFTER_S = 15 * 60; // Napster closes idle calls after 3 min; anything this old is gone
const CALL_ID = /^call_[A-Za-z0-9_-]{16}$/;
const MAX_SILENCE_PENALTIES = 3; // per call, so a broken client can't drain trust
const MAX_CALL_S = 10 * 60; // hard cap on a call's length, so a call left open can't run up the bill

// "04 555 0142", "+971 4 555 0142", "045550142" -> "045550142"
export function normalizeNumber(input) {
  if (typeof input !== "string" || input.length > 25) return null;
  let digits = input.replace(/[\s().+-]/g, "");
  if (!/^\d{6,15}$/.test(digits)) return null;
  if (digits.startsWith("00971")) digits = "0" + digits.slice(5);
  else if (digits.startsWith("971")) digits = "0" + digits.slice(3);
  return digits;
}

export function callsRouter({
  config,
  db,
  content,
  napster,
  agentIdFor = (level) => readNapsterIds(config.napsterApiKey).agents?.[level.agent.key],
  rateLimit = { windowMs: 60_000, max: 6 },
  // Dials cost Napster credits, so they are also capped per IP and for the whole game.
  ipRateLimit = { windowMs: 60_000, max: 12 },
  globalRateLimit = { windowMs: 60_000, max: 40 },
  maxCallS = MAX_CALL_S,
  sweepEveryMs = 30_000,
  log = console,
}) {
  const router = express.Router();
  const allowDial = createRateLimiter(rateLimit);
  const allowDialFromIp = createRateLimiter(ipRateLimit);
  const allowDialGlobal = createRateLimiter(globalRateLimit);
  const allowLookup = createRateLimiter({ windowMs: rateLimit.windowMs, max: rateLimit.max * 5 });
  const allowStatus = createRateLimiter({ windowMs: rateLimit.windowMs, max: rateLimit.max * 20 }); // the phone polls this

  const isCleared = db.prepare("SELECT 1 FROM cleared_levels WHERE player_id = ? AND level = ?");
  const openCalls = db.prepare(
    `SELECT id, napster_session_id, created_at FROM calls WHERE player_id = ? AND status IN ('dialing', 'live')`
  );
  const nextAttempt = db.prepare("SELECT COALESCE(MAX(attempt), 0) + 1 AS n FROM calls WHERE player_id = ? AND level = ?");
  const insertCall = db.prepare(
    `INSERT INTO calls (id, player_id, level, attempt, external_client_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'dialing', ?)`
  );
  const markLive = db.prepare("UPDATE calls SET status = 'live', napster_session_id = ? WHERE id = ?");
  const markDone = db.prepare(
    "UPDATE calls SET status = ?, close_reason = ?, ended_at = ? WHERE id = ? AND status IN ('dialing', 'live')"
  );
  const lowerTrust = db.prepare("UPDATE calls SET trust = ? WHERE id = ?");
  const countSilence = db.prepare("SELECT COUNT(*) AS n FROM tool_calls WHERE call_id = ? AND tool = 'silence'");
  const logSilence = db.prepare(
    "INSERT INTO tool_calls (call_id, level, tool, claimed_name, arguments_json, approved, created_at) VALUES (?, ?, 'silence', NULL, ?, 0, ?)"
  );
  const findCall = db.prepare("SELECT id, level, napster_session_id, status, close_reason, trust FROM calls WHERE id = ? AND player_id = ?");
  const overlong = db.prepare("SELECT id, napster_session_id FROM calls WHERE status IN ('dialing', 'live') AND created_at <= ?");
  const wordTravels = createWordTravels(db);

  // Ends a call on Napster. A session that is already gone is fine.
  async function closeOnNapster(sessionId) {
    if (!sessionId) return;
    try {
      await napster.closeConnection(sessionId);
    } catch (err) {
      if (err.status !== 404) log.warn(`Could not close Napster connection ${sessionId}: ${err.message}`);
    }
  }

  // Ends any call that has run past the time limit, whatever the browser is doing.
  async function endOverlongCalls() {
    for (const call of overlong.all(now() - maxCallS)) {
      if (markDone.run("ended", "time_limit", now(), call.id).changes) await closeOnNapster(call.napster_session_id);
    }
  }
  const sweeper = setInterval(() => endOverlongCalls().catch((err) => log.error(`Call sweep failed: ${err.message}`)), sweepEveryMs);
  sweeper.unref?.();

  // One call at a time per player: a new dial ends anything still open (e.g. after a reload).
  async function endOpenCalls(playerId, reason) {
    for (const call of openCalls.all(playerId)) {
      markDone.run("ended", reason, now(), call.id);
      if (now() - call.created_at < STALE_AFTER_S) await closeOnNapster(call.napster_session_id);
    }
  }

  const startAttempt = db.transaction((playerId, level) => {
    const attempt = nextAttempt.get(playerId, level).n;
    const callId = `call_${randomBytes(12).toString("base64url")}`;
    const externalClientId = externalClientIdFor(playerId, level, attempt);
    insertCall.run(callId, playerId, level, attempt, externalClientId, now());
    return { callId, attempt, externalClientId };
  });

  // Which level a dialled number reaches for this player, or why it doesn't connect.
  function resolveNumber(playerId, rawNumber) {
    const number = normalizeNumber(rawNumber);
    if (!number) return { status: 400, error: "invalid_number" };
    const entry = content.phoneBook.find((e) => e.number === number);
    if (!entry) return { status: 404, error: "not_in_service" };
    const level = content.levelByNumber.get(entry.level);
    // A level's phone only connects once the level before it is cleared.
    if (level.level > 1 && !isCleared.get(playerId, level.level - 1)) return { status: 403, error: "no_answer" };
    const agentId = agentIdFor(level);
    if (!agentId) {
      log.error(`No Napster agent for ${level.agent.key}. Run: npm run setup`);
      return { status: 503, error: "not_set_up" };
    }
    return { level, agentId };
  }

  // Free pre-check before the phone asks for the microphone: no Napster session is created.
  router.post("/lookup", (req, res) => {
    if (!allowLookup(req.player.id)) return res.status(429).json({ error: "too_many_calls" });
    const found = resolveNumber(req.player.id, req.body?.number);
    if (found.error) return res.status(found.status).json({ error: found.error });
    res.json({ ok: true, level: found.level.level });
  });

  router.post("/", async (req, res, next) => {
    try {
      const playerId = req.player.id;
      if (!allowDial(playerId) || !allowDialFromIp(req.ip)) return res.status(429).json({ error: "too_many_calls" });
      const found = resolveNumber(playerId, req.body?.number);
      if (found.error) return res.status(found.status).json({ error: found.error });
      const { level, agentId } = found;
      if (!allowDialGlobal("all")) return res.status(503).json({ error: "line_busy" });

      await endOpenCalls(playerId, "replaced");
      const { callId, externalClientId } = startAttempt(playerId, level.level);

      // Word travels: the character hears about tricks that won earlier levels for this player.
      const officeNews = wordTravels.officeNews(content, playerId, level.level);
      let connection;
      try {
        connection = await napster.createConnection(agentId, {
          channelType: "webrtc",
          externalClientId,
          tags: buildCallTags(config.toolSecret, { callId, playerId, level: level.level }),
          ...(officeNews.length ? { externalClientProfile: { office_news: officeNews } } : {}),
        });
      } catch (err) {
        markDone.run("failed", err.code ?? `http_${err.status}`, now(), callId);
        const busy = err.status === 409 || err.status === 429;
        if (!busy) log.error(`Napster connection failed: ${err.message} ${JSON.stringify(err.body ?? "")}`);
        return res.status(busy ? 503 : 502).json({ error: busy ? "line_busy" : "call_failed" });
      }

      const sessionId = connection?.connection?.id;
      if (!connection?.token || !sessionId) {
        markDone.run("failed", "bad_response", now(), callId);
        return res.status(502).json({ error: "call_failed" });
      }
      markLive.run(sessionId, callId);
      // The phone runs the silence timer; these lines are what the character says when the caller goes quiet.
      const { checkInAfterS, uneasyAfterS, hangUpAfterS, checkIns, uneasy, goodbyes } = level.silence;
      res.status(201).json({
        callId,
        level: level.level,
        token: connection.token,
        silence: { checkInAfterS, uneasyAfterS, hangUpAfterS, checkIns, uneasy, goodbyes },
      });
    } catch (err) {
      next(err);
    }
  });

  // The phone polls this during a call for the trust meter and to learn if the character hung up.
  router.get("/:callId", (req, res) => {
    if (!allowStatus(req.player.id)) return res.status(429).json({ error: "too_many_calls" });
    if (!CALL_ID.test(req.params.callId)) return res.status(404).json({ error: "not_found" });
    const call = findCall.get(req.params.callId, req.player.id);
    if (!call) return res.status(404).json({ error: "not_found" });
    const { trust: rules } = content.levelByNumber.get(call.level);
    res.json({
      status: call.status,
      closeReason: call.status === "ended" ? call.close_reason : null,
      trust: call.trust ?? rules.start,
      codeAt: rules.codeAt,
      hangUpAt: rules.hangUpAt,
    });
  });

  // The caller stayed silent. "uneasy": the character gets suspicious (trust drops).
  // "hangup": the character said goodbye; end the call.
  router.post("/:callId/silence", async (req, res, next) => {
    try {
      if (!allowStatus(req.player.id)) return res.status(429).json({ error: "too_many_calls" });
      if (!CALL_ID.test(req.params.callId)) return res.status(404).json({ error: "not_found" });
      const stage = req.body?.stage;
      if (stage !== "uneasy" && stage !== "hangup") return res.status(400).json({ error: "invalid_stage" });
      const call = findCall.get(req.params.callId, req.player.id);
      if (!call) return res.status(404).json({ error: "not_found" });
      if (!OPEN.includes(call.status)) return res.json({ ok: true, status: call.status });

      const level = content.levelByNumber.get(call.level);
      if (stage === "hangup") {
        markDone.run("ended", "silence", now(), call.id);
        await closeOnNapster(call.napster_session_id);
        return res.json({ ok: true, status: "ended" });
      }
      let trust = call.trust ?? level.trust.start;
      if (countSilence.get(call.id).n < MAX_SILENCE_PENALTIES) {
        // Silence alone never pushes trust to the hang-up line; that's what the 20-second rule is for.
        trust = Math.max(level.trust.hangUpAt + 1, trust - level.silence.penalty);
        lowerTrust.run(trust, call.id);
        logSilence.run(call.id, call.level, JSON.stringify({ stage, trust }), now());
      }
      res.json({ ok: true, status: call.status, trust });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:callId", async (req, res, next) => {
    try {
      if (!CALL_ID.test(req.params.callId)) return res.status(404).json({ error: "not_found" });
      const call = findCall.get(req.params.callId, req.player.id);
      if (!call) return res.status(404).json({ error: "not_found" });
      if (OPEN.includes(call.status)) {
        markDone.run("ended", "hangup", now(), call.id);
        await closeOnNapster(call.napster_session_id);
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
