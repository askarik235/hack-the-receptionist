// Judge access code for the hosted demo. When ACCESS_CODE is set, the game's API only answers
// browsers that have entered the code (a signed cookie). Without it (local play, or a judge
// running the repo with their own key) everything is open, exactly as before.
// Napster's own routes (/tools, /webhooks) have their own secrets and are not affected.
import express from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { parseCookies } from "./players.js";
import { createRateLimiter } from "./rateLimit.js";
import { safeEqual } from "./safeEqual.js";

export const ACCESS_COOKIE = "htr_access";
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 60; // 60 days: covers the whole judging period
const MAX_CODE = 64;

// The cookie proves "this browser entered the current code". It is tied to a hash of the code,
// so changing ACCESS_CODE on the host signs everyone out.
function accessToken(code, secret) {
  const codeHash = createHash("sha256").update(code).digest("base64url");
  return createHmac("sha256", secret).update(`access:${codeHash}`).digest("base64url");
}

export function hasAccess(req, config) {
  if (!config.accessCode) return true;
  const given = Buffer.from(parseCookies(req.headers.cookie)[ACCESS_COOKIE] ?? "");
  const expected = Buffer.from(accessToken(config.accessCode, config.sessionSecret));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// GET /api/access: does this browser need the code? POST /api/access { code }: enter it.
export function accessRouter({ config, rateLimit = { windowMs: 10 * 60_000, max: 10 } }) {
  const router = express.Router();
  const allowTry = createRateLimiter(rateLimit);

  router.get("/", (req, res) => {
    res.json({ required: Boolean(config.accessCode), granted: hasAccess(req, config) });
  });

  router.post("/", (req, res) => {
    if (!config.accessCode) return res.json({ granted: true });
    if (!allowTry(req.ip)) return res.status(429).json({ error: "too_many_attempts" });
    const code = req.body?.code;
    if (typeof code !== "string" || !code.trim() || code.length > MAX_CODE) {
      return res.status(400).json({ error: "invalid_code" });
    }
    if (!safeEqual(code.trim(), config.accessCode)) return res.status(403).json({ error: "wrong_code" });
    res.cookie(ACCESS_COOKIE, accessToken(config.accessCode, config.sessionSecret), {
      httpOnly: true,
      sameSite: "lax",
      secure: config.production,
      maxAge: COOKIE_MAX_AGE_S * 1000,
      path: "/",
    });
    res.json({ granted: true });
  });

  return router;
}

// Everything else under /api waits for the code. Runs before the player middleware, so
// visitors without the code don't even get a guest player.
export function accessGate({ config }) {
  return (req, res, next) => (hasAccess(req, config) ? next() : res.status(401).json({ error: "access_required" }));
}
