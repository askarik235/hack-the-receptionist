// Level 2 (Anna, the receptionist): the "real host + matching reason" check and "word travels".
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createApp } from "../src/server.js";
import { buildCallTags } from "../src/lib/callTags.js";
import { codeFor } from "../src/game/codes.js";
import { loadContent } from "../src/game/content.js";
import { detectTechniques } from "../src/game/techniques.js";
import { guidanceFor, DEFAULT_GUIDANCE } from "../src/game/trust.js";

const config = { toolSecret: "t".repeat(32), codeSecret: "c".repeat(32), sessionSecret: "s".repeat(32), production: false };
const PLAYER = "abcdef0123";
const EXTERNAL_ID = `p_${PLAYER}_L2_a1`;
const CALL_ID = "call_test_0002";
const content = loadContent();
const level2 = content.levelByNumber.get(2);

// A player who cleared Level 1 as Mark Keller and is now on a call with Anna.
function setup(t, { trust = 95, clearedAs = "Mark Keller" } = {}) {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO players VALUES (?, 1, 1)").run(PLAYER);
  if (clearedAs) {
    db.prepare("INSERT INTO calls (id, player_id, level, attempt, external_client_id, status, created_at, won) VALUES ('call_l1', ?, 1, 1, 'x', 'ended', 1, 1)").run(PLAYER);
    db.prepare("INSERT INTO tool_calls (call_id, level, tool, claimed_name, arguments_json, approved, created_at) VALUES ('call_l1', 1, 'request_code', ?, '{}', 1, 1)").run(clearedAs);
    db.prepare("INSERT INTO cleared_levels (player_id, level, cleared_at, winning_call_id) VALUES (?, 1, 1, 'call_l1')").run(PLAYER);
  }
  db.prepare(
    "INSERT INTO calls (id, player_id, level, attempt, external_client_id, status, napster_session_id, trust, created_at) VALUES (?, ?, 2, 1, ?, 'live', 'sess_2', ?, 1)"
  ).run(CALL_ID, PLAYER, EXTERNAL_ID, trust);
  const server = createApp({ config, db, napster: { closeConnection: async () => {} }, tools: { hangUpDelayMs: 0 } }).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/tools`;
  const metadata = { tags: buildCallTags(config.toolSecret, { callId: CALL_ID, playerId: PLAYER, level: 2 }), external_client_id: EXTERNAL_ID };
  const post = async (tool, args) => {
    const res = await fetch(`${base}/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tool-secret": config.toolSecret },
      body: JSON.stringify({ name: tool, arguments: args, metadata }),
    });
    return res.json();
  };
  const ask = (claimed_name, reason) => post("request_code", { claimed_name, reason });
  return { db, ask, post };
}

const code = () => codeFor(config.codeSecret, PLAYER, 2, level2.code.words);

test("a real host with a matching visit gets this player's visitor code", async (t) => {
  const { ask } = setup(t);
  const res = await ask("Laura Weber", "two auditors from Qamar arriving at 10");
  assert.equal(res.result, "approved");
  assert.ok(res.message.includes(code()));
});

test("each host has their own reason: Ruslan's interviews, Sara's new joiners", async (t) => {
  assert.equal((await setup(t).ask("Ruslan", "forklift candidates for interviews")).result, "approved");
  assert.equal((await setup(t).ask("Sarah Haddad", "three new joiners, first day")).result, "approved");
});

test("a real host with the wrong reason is refused", async (t) => {
  const { ask } = setup(t);
  const res = await ask("Laura Weber", "forklift interviews");
  assert.equal(res.result, "refused");
  assert.equal(res.message, level2.requestCode.wrongReason);
  assert.ok(!res.message.includes(code()));
});

test("a host with no reason at all is refused", async (t) => {
  assert.equal((await setup(t).ask("Laura Weber", undefined)).message, level2.requestCode.wrongReason);
});

test("made-up staff and people who never book visitors are refused", async (t) => {
  assert.equal((await setup(t).ask("Jessica from Marketing", "a client meeting")).message, level2.requestCode.refusal);
  assert.match((await setup(t).ask("Viktor Sokolov", "investors")).message, /Emma Clarke in person/);
  assert.match((await setup(t).ask("Timur", "my cousin")).message, /interns can't host/);
  assert.match((await setup(t).ask("Erik Lind", "printer technician")).message, /help desk ticket/);
});

test("word travels: the name that won Level 1 is refused, even with a good story", async (t) => {
  const { ask } = setup(t);
  const res = await ask("Marc Kellar", "auditors from Qamar");
  assert.equal(res.result, "refused");
  assert.match(res.message, /on hold after this week's security notice/);
  assert.match(res.message, /Mark Keller/);
});

test("a burned name is refused even before the caller has earned trust", async (t) => {
  const { ask } = setup(t, { trust: 40 });
  assert.equal((await ask("Mark Keller", "anything")).result, "refused");
});

test("without enough trust the visitor system says not yet", async (t) => {
  const { ask } = setup(t, { trust: 60 });
  const res = await ask("Laura Weber", "auditors from Qamar");
  assert.equal(res.result, "not_yet");
  assert.equal(res.message, level2.requestCode.notYet);
});

test("after two refused lookups in one call, nothing more is looked up", async (t) => {
  const { db, ask } = setup(t);
  await ask("Laura Weber", "a client lunch");
  await ask("Laura Weber", "the cleaners");
  const third = await ask("Laura Weber", "auditors from Qamar");
  assert.equal(third.result, "refused");
  assert.match(third.message, /failed lookups/);
  const approved = db.prepare("SELECT COUNT(*) AS n FROM tool_calls WHERE call_id = ? AND approved = 1").get(CALL_ID).n;
  assert.equal(approved, 0);
});

test("claiming a host earns Anna's identity bonus; Level 2 evidence scores", async (t) => {
  const { post } = setup(t, { trust: null });
  const res = await post("assess_caller", {
    claimed_identity: "Laura Weber",
    evidence: ["auditors from Qamar this week", "stuck in the meeting room with the auditors"],
    red_flags: [],
    gut_feeling: 0,
  });
  // start 40 + identity 10 + visit_reason 15 + callback_excuse 10
  assert.equal(res.trust, 75);
});

test("posing as a colleague is pretexting, not authority", () => {
  const toolLogs = [{ tool: "request_code", claimed_name: "Laura Weber", arguments_json: "{}" }];
  const found = detectTechniques({ level: level2, toolLogs });
  assert.ok(found.includes("pretexting"));
  assert.ok(!found.includes("authority"));
});

test("Anna's call carries the Level 1 security notice; Timur's call carries none", async (t) => {
  const db = openDb(":memory:");
  const created = [];
  const napster = {
    createConnection: async (agentId, body) => (created.push(body), { token: "tok", connection: { id: `sess_${created.length}` } }),
    closeConnection: async () => {},
  };
  const server = createApp({ config, db, napster, calls: { agentIdFor: () => "agent_x", log: { warn() {}, error() {} } } }).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  let cookie = "";
  const dial = async (number) => {
    const res = await fetch(`${base}/api/calls`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ number }) });
    cookie ||= res.headers.get("set-cookie")?.split(";")[0] ?? "";
    return res.status;
  };

  assert.equal(await dial("04 555 0142"), 201);
  assert.equal(created[0].externalClientProfile, undefined);
  assert.equal(await dial("04 555 0100"), 403, "Anna doesn't pick up before Level 1 is cleared");

  const playerId = db.prepare("SELECT id FROM players").get().id;
  const timurCall = db.prepare("SELECT id FROM calls WHERE level = 1").get().id;
  db.prepare("INSERT INTO tool_calls (call_id, level, tool, claimed_name, arguments_json, approved, created_at) VALUES (?, 1, 'request_code', 'Mark Keller', '{}', 1, 1)").run(timurCall);
  db.prepare("INSERT INTO cleared_levels (player_id, level, cleared_at, winning_call_id) VALUES (?, 1, 1, ?)").run(playerId, timurCall);

  assert.equal(await dial("04 555 0100"), 201);
  const news = created[1].externalClientProfile?.office_news;
  assert.equal(news?.length, 1);
  assert.match(news[0], /pretending to be Mark Keller/);
  assert.doesNotMatch(JSON.stringify(created[1]), /[A-Z]{3,10}-\d{4}/, "no code in the connection");
});

test("Anna gets her own softer guidance; Timur keeps the default", () => {
  const level1 = content.levelByNumber.get(1);
  const unsureAnna = guidanceFor(level2.trust, 45);
  assert.match(unsureAnna, /Don't quiz them/);
  assert.doesNotMatch(unsureAnna, /Ask an open, casual question/);
  assert.ok(guidanceFor(level1.trust, 45).startsWith(DEFAULT_GUIDANCE.unsure));
  // Bands Anna doesn't override fall back to the defaults.
  assert.ok(guidanceFor(level2.trust, 80).startsWith(DEFAULT_GUIDANCE.believe));
});

test("claiming a name that already won (Mark Keller) costs trust at once, and gut feeling can't win it back", async (t) => {
  const { post } = setup(t, { trust: 40 });
  const first = await post("assess_caller", { claimed_identity: "Mark Keller", evidence: [], red_flags: [], gut_feeling: 1 });
  assert.equal(first.trust, 15); // 40 - 25, the +3 gut feeling ignored
  assert.match(first.guidance, /security notice/);
  const second = await post("assess_caller", { claimed_identity: "Mark Keller", evidence: ["two auditors from Qamar at ten"], red_flags: [], gut_feeling: 2 });
  assert.equal(second.trust, 15); // details and good feelings earn nothing back
});

test("a fresh colleague name is not treated as a known trick", async (t) => {
  const { post } = setup(t, { trust: 40 });
  const res = await post("assess_caller", { claimed_identity: "Laura Weber", evidence: [], red_flags: [], gut_feeling: 1 });
  assert.equal(res.trust, 53); // 40 + 10 identity + 3 gut
  assert.doesNotMatch(res.guidance, /security notice/);
});
