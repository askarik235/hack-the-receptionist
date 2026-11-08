import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createApp } from "../src/server.js";
import { loadContent } from "../src/game/content.js";
import { normalizeNumber } from "../src/calls/router.js";
import { NapsterError } from "../src/napster/client.js";

const config = { toolSecret: "t".repeat(32), codeSecret: "c".repeat(32), sessionSecret: "s".repeat(32), production: false };
const TIMUR = "04 555 0142";

function fakeNapster() {
  const created = [];
  const closed = [];
  let next = 1;
  let failWith = null;
  return {
    created,
    closed,
    failNext: (err) => { failWith = err; },
    createConnection: async (agentId, body) => {
      if (failWith) { const err = failWith; failWith = null; throw err; }
      created.push({ agentId, body });
      return { token: `tok_${next}`, connection: { id: `sess_${next++}` } };
    },
    closeConnection: async (id) => { closed.push(id); },
  };
}

// Content with a fake Level 2 behind the receptionist's number, to test locking.
function contentWithLevel2() {
  const real = loadContent();
  const level1 = real.levelByNumber.get(1);
  const level2 = { ...level1, level: 2, agent: { ...level1.agent, key: "level-2-test" } };
  return {
    ...real,
    phoneBook: [...real.phoneBook, { number: "045550100", level: 2 }],
    levelByNumber: new Map([...real.levelByNumber, [2, level2]]),
  };
}

function setup(t, { content = loadContent(), agentIdFor = () => "agent_timur" } = {}) {
  const db = openDb(":memory:");
  const napster = fakeNapster();
  const server = createApp({ config, db, content, napster, calls: { agentIdFor, log: { warn() {}, error() {} } } }).listen(0);
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
  return { db, napster, api, base, playerId };
}

test("phone numbers are normalised", () => {
  assert.equal(normalizeNumber("04 555 0142"), "045550142");
  assert.equal(normalizeNumber("+971 4 555 0142"), "045550142");
  assert.equal(normalizeNumber("00971-4-555-0142"), "045550142");
  assert.equal(normalizeNumber("(04) 555-0142"), "045550142");
  assert.equal(normalizeNumber("call me"), null);
  assert.equal(normalizeNumber("1".repeat(40)), null);
  assert.equal(normalizeNumber(42), null);
});

test("dialling Timur starts a Napster session for a fresh attempt", async (t) => {
  const { db, napster, api, playerId } = setup(t);
  const res = await api("POST", "/api/calls", { number: TIMUR });
  assert.equal(res.status, 201);
  assert.equal(res.body.token, "tok_1");
  assert.equal(res.body.level, 1);
  assert.match(res.body.callId, /^call_/);

  const sent = napster.created[0];
  assert.equal(sent.agentId, "agent_timur");
  assert.equal(sent.body.channelType, "webrtc");
  assert.equal(sent.body.externalClientId, `p_${playerId()}_L1_a1`);
  assert.equal(sent.body.tags.callId, res.body.callId);
  assert.ok(sent.body.tags.sig);

  const row = db.prepare("SELECT * FROM calls WHERE id = ?").get(res.body.callId);
  assert.equal(row.status, "live");
  assert.equal(row.napster_session_id, "sess_1");
});

test("a new dial ends the open call and counts a new attempt", async (t) => {
  const { db, napster, api, playerId } = setup(t);
  const first = await api("POST", "/api/calls", { number: TIMUR });
  const second = await api("POST", "/api/calls", { number: "+971 4 555 0142" });
  assert.equal(second.status, 201);
  assert.deepEqual(napster.closed, ["sess_1"]);
  assert.equal(napster.created[1].body.externalClientId, `p_${playerId()}_L1_a2`);
  const old = db.prepare("SELECT status, close_reason FROM calls WHERE id = ?").get(first.body.callId);
  assert.deepEqual({ ...old }, { status: "ended", close_reason: "replaced" });
});

test("unknown, invalid and locked numbers don't connect", async (t) => {
  const { db, napster, api, playerId } = setup(t, { content: contentWithLevel2() });
  assert.deepEqual(await api("POST", "/api/calls", { number: "04 555 9999" }), { status: 404, body: { error: "not_in_service" } });
  assert.equal((await api("POST", "/api/calls", { number: "hello" })).status, 400);
  assert.equal((await api("POST", "/api/calls", {})).status, 400);
  assert.deepEqual(await api("POST", "/api/calls", { number: "04 555 0100" }), { status: 403, body: { error: "no_answer" } });
  assert.equal(napster.created.length, 0);

  db.prepare("INSERT INTO cleared_levels VALUES (?, 1, 1, NULL)").run(playerId());
  assert.equal((await api("POST", "/api/calls", { number: "04 555 0100" })).status, 201);
});

test("busy lines and missing setup are reported, and the attempt is marked failed", async (t) => {
  const { db, napster, api } = setup(t);
  napster.failNext(new NapsterError("busy", { status: 409, code: "ConcurrentSessionLimitReached" }));
  assert.deepEqual(await api("POST", "/api/calls", { number: TIMUR }), { status: 503, body: { error: "line_busy" } });
  assert.deepEqual({ ...db.prepare("SELECT status, close_reason FROM calls").get() }, { status: "failed", close_reason: "ConcurrentSessionLimitReached" });

  const notSetUp = setup(t, { agentIdFor: () => undefined });
  assert.deepEqual(await notSetUp.api("POST", "/api/calls", { number: TIMUR }), { status: 503, body: { error: "not_set_up" } });
});

test("hanging up ends the session once; other players' calls are invisible", async (t) => {
  const { db, napster, api, base } = setup(t);
  const { body } = await api("POST", "/api/calls", { number: TIMUR });
  assert.deepEqual(await api("DELETE", `/api/calls/${body.callId}`), { status: 200, body: { ok: true } });
  assert.deepEqual(await api("DELETE", `/api/calls/${body.callId}`), { status: 200, body: { ok: true } });
  assert.deepEqual(napster.closed, ["sess_1"]);
  assert.equal(db.prepare("SELECT status FROM calls").get().status, "ended");

  const stranger = await fetch(`${base}/api/calls/${body.callId}`, { method: "DELETE" });
  assert.equal(stranger.status, 404);
  assert.equal((await api("DELETE", "/api/calls/%2E%2E%2Fetc")).status, 404);
  assert.equal((await api("DELETE", "/api/calls/call_short")).status, 404);
});

test("dialling is rate limited per player", async (t) => {
  const { api } = setup(t);
  let last;
  for (let i = 0; i < 7; i++) last = await api("POST", "/api/calls", { number: TIMUR });
  assert.deepEqual(last, { status: 429, body: { error: "too_many_calls" } });
});

test("end to end: Timur's tool call during this call returns this player's code", async (t) => {
  const { napster, api, base } = setup(t);
  await api("POST", "/api/calls", { number: TIMUR });
  const { body: connection } = napster.created[0];
  const res = await fetch(`${base}/tools/request_code`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tool-secret": config.toolSecret },
    body: JSON.stringify({
      name: "request_code",
      arguments: { claimed_name: "Mark Keller" },
      metadata: { tags: connection.tags, external_client_id: connection.externalClientId },
    }),
  });
  const out = await res.json();
  assert.equal(out.result, "approved");
  assert.match(out.message, /[A-Z]{3,10}-\d{4}/);
});
