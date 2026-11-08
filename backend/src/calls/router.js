// In-game phone: dialling a number starts a Napster session with that level's character,
// hanging up ends it. Each call is one attempt with a fresh externalClientId (decision D1).
import express from "express";
import { randomBytes } from "node:crypto";
import { now } from "../db.js";
import { externalClientIdFor } from "../lib/players.js";
import { buildCallTags } from "../lib/callTags.js";
import { createRateLimiter } from "../lib/rateLimit.js";
import { readNapsterIds } from "../napster/ids.js";

const OPEN = ["dialing", "live"];
const STALE_AFTER_S = 15 * 60; // Napster closes idle calls after 3 min; anything this old is gone
const CALL_ID = /^call_[A-Za-z0-9_-]{16}$/;

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
  log = console,
}) {
  const router = express.Router();
  const allowDial = createRateLimiter(rateLimit);

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
  const findCall = db.prepare("SELECT id, napster_session_id, status FROM calls WHERE id = ? AND player_id = ?");

  // Ends a call on Napster. A session that is already gone is fine.
  async function closeOnNapster(sessionId) {
    if (!sessionId) return;
    try {
      await napster.closeConnection(sessionId);
    } catch (err) {
      if (err.status !== 404) log.warn(`Could not close Napster connection ${sessionId}: ${err.message}`);
    }
  }

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

  router.post("/", async (req, res, next) => {
    try {
      const playerId = req.player.id;
      const number = normalizeNumber(req.body?.number);
      if (!number) return res.status(400).json({ error: "invalid_number" });
      if (!allowDial(playerId)) return res.status(429).json({ error: "too_many_calls" });

      const entry = content.phoneBook.find((e) => e.number === number);
      if (!entry) return res.status(404).json({ error: "not_in_service" });
      const level = content.levelByNumber.get(entry.level);
      // A level's phone only connects once the level before it is cleared.
      if (level.level > 1 && !isCleared.get(playerId, level.level - 1)) {
        return res.status(403).json({ error: "no_answer" });
      }
      const agentId = agentIdFor(level);
      if (!agentId) {
        log.error(`No Napster agent for ${level.agent.key}. Run: npm run setup`);
        return res.status(503).json({ error: "not_set_up" });
      }

      await endOpenCalls(playerId, "replaced");
      const { callId, externalClientId } = startAttempt(playerId, level.level);

      let connection;
      try {
        connection = await napster.createConnection(agentId, {
          channelType: "webrtc",
          externalClientId,
          tags: buildCallTags(config.toolSecret, { callId, playerId, level: level.level }),
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
      res.status(201).json({ callId, level: level.level, token: connection.token });
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
