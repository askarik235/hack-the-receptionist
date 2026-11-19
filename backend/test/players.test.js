import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COOKIE_NAME,
  cookieValueFor,
  externalClientIdFor,
  generatePlayerId,
  parseCookies,
  verifyCookieValue,
} from "../src/lib/players.js";
import { openDb } from "../src/db.js";
import { createApp } from "../src/server.js";

const SECRET = "s".repeat(32);

test("player IDs are 10 hex characters", () => {
  assert.match(generatePlayerId(), /^[a-f0-9]{10}$/);
});

test("signed cookie verifies, tampering does not", () => {
  const value = cookieValueFor("abcdef0123", SECRET);
  assert.equal(verifyCookieValue(value, SECRET), "abcdef0123");
  assert.equal(verifyCookieValue(value, "x".repeat(32)), null); // wrong secret
  assert.equal(verifyCookieValue(value.replace("abcdef0123", "abcdef0124"), SECRET), null); // other player
  assert.equal(verifyCookieValue("abcdef0123", SECRET), null); // no signature
  assert.equal(verifyCookieValue(`${value}.extra`, SECRET), null);
  assert.equal(verifyCookieValue("../../etc.sig", SECRET), null);
  assert.equal(verifyCookieValue(undefined, SECRET), null);
});

test("parseCookies reads a Cookie header", () => {
  assert.deepEqual(parseCookies("a=1; htr_pid=x.y; b = 2"), { a: "1", htr_pid: "x.y", b: "2" });
  assert.deepEqual(parseCookies(undefined), {});
});

test("externalClientId follows decision D1 and Napster's 32-char rule", () => {
  assert.equal(externalClientIdFor("abcdef0123", 1, 3), "p_abcdef0123_L1_a3");
  assert.match(externalClientIdFor("abcdef0123", 5, 9999), /^[A-Za-z0-9_-]{1,32}$/);
  assert.throws(() => externalClientIdFor("bad id!", 1, 1), /Invalid externalClientId/);
});

// End-to-end through Express: first visit creates a player, the cookie brings them back.
test("middleware creates a guest player once and recognises the cookie", async (t) => {
  const db = openDb(":memory:");
  const config = { sessionSecret: SECRET, production: false };
  const server = createApp({ config, db }).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;

  const first = await fetch(`${base}/api/me`);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { clearedLevels: [] });
  const setCookie = first.headers.get("set-cookie");
  assert.match(setCookie, new RegExp(`^${COOKIE_NAME}=`));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  const cookie = setCookie.split(";")[0];
  const second = await fetch(`${base}/api/me`, { headers: { cookie } });
  assert.equal(second.headers.get("set-cookie"), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM players").get().n, 1);

  const forged = await fetch(`${base}/api/me`, { headers: { cookie: `${COOKIE_NAME}=abcdef0123.forged` } });
  assert.ok(forged.headers.get("set-cookie"), "forged cookie gets a fresh player");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM players").get().n, 2);
});

test("health needs no cookie; unknown API routes are 404; bad JSON is 400", async (t) => {
  const db = openDb(":memory:");
  const server = createApp({ config: { sessionSecret: SECRET, production: false }, db }).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;

  const health = await fetch(`${base}/api/health`);
  assert.deepEqual(await health.json(), { ok: true });
  assert.equal(health.headers.get("set-cookie"), null);
  assert.equal(health.headers.get("x-powered-by"), null);

  assert.equal((await fetch(`${base}/api/nope`)).status, 404);

  const bad = await fetch(`${base}/api/me`, { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: "invalid_json" });
});

test("new players are capped per IP, and every response carries security headers", async (t) => {
  const db = openDb(":memory:");
  const server = createApp({ config: { sessionSecret: SECRET, production: false }, db, players: { newPlayerLimit: { windowMs: 60_000, max: 2 } } }).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;

  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await fetch(`${base}/api/me`)).status);
  assert.deepEqual(statuses, [200, 200, 429]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM players").get().n, 2);

  const res = await fetch(`${base}/api/health`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.match(res.headers.get("permissions-policy"), /microphone=\(self\)/);
  assert.equal(res.headers.get("strict-transport-security"), null); // local dev is plain http
});

test("production responses tell browsers to use https only", async (t) => {
  const server = createApp({ config: { sessionSecret: SECRET, production: true }, db: openDb(":memory:") }).listen(0);
  t.after(() => server.close());
  const res = await fetch(`http://localhost:${server.address().port}/api/health`);
  assert.equal(res.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
});
