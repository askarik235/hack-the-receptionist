import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { createApp } from "../src/server.js";
import { ACCESS_COOKIE } from "../src/lib/access.js";
import { loadConfig } from "../src/config.js";

const SECRET = "s".repeat(32);
const CODE = "judge-code-2026";

function start(t, config, extra = {}) {
  const server = createApp({ config: { sessionSecret: SECRET, production: false, ...config }, db: openDb(":memory:"), ...extra }).listen(0);
  t.after(() => server.close());
  return `http://localhost:${server.address().port}`;
}

const post = (url, body, headers = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("without ACCESS_CODE the game is open, as before", async (t) => {
  const base = start(t, { accessCode: null });
  assert.deepEqual(await (await fetch(`${base}/api/access`)).json(), { required: false, granted: true });
  assert.equal((await fetch(`${base}/api/me`)).status, 200);
});

test("with ACCESS_CODE the API waits for the code, and the right code unlocks it", async (t) => {
  const base = start(t, { accessCode: CODE });

  assert.deepEqual(await (await fetch(`${base}/api/access`)).json(), { required: true, granted: false });
  const locked = await fetch(`${base}/api/me`);
  assert.equal(locked.status, 401);
  assert.deepEqual(await locked.json(), { error: "access_required" });
  assert.equal(locked.headers.get("set-cookie"), null, "no guest player before the code");
  assert.equal((await fetch(`${base}/api/content`)).status, 401);
  assert.equal((await fetch(`${base}/api/health`)).status, 200, "health stays open for the host");

  const wrong = await post(`${base}/api/access`, { code: "not-the-code" });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.headers.get("set-cookie"), null);

  const right = await post(`${base}/api/access`, { code: `  ${CODE} ` });
  assert.equal(right.status, 200);
  const setCookie = right.headers.get("set-cookie");
  assert.match(setCookie, new RegExp(`^${ACCESS_COOKIE}=`));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.ok(!setCookie.includes(CODE), "the cookie never contains the code itself");

  const cookie = setCookie.split(";")[0];
  assert.deepEqual(await (await fetch(`${base}/api/access`, { headers: { cookie } })).json(), { required: true, granted: true });
  assert.equal((await fetch(`${base}/api/me`, { headers: { cookie } })).status, 200);

  const forged = `${ACCESS_COOKIE}=${"A".repeat(43)}`;
  assert.equal((await fetch(`${base}/api/me`, { headers: { cookie: forged } })).status, 401);
});

test("changing the code signs old browsers out", async (t) => {
  const first = start(t, { accessCode: CODE });
  const cookie = (await post(`${first}/api/access`, { code: CODE })).headers.get("set-cookie").split(";")[0];
  const second = start(t, { accessCode: "a-brand-new-code" });
  assert.equal((await fetch(`${second}/api/me`, { headers: { cookie } })).status, 401);
});

test("code guesses are rate limited and bad input is rejected", async (t) => {
  const base = start(t, { accessCode: CODE }, { access: { rateLimit: { windowMs: 60_000, max: 3 } } });
  assert.equal((await post(`${base}/api/access`, { code: "" })).status, 400);
  assert.equal((await post(`${base}/api/access`, { code: "x".repeat(65) })).status, 400);
  assert.equal((await post(`${base}/api/access`, { code: 1234 })).status, 400);
  const blocked = await post(`${base}/api/access`, { code: CODE });
  assert.equal(blocked.status, 429, "even the right code waits once the limit is hit");
});

test("the built game is served from the same server, API routes stay JSON", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "htr-dist-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Midas</title>");
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)");
  const base = start(t, { accessCode: CODE }, { staticDir: dir });

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Midas/);
  assert.equal(page.headers.get("cache-control"), "no-cache");
  assert.match(await (await fetch(`${base}/some/deep/link`)).text(), /Midas/, "any page path gets the game");

  const asset = await fetch(`${base}/assets/app-abc123.js`);
  assert.match(asset.headers.get("cache-control"), /immutable/);
  assert.equal((await fetch(`${base}/assets/gone-old123.js`)).status, 404, "a missing asset isn't the page");

  const api = await fetch(`${base}/api/nope`);
  assert.equal(api.status, 401, "the page is public, the API still needs the code");
  for (const path of ["/tools/anything", "/webhooks/anything", "/portraits/nope.txt"]) {
    const res = await fetch(base + path);
    assert.notEqual(res.status, 200, `${path} never falls back to the page`);
    assert.doesNotMatch(await res.text(), /Midas/);
  }
});

test("ACCESS_CODE is optional but must be 8-64 characters when set", () => {
  const env = { NAPSTER_API_KEY: "k", TOOL_SECRET: SECRET, CODE_SECRET: SECRET, SESSION_SECRET: SECRET };
  assert.equal(loadConfig(env).accessCode, null);
  assert.equal(loadConfig({ ...env, ACCESS_CODE: CODE }).accessCode, CODE);
  assert.throws(() => loadConfig({ ...env, ACCESS_CODE: "short" }), /ACCESS_CODE must be 8 to 64 characters/);
});
