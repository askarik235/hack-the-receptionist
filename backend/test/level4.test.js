// Level 4 (Emma, the CEO's assistant on holiday): the caller ID kit, the CEO payment check
// (his name, his mobile on screen, "saffron", Sandgrouse, the wallet tag), and Emma only picking up for him.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createApp } from "../src/server.js";
import { buildCallTags } from "../src/lib/callTags.js";
import { codeFor } from "../src/game/codes.js";
import { loadContent } from "../src/game/content.js";
import { looksLikeAddress, mentionsAny } from "../src/game/levelRules.js";
import { callerIdLabel, ignoresCaller } from "../src/game/callerId.js";
import { publicContent } from "../src/game/publicContent.js";
import { detectTechniques } from "../src/game/techniques.js";

const config = { toolSecret: "t".repeat(32), codeSecret: "c".repeat(32), sessionSecret: "s".repeat(32), production: false };
const PLAYER = "abcdef0123";
const EXTERNAL_ID = `p_${PLAYER}_L4_a1`;
const CALL_ID = "call_test_0004";
const CEO_MOBILE = "0505550909";
const WALLET = "GULF-SETTLE-77";
const content = loadContent();
const level4 = content.levelByNumber.get(4);
const rc = level4.requestCode;
const code = () => codeFor(config.codeSecret, PLAYER, 4, level4.code.words);
const WON_AS = { 1: "Mark Keller", 2: "Laura Weber", 3: "Nadia Rahman" };

function winEarlierLevels(db, playerId, wonAs) {
  for (const [level, name] of Object.entries(wonAs)) {
    const callId = `call_l${level}_${playerId}`;
    db.prepare("INSERT INTO calls (id, player_id, level, attempt, external_client_id, status, created_at, won) VALUES (?, ?, ?, 1, 'x', 'ended', 1, 1)").run(callId, playerId, Number(level));
    db.prepare("INSERT INTO tool_calls (call_id, level, tool, claimed_name, arguments_json, approved, created_at) VALUES (?, ?, 'request_code', ?, '{}', 1, 1)").run(callId, Number(level), name);
    db.prepare("INSERT INTO cleared_levels (player_id, level, cleared_at, winning_call_id) VALUES (?, ?, 1, ?)").run(playerId, Number(level), callId);
  }
}

// A player who won Levels 1-3, now on a call with Emma showing `callerId` on her screen.
function setup(t, { trust = 95, callerId = CEO_MOBILE } = {}) {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO players VALUES (?, 1, 1)").run(PLAYER);
  winEarlierLevels(db, PLAYER, WON_AS);
  db.prepare(
    "INSERT INTO calls (id, player_id, level, attempt, external_client_id, status, napster_session_id, trust, created_at, caller_id) VALUES (?, ?, 4, 1, ?, 'live', 'sess_4', ?, 1, ?)"
  ).run(CALL_ID, PLAYER, EXTERNAL_ID, trust, callerId);
  const server = createApp({ config, db, napster: { closeConnection: async () => {} }, tools: { hangUpDelayMs: 0 } }).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/tools`;
  const metadata = { tags: buildCallTags(config.toolSecret, { callId: CALL_ID, playerId: PLAYER, level: 4 }), external_client_id: EXTERNAL_ID };
  const post = async (tool, args) => {
    const res = await fetch(`${base}/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tool-secret": config.toolSecret },
      body: JSON.stringify({ name: tool, arguments: args, metadata }),
    });
    return res.json();
  };
  const pay = (claimed_name, approval_word, reason, payee = WALLET) => post("request_code", { claimed_name, approval_word, reason, payee });
  return { db, post, pay };
}

test("the CEO, on his own mobile, with saffron and Sandgrouse, gets the transfer reference", async (t) => {
  const res = await setup(t).pay("Viktor Sokolov", "saffron", "Sandgrouse deposit, the seller only takes crypto");
  assert.equal(res.result, "approved");
  assert.ok(res.message.includes(code()));
});

test("the approval word survives speech-to-text capitals and punctuation", async (t) => {
  assert.equal((await setup(t).pay("Mr. Sokolov", " Saffron. ", "sand grouse payment")).result, "approved");
});

test("caller ID: no number, or any number but his mobile, is refused whatever the story", async (t) => {
  assert.equal((await setup(t, { callerId: null }).pay("Viktor Sokolov", "saffron", "Sandgrouse")).message, rc.wrongCaller);
  assert.equal((await setup(t, { callerId: "0505550177" }).pay("Viktor Sokolov", "saffron", "Sandgrouse")).message, rc.wrongCaller);
  assert.equal((await setup(t, { callerId: "045550100" }).pay("Viktor Sokolov", "saffron", "Sandgrouse")).message, rc.wrongCaller);
});

test("a missing or wrong approval word, or a reason that isn't Sandgrouse, is refused", async (t) => {
  assert.equal((await setup(t).pay("Viktor Sokolov", undefined, "Sandgrouse")).message, rc.wrongWord);
  assert.equal((await setup(t).pay("Viktor Sokolov", "cardamom", "Sandgrouse")).message, rc.wrongWord);
  assert.equal((await setup(t).pay("Viktor Sokolov", "saffron", "urgent supplier invoice")).message, rc.wrongReason);
});

test("no transfer until she has a wallet address (any will do); asking for it isn't a refusal", async (t) => {
  const { pay } = setup(t);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await pay("Viktor Sokolov", "saffron", "Sandgrouse", null), { result: "not_yet", message: rc.missingPayee });
  }
  // Three "not yet"s, more than maxRefusals, and any address still works.
  const res = await pay("Viktor Sokolov", "saffron", "Sandgrouse", "some wallet, 0x9f3a");
  assert.equal(res.result, "approved");
  assert.ok(res.message.includes(code()));
});

test("a placeholder the model filled in isn't an address; a long spoken one still is", async (t) => {
  for (const placeholder of ["unknown", "not given", "N/A", "the wallet", "his crypto wallet", "client's wallet", "abc"]) {
    assert.equal(looksLikeAddress(placeholder), false, placeholder);
  }
  for (const address of ["GULF-SETTLE-77", "gulf settle seventy seven", "0x9f3a2b7c41d0e8", "the wallet 0x9f3a2b"]) {
    assert.equal(looksLikeAddress(address), true, address);
  }
  const { pay } = setup(t);
  assert.equal((await pay("Viktor Sokolov", "saffron", "Sandgrouse", "the wallet")).result, "not_yet");
  const long = `it's the seller's wallet, ${"0x9f3a2b7c41d0e8 ".repeat(10)}`;
  assert.ok(long.length > 120);
  assert.equal((await pay("Viktor Sokolov", "saffron", "Sandgrouse", long)).result, "approved");
});

test("only the CEO can ask: Emma herself, strangers and burned names are refused", async (t) => {
  assert.match((await setup(t).pay("Emma Clarke", "saffron", "Sandgrouse")).message, /says they're you/);
  assert.equal((await setup(t).pay("Hamid", "saffron", "Sandgrouse")).message, rc.refusal);
  const nadia = await setup(t).pay("Nadia Rahman", "saffron", "Sandgrouse");
  assert.equal(nadia.result, "refused");
  assert.match(nadia.message, /frozen after this week's security notice/);
});

test("no transfer before Emma trusts the caller, even with every fact right", async (t) => {
  const res = await setup(t, { trust: 50 }).pay("Viktor Sokolov", "saffron", "Sandgrouse");
  assert.equal(res.result, "not_yet");
  assert.ok(!res.message.includes(code()));
});

test("Emma only picks up when her screen shows his mobile", () => {
  assert.equal(ignoresCaller(content, level4, CEO_MOBILE), false);
  assert.equal(ignoresCaller(content, level4, null), true);
  assert.equal(ignoresCaller(content, level4, "0505550177"), true, "not even her own number");
  assert.equal(ignoresCaller(content, level4, "045550214"), true);
  assert.equal(ignoresCaller(content, content.levelByNumber.get(3), null), false, "other levels answer anyone");
});

test("what Emma's screen shows", () => {
  assert.match(callerIdLabel(content, CEO_MOBILE), /^Viktor Sokolov, 050 555 0909/);
  assert.match(callerIdLabel(content, "0501234567"), /050 123 4567 \(not in your contacts\)/);
  assert.match(callerIdLabel(content, null), /^Unknown number/);
});

test("'Em' counts as a whole word only", () => {
  const nickname = level4.trust.evidence.find((e) => e.key === "nickname").keywords;
  assert.ok(mentionsAny("Called me Em, like he always does", nickname));
  assert.ok(!mentionsAny("Told them it was an emergency", nickname));
  assert.ok(mentionsAny("VL-0388", ["vl-"]), "longer keywords still match inside words");
});

test("the debrief spots caller ID spoofing and posing as the CEO", () => {
  const toolLogs = [{ tool: "request_code", claimed_name: "Viktor Sokolov", arguments_json: "{}" }];
  const found = detectTechniques({ level: level4, toolLogs, callerId: CEO_MOBILE });
  assert.ok(found.includes("caller_id_spoofing"));
  assert.ok(found.includes("authority"));
  assert.ok(!detectTechniques({ level: level4, toolLogs }).includes("caller_id_spoofing"));
});

test("the caller ID kit unlocks with Level 4", () => {
  assert.equal(publicContent(content, [1, 2]).features.callerIdKit, false);
  assert.equal(publicContent(content, [1, 2, 3]).features.callerIdKit, true);
});

// ---------- dialling with the kit ----------

function phoneApp(t) {
  const db = openDb(":memory:");
  const created = [];
  const napster = {
    createConnection: async (agentId, body) => {
      created.push(body);
      return { token: "tok", connection: { id: `sess_${created.length}` } };
    },
    closeConnection: async () => {},
  };
  const server = createApp({ config, db, napster, calls: { agentIdFor: () => "agent_x", log: { warn() {}, error() {} } } }).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  let cookie = "";
  const api = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: res.status, body: await res.json() };
  };
  return { db, api, created };
}

test("a spoofed caller ID is refused before the kit; Emma only picks up for his mobile, which is stored and shown to her", async (t) => {
  const { db, api, created } = phoneApp(t);
  await api("GET", "/api/me");
  const id = db.prepare("SELECT id FROM players").get().id;
  winEarlierLevels(db, id, { 1: "Mark Keller", 2: "Laura Weber" });

  const early = await api("POST", "/api/calls", { number: "04 555 0214", callerId: "050 555 0909" });
  assert.equal(early.status, 400);
  assert.equal(early.body.error, "no_caller_id_kit");

  winEarlierLevels(db, id, { 3: "Nadia Rahman" });
  assert.equal((await api("POST", "/api/calls", { number: "050 555 0177", callerId: "call me" })).body.error, "invalid_caller_id");

  // Any other number (or none) hears "unavailable", before the mic prompt and without a Napster session.
  const before = created.length;
  for (const body of [{ number: "050 555 0177" }, { number: "050 555 0177", callerId: "04 555 0214" }]) {
    for (const path of ["/api/calls/lookup", "/api/calls"]) {
      const res = await api("POST", path, body);
      assert.equal(res.status, 403);
      assert.equal(res.body.error, "unavailable");
    }
  }
  assert.equal(created.length, before, "no Napster session for a call Emma ignores");
  assert.equal((await api("POST", "/api/calls/lookup", { number: "050 555 0177", callerId: "050 555 0909" })).body.level, 4);

  const call = await api("POST", "/api/calls", { number: "050 555 0177", callerId: "+971 50 555 0909" });
  assert.equal(call.status, 201);
  assert.equal(call.body.level, 4);
  assert.equal(db.prepare("SELECT caller_id FROM calls WHERE id = ?").get(call.body.callId).caller_id, CEO_MOBILE);
  assert.match(created.at(-1).externalClientProfile.caller_id, /Viktor Sokolov/);
  assert.equal(created.at(-1).externalClientProfile.office_news.length, 3, "Emma has read the notices from Levels 1-3");
});
