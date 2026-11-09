// Napster webhooks (Dashboard > Webhooks). Each delivery is signed: X-Webhook-Signature is the
// hex HMAC-SHA256 of the raw body, keyed with the signing secret string as shown in the dashboard.
// We answer 2xx fast and do the slow work (fetching the transcript) afterwards, because Napster
// counts anything slower than 10 seconds as a failure and retries it.
import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { now } from "../db.js";

const MAX_BODY = "64kb";
const RETRY_AFTER_MS = 5000; // the transcript can lag a moment behind session.closed

export function signatureMatches(secret, rawBody, received) {
  if (typeof received !== "string" || !/^[a-f0-9]{64}$/i.test(received)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(received, "hex"));
}

export function webhooksRouter({ config, db, processor, log = console, retryAfterMs = RETRY_AFTER_MS }) {
  const router = express.Router();
  const remember = db.prepare("INSERT OR IGNORE INTO webhook_events (event_id, event_type, received_at) VALUES (?, ?, ?)");

  router.post("/napster", express.raw({ type: "application/json", limit: MAX_BODY }), (req, res) => {
    if (!config.webhookSecret) return res.status(503).json({ error: "webhooks_not_configured" });
    if (!Buffer.isBuffer(req.body) || !signatureMatches(config.webhookSecret, req.body, req.get("x-webhook-signature"))) {
      return res.status(401).json({ error: "bad_signature" });
    }

    let event;
    try {
      event = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "invalid_json" });
    }
    const { eventId, eventType } = event ?? {};
    if (typeof eventId !== "string" || eventId.length > 100 || typeof eventType !== "string") {
      return res.status(400).json({ error: "invalid_event" });
    }
    // Napster retries deliveries, so the same event can arrive twice.
    if (remember.run(eventId, eventType.slice(0, 50), now()).changes === 0) return res.json({ ok: true, duplicate: true });
    res.json({ ok: true });

    if (eventType !== "session.closed") return;
    const session = event.data?.session;
    const callId = typeof session?.id === "string" ? processor.callForSession(session.id) : null;
    if (!callId) return; // not one of our game calls (e.g. a test in the dashboard)
    const closeReason = typeof session.reason === "string" ? session.reason.slice(0, 50) : null;
    const run = () => processor.processCall(callId, { closeReason });
    run()
      .then((done) => {
        if (!done) setTimeout(() => run().catch((err) => log.error(`Webhook retry failed: ${err.message}`)), retryAfterMs).unref?.();
      })
      .catch((err) => log.error(`Webhook processing failed for ${callId}: ${err.message}`));
  });

  return router;
}
