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

function setup(t, { content = loadContent(), agentIdFor = () => "agent_timur", calls = {} } = {}) {
  const db = openDb(":memory:");
  const napster = fakeNapster();
  const server = createApp({ config, db, content, napster, calls: { agentIdFor, log: { warn() {}, error() {} }, ...calls } }).listen(0);
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

test("lookup answers without creating a Napster session", async (t) => {
  const { napster, api } = setup(t, { content: contentWithLevel2() });
  assert.deepEqual(await api("POST", "/api/calls/lookup", { number: TIMUR }), { status: 200, body: { ok: true, level: 1 } });
  assert.deepEqual(await api("POST", "/api/calls/lookup", { number: "04 555 9999" }), { status: 404, body: { error: "not_in_service" } });
  assert.deepEqual(await api("POST", "/api/calls/lookup", { number: "04 555 0100" }), { status: 403, body: { error: "no_answer" } });
  assert.equal(napster.created.length, 0);
});

test("dialling is rate limited per player", async (t) => {
  const { api } = setup(t);
  let last;
  for (let i = 0; i < 7; i++) last = await api("POST", "/api/calls", { number: TIMUR });
  assert.deepEqual(last, { status: 429, body: { error: "too_many_calls" } });
});

test("end to end: Timur's tool call during this call returns this player's code", async (t) => {
  const { db, napster, api, base } = setup(t);
  const { body: dialled } = await api("POST", "/api/calls", { number: TIMUR });
  db.prepare("UPDATE calls SET trust = 95 WHERE id = ?").run(dialled.callId); // Timur is convinced
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

test("the phone can read its own call's trust meter, nobody else's", async (t) => {
  const { db, api, base } = setup(t);
  const { body } = await api("POST", "/api/calls", { number: TIMUR });
  assert.deepEqual(await api("GET", `/api/calls/${body.callId}`), {
    status: 200,
    body: { status: "live", closeReason: null, trust: 45, codeAt: 75, hangUpAt: 10 },
  });
  db.prepare("UPDATE calls SET trust = 8, status = 'ended', close_reason = 'distrust' WHERE id = ?").run(body.callId);
  const after = await api("GET", `/api/calls/${body.callId}`);
  assert.deepEqual([after.body.trust, after.body.closeReason], [8, "distrust"]);
  assert.equal((await fetch(`${base}/api/calls/${body.callId}`)).status, 404);
});

test("silence: the caller gets the lines, going quiet costs trust, and the call can end", async (t) => {
  const { db, api, napster } = setup(t);
  const { body } = await api("POST", "/api/calls", { number: TIMUR });
  assert.equal(body.silence.hangUpAfterS, 20);
  assert.ok(body.silence.checkIns.length >= 5);

  const first = await api("POST", `/api/calls/${body.callId}/silence`, { stage: "uneasy" });
  assert.equal(first.body.trust, 45 - 8);
  for (let i = 0; i < 5; i++) await api("POST", `/api/calls/${body.callId}/silence`, { stage: "uneasy" });
  const capped = db.prepare("SELECT trust FROM calls").get().trust;
  assert.equal(capped, 45 - 8 * 3, "only three penalties per call");

  assert.equal((await api("POST", `/api/calls/${body.callId}/silence`, { stage: "shout" })).status, 400);
  assert.deepEqual((await api("POST", `/api/calls/${body.callId}/silence`, { stage: "hangup" })).body, { ok: true, status: "ended" });
  assert.deepEqual({ ...db.prepare("SELECT status, close_reason FROM calls").get() }, { status: "ended", close_reason: "silence" });
  assert.deepEqual(napster.closed, ["sess_1"]);
});

test("silence never drops trust to the hang-up line by itself", async (t) => {
  const { db, api } = setup(t);
  const { body } = await api("POST", "/api/calls", { number: TIMUR });
  db.prepare("UPDATE calls SET trust = 14 WHERE id = ?").run(body.callId);
  assert.equal((await api("POST", `/api/calls/${body.callId}/silence`, { stage: "uneasy" })).body.trust, 11);
});

test("dropping the cookie doesn't escape the dial limit: dials are also capped per IP", async (t) => {
  const { base } = setup(t, { calls: { ipRateLimit: { windowMs: 60_000, max: 3 } } });
  const dialAsNewPlayer = () =>
    fetch(`${base}/api/calls`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: TIMUR }) });
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await dialAsNewPlayer()).status);
  assert.deepEqual(statuses, [201, 201, 201, 429]);
});

test("the whole game has a dial ceiling; past it the line is busy", async (t) => {
  const { api, napster } = setup(t, { calls: { globalRateLimit: { windowMs: 60_000, max: 1 } } });
  assert.equal((await api("POST", "/api/calls", { number: TIMUR })).status, 201);
  assert.deepEqual(await api("POST", "/api/calls", { number: TIMUR }), { status: 503, body: { error: "line_busy" } });
  assert.equal(napster.created.length, 1);
});

test("calls past the time limit are ended on Napster by the server", async (t) => {
  const { api, db, napster } = setup(t, { calls: { maxCallS: 0, sweepEveryMs: 20 } });
  const { body } = await api("POST", "/api/calls", { number: TIMUR });
  await new Promise((r) => setTimeout(r, 80));
  const call = db.prepare("SELECT status, close_reason FROM calls WHERE id = ?").get(body.callId);
  assert.deepEqual({ ...call }, { status: "ended", close_reason: "time_limit" });
  assert.deepEqual(napster.closed, ["sess_1"]);
  const status = await api("GET", `/api/calls/${body.callId}`);
  assert.equal(status.body.closeReason, "time_limit");
});
