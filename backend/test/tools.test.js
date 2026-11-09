import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createApp } from "../src/server.js";
import { buildCallTags } from "../src/lib/callTags.js";
import { codeFor } from "../src/game/codes.js";
import { loadContent } from "../src/game/content.js";

const config = {
  toolSecret: "t".repeat(32),
  codeSecret: "c".repeat(32),
  sessionSecret: "s".repeat(32),
  production: false,
};
const PLAYER = "abcdef0123";
const EXTERNAL_ID = `p_${PLAYER}_L1_a1`;
const CALL_ID = "call_test_0001";

// trust: where the trust meter already stands (95 = the caller has convinced the character).
function setup(t, { status = "live", trust = 95 } = {}) {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO players VALUES (?, 1, 1)").run(PLAYER);
  db.prepare(
    "INSERT INTO calls (id, player_id, level, attempt, external_client_id, status, napster_session_id, trust, created_at) VALUES (?, ?, 1, 1, ?, ?, 'sess_1', ?, 1)"
  ).run(CALL_ID, PLAYER, EXTERNAL_ID, status, trust);
  const closed = [];
  const napster = { closeConnection: async (id) => closed.push(id) };
  const server = createApp({ config, db, napster, tools: { hangUpDelayMs: 0 } }).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/tools`;
  const url = `${base}/request_code`;
  const metadata = () => ({
    tags: buildCallTags(config.toolSecret, { callId: CALL_ID, playerId: PLAYER, level: 1 }),
    external_client_id: EXTERNAL_ID,
    external_client_profile: null,
  });

  // Sends an assess_caller report, as the character would.
  const assess = async (args) => {
    const res = await fetch(`${base}/assess_caller`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tool-secret": config.toolSecret },
      body: JSON.stringify({ name: "assess_caller", arguments: args, metadata: metadata() }),
    });
    return { status: res.status, body: await res.json() };
  };

  // Sends a request shaped like Napster's explicit tool call.
  const call = ({ claimedName = "Mark Keller", secret = config.toolSecret, tags, externalId = EXTERNAL_ID } = {}) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { "x-tool-secret": secret } : {}) },
      body: JSON.stringify({
        item_id: "item_1",
        call_id: "fc_1",
        name: "request_code",
        arguments: { claimed_name: claimedName, reason: "gate delivery" },
        metadata: {
          tags: tags ?? buildCallTags(config.toolSecret, { callId: CALL_ID, playerId: PLAYER, level: 1 }),
          external_client_id: externalId,
          external_client_profile: null,
        },
      }),
    });
  return { db, call, assess, closed };
}

test("the manager gets this player's code; it is logged", async (t) => {
  const { db, call } = setup(t);
  const res = await call({ claimedName: "Marc Kellar" });
  assert.equal(res.status, 200);
  const body = await res.json();
  const words = loadContent().levelByNumber.get(1).code.words;
  assert.equal(body.result, "approved");
  assert.ok(body.message.includes(codeFor(config.codeSecret, PLAYER, 1, words)));
  const row = db.prepare("SELECT * FROM tool_calls").get();
  assert.equal(row.claimed_name, "Marc Kellar");
  assert.equal(row.approved, 1);
});

test("switching to a different name later in the same call is refused", async (t) => {
  const { db, call } = setup(t);
  assert.equal((await (await call({ claimedName: "Oscar" })).json()).result, "refused");
  const second = await (await call({ claimedName: "Mr. Keller" })).json();
  assert.equal(second.result, "refused");
  assert.match(second.message, /changed their story/);
  assert.doesNotMatch(second.message, /[A-Z]{3,10}-\d{4}/);
  assert.deepEqual(db.prepare("SELECT approved FROM tool_calls").all().map((r) => r.approved), [0, 0]);
});

test("the same person said two ways is not a changed story", async (t) => {
  const { call } = setup(t);
  await call({ claimedName: "Mr. Keller" });
  assert.equal((await (await call({ claimedName: "Mark Keller" })).json()).result, "approved");
});

test("anyone else is refused without a code", async (t) => {
  const { db, call } = setup(t);
  const body = await (await call({ claimedName: "Viktor Sokolov" })).json();
  assert.equal(body.result, "refused");
  assert.doesNotMatch(body.message, /[A-Z]{3,10}-\d{4}/);
  assert.equal(db.prepare("SELECT approved FROM tool_calls").get().approved, 0);
});

test("missing or wrong secret is 401", async (t) => {
  const { call } = setup(t);
  assert.equal((await call({ secret: null })).status, 401);
  assert.equal((await call({ secret: "wrong" })).status, 401);
});

test("forged tags, someone else's call, or an ended call are 403", async (t) => {
  const { call } = setup(t);
  const forged = { ...buildCallTags(config.toolSecret, { callId: CALL_ID, playerId: PLAYER, level: 1 }), sig: "x".repeat(32) };
  assert.equal((await call({ tags: forged })).status, 403);
  const otherPlayer = buildCallTags(config.toolSecret, { callId: CALL_ID, playerId: "0000000000", level: 1 });
  assert.equal((await call({ tags: otherPlayer, externalId: "p_0000000000_L1_a1" })).status, 403);
  assert.equal((await call({ externalId: "not-ours" })).status, 403);

  const ended = setup(t, { status: "ended" });
  assert.equal((await ended.call()).status, 403);
});

test("empty or oversized names are rejected; repeated calls are rate limited", async (t) => {
  const { call } = setup(t);
  assert.equal((await call({ claimedName: "" })).status, 400);
  assert.equal((await call({ claimedName: "M".repeat(500) })).status, 400);
  let last;
  for (let i = 0; i < 11; i++) last = await call({ claimedName: "Nobody" });
  assert.equal(last.status, 429);
});

test("the code stays locked until trust reaches the level's threshold", async (t) => {
  const { call } = setup(t, { trust: null });
  const body = await (await call({ claimedName: "Mark Keller" })).json();
  assert.equal(body.result, "not_yet");
  assert.doesNotMatch(body.message, /[A-Z]{3,10}-\d{4}/);
});

test("convincing the character raises trust until the code unlocks", async (t) => {
  const { call, assess, db } = setup(t, { trust: null });
  const first = await assess({ claimed_identity: "Mark Keller", evidence: [] });
  assert.equal(first.status, 200);
  assert.equal(first.body.trust, 45 + 15);
  assert.match(first.body.guidance, /mostly believe/);
  assert.equal((await (await call({ claimedName: "Mark Keller" })).json()).result, "not_yet");
  const second = await assess({ evidence: ["mentioned his kingfish off Musandam"] });
  assert.equal(second.body.trust, 75);
  assert.match(second.body.guidance, /request_code/);
  // The same fact twice counts once.
  assert.equal((await assess({ evidence: ["talked about fishing again"] })).body.trust, 75);
  assert.equal((await (await call({ claimedName: "Mark Keller" })).json()).result, "approved");
  assert.equal(db.prepare("SELECT trust_identity FROM calls").get().trust_identity, "Mark Keller");
});

test("lies and pressure drain trust, and at the bottom the character hangs up", async (t) => {
  const { assess, db, closed } = setup(t, { trust: null });
  await assess({ claimed_identity: "Oskar from IT" });
  const changed = await assess({ claimed_identity: "Mark Keller", red_flags: ["pushy"] });
  assert.equal(changed.body.trust, 45 - 30 - 8);
  assert.match(changed.body.guidance, /hang up/);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual({ ...db.prepare("SELECT status, close_reason FROM calls").get() }, { status: "ended", close_reason: "distrust" });
  assert.deepEqual(closed, ["sess_1"]);
  assert.equal((await assess({ claimed_identity: "Mark Keller" })).status, 403); // the line is dead
});
