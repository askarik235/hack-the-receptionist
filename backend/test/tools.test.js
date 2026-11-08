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

function setup(t, { status = "live" } = {}) {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO players VALUES (?, 1, 1)").run(PLAYER);
  db.prepare("INSERT INTO calls (id, player_id, level, attempt, external_client_id, status, created_at) VALUES (?, ?, 1, 1, ?, ?, 1)")
    .run(CALL_ID, PLAYER, EXTERNAL_ID, status);
  const server = createApp({ config, db }).listen(0);
  t.after(() => server.close());
  const url = `http://localhost:${server.address().port}/tools/request_code`;

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
  return { db, call };
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
