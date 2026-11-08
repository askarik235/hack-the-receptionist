// Guest players: each browser gets a random player ID in a signed, HttpOnly cookie.
// No accounts, no personal data. The ID is also the base of the Napster externalClientId.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { now } from "../db.js";

export const COOKIE_NAME = "htr_pid";
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;
const PLAYER_ID = /^[a-f0-9]{10}$/;
const EXTERNAL_CLIENT_ID = /^[A-Za-z0-9_-]{1,32}$/; // Napster's rule for externalClientId

export const generatePlayerId = () => randomBytes(5).toString("hex");

const sign = (playerId, secret) =>
  createHmac("sha256", secret).update(`player:${playerId}`).digest("base64url");

export const cookieValueFor = (playerId, secret) => `${playerId}.${sign(playerId, secret)}`;

// Returns the player ID if the cookie value is well-formed and correctly signed, else null.
export function verifyCookieValue(value, secret) {
  if (typeof value !== "string") return null;
  const [playerId, signature, extra] = value.split(".");
  if (extra !== undefined || !PLAYER_ID.test(playerId ?? "") || !signature) return null;
  const expected = Buffer.from(sign(playerId, secret));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected) ? playerId : null;
}

export function parseCookies(header = "") {
  const cookies = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return cookies;
}

// Napster memory is per companion + externalClientId. A new attempt gets a new ID, so a
// character forgets failed calls (decision D1 in napster-findings.md).
export function externalClientIdFor(playerId, level, attempt) {
  const id = `p_${playerId}_L${level}_a${attempt}`;
  if (!EXTERNAL_CLIENT_ID.test(id)) throw new Error(`Invalid externalClientId: ${id}`);
  return id;
}

// Express middleware: sets req.player = { id }, creating a guest player when needed.
export function playerMiddleware({ db, secret, secureCookies }) {
  const findPlayer = db.prepare("SELECT id FROM players WHERE id = ?");
  const touchPlayer = db.prepare("UPDATE players SET last_seen_at = ? WHERE id = ?");
  const insertPlayer = db.prepare("INSERT INTO players (id, created_at, last_seen_at) VALUES (?, ?, ?)");

  return (req, res, next) => {
    const fromCookie = verifyCookieValue(parseCookies(req.headers.cookie)[COOKIE_NAME], secret);
    if (fromCookie && findPlayer.get(fromCookie)) {
      touchPlayer.run(now(), fromCookie);
      req.player = { id: fromCookie };
      return next();
    }

    const id = generatePlayerId();
    const t = now();
    insertPlayer.run(id, t, t);
    res.cookie(COOKIE_NAME, cookieValueFor(id, secret), {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      maxAge: COOKIE_MAX_AGE_S * 1000,
      path: "/",
    });
    req.player = { id };
    next();
  };
}
