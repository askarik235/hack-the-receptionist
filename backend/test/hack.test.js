import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createApp } from "../src/server.js";
import { codeFor } from "../src/game/codes.js";
import { loadContent } from "../src/game/content.js";

const config = { toolSecret: "t".repeat(32), codeSecret: "c".repeat(32), sessionSecret: "s".repeat(32), production: false };
const words = loadContent().levelByNumber.get(1).code.words;

function setup(t, { max = 6 } = {}) {
  const db = openDb(":memory:");
  const server = createApp({ config, db, hack: { rateLimit: { windowMs: 60_000, max } } }).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  let cookie = "";
  const api = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: res.status, body: await res.json() };
  };
  const playerId = () => db.prepare("SELECT id FROM players").get().id;
  return { db, api, playerId };
}

test("the right code clears the level, marks the winning call and unlocks the next target", async (t) => {
  const { db, api, playerId } = setup(t);
  await api("GET", "/api/me"); // creates the guest player
  const id = playerId();
  db.prepare("INSERT INTO calls (id, player_id, level, attempt, external_client_id, status, created_at) VALUES ('call_a', ?, 1, 1, 'x', 'ended', 1)").run(id);
  db.prepare("INSERT INTO tool_calls (call_id, level, tool, claimed_name, arguments_json, approved, created_at) VALUES ('call_a', 1, 'request_code', 'Mark', '{}', 1, 1)").run();

  const code = codeFor(config.codeSecret, id, 1, words);
  const typed = code.toLowerCase().replace("-", " "); // players type it loosely
  const res = await api("POST", "/api/hack", { code: typed });
  assert.equal(res.status, 200);
  assert.equal(res.body.result, "granted");
  assert.equal(res.body.level, 1);
  assert.ok(res.body.debrief.defence.length > 0);
  assert.ok(!JSON.stringify(res.body).includes(code), "the code is never echoed back");

  assert.deepEqual({ ...db.prepare("SELECT level, winning_call_id FROM cleared_levels").get() }, { level: 1, winning_call_id: "call_a" });
  assert.equal(db.prepare("SELECT won FROM calls").get().won, 1);
  const content = await api("GET", "/api/content");
  assert.equal(content.body.targets[0].status, "cleared");
  assert.equal(content.body.targets[1].status, "soon");

  // Nothing left to hack until Level 2 exists.
  assert.deepEqual(await api("POST", "/api/hack", { code: typed }), { status: 409, body: { error: "nothing_to_hack" } });
});

test("wrong codes, other players' codes and junk are refused", async (t) => {
  const { api, playerId } = setup(t);
  await api("GET", "/api/me");
  const real = codeFor(config.codeSecret, playerId(), 1, words);
  const digits = (Number(real.slice(-4)) + 1) % 10000;
  const wrong = `${real.slice(0, -4)}${String(digits).padStart(4, "0")}`;
  assert.deepEqual((await api("POST", "/api/hack", { code: wrong })).body, { result: "denied", level: 1 });
  const someoneElse = codeFor(config.codeSecret, "0000000000", 1, words);
  if (someoneElse !== codeFor(config.codeSecret, playerId(), 1, words)) {
    assert.equal((await api("POST", "/api/hack", { code: someoneElse })).body.result, "denied");
  }
  assert.equal((await api("POST", "/api/hack", { code: "' OR 1=1 --" })).status, 400);
  assert.equal((await api("POST", "/api/hack", { code: 42 })).status, 400);
  assert.equal((await api("POST", "/api/hack", {})).status, 400);
});

test("guessing is rate limited", async (t) => {
  const { api } = setup(t, { max: 3 });
  let last;
  for (let i = 0; i < 4; i++) last = await api("POST", "/api/hack", { code: `REEF-000${i}` });
  assert.deepEqual(last, { status: 429, body: { error: "too_many_attempts" } });
});
