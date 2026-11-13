// Level 3 (Erik, IT help desk): the "employee ID + department" reset check, the HACK hint,
// and VitalNet Mail (the inbox the password opens).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createApp } from "../src/server.js";
import { buildCallTags } from "../src/lib/callTags.js";
import { codeFor } from "../src/game/codes.js";
import { loadContent } from "../src/game/content.js";
import { employeeIdDigits } from "../src/game/levelRules.js";
import { normalizeUsername } from "../src/mail/router.js";

const config = { toolSecret: "t".repeat(32), codeSecret: "c".repeat(32), sessionSecret: "s".repeat(32), production: false };
const PLAYER = "abcdef0123";
const EXTERNAL_ID = `p_${PLAYER}_L3_a1`;
const CALL_ID = "call_test_0003";
const content = loadContent();
const level3 = content.levelByNumber.get(3);
const rc = level3.requestCode;
const code = (playerId = PLAYER) => codeFor(config.codeSecret, playerId, 3, level3.code.words);

// Marks levels as won by the given names (word travels reads these).
function winEarlierLevels(db, playerId, wonAs) {
  for (const [level, name] of Object.entries(wonAs)) {
    const callId = `call_l${level}`;
    db.prepare("INSERT INTO calls (id, player_id, level, attempt, external_client_id, status, created_at, won) VALUES (?, ?, ?, 1, 'x', 'ended', 1, 1)").run(callId, playerId, Number(level));
    db.prepare("INSERT INTO tool_calls (call_id, level, tool, claimed_name, arguments_json, approved, created_at) VALUES (?, ?, 'request_code', ?, '{}', 1, 1)").run(callId, Number(level), name);
    db.prepare("INSERT INTO cleared_levels (player_id, level, cleared_at, winning_call_id) VALUES (?, ?, 1, ?)").run(playerId, Number(level), callId);
  }
}

// A player who won Level 1 as Mark Keller and Level 2 as Laura Weber, now on a call with Erik.
function setup(t, { trust = 95 } = {}) {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO players VALUES (?, 1, 1)").run(PLAYER);
  winEarlierLevels(db, PLAYER, { 1: "Mark Keller", 2: "Laura Weber" });
  db.prepare(
    "INSERT INTO calls (id, player_id, level, attempt, external_client_id, status, napster_session_id, trust, created_at) VALUES (?, ?, 3, 1, ?, 'live', 'sess_3', ?, 1)"
  ).run(CALL_ID, PLAYER, EXTERNAL_ID, trust);
  const server = createApp({ config, db, napster: { closeConnection: async () => {} }, tools: { hangUpDelayMs: 0 } }).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/tools`;
  const metadata = { tags: buildCallTags(config.toolSecret, { callId: CALL_ID, playerId: PLAYER, level: 3 }), external_client_id: EXTERNAL_ID };
  const ask = async (claimed_name, employee_id, department) => {
    const res = await fetch(`${base}/request_code`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tool-secret": config.toolSecret },
      body: JSON.stringify({ name: "request_code", arguments: { claimed_name, employee_id, department, reason: "locked out" }, metadata }),
    });
    return res.json();
  };
  return { db, ask };
}

test("Nadia with her real employee ID and department gets this player's temporary password", async (t) => {
  const res = await setup(t).ask("Nadia Rahman", "VL-0388", "Executive Office");
  assert.equal(res.result, "approved");
  assert.ok(res.message.includes(code()));
});

test("employee IDs are matched on their digits, however speech-to-text wrote them", async (t) => {
  assert.equal(employeeIdDigits("VL-0388"), "0388");
  assert.equal(employeeIdDigits("v l 0 3 8 8"), "0388");
  assert.equal(employeeIdDigits("388"), null);
  assert.equal(employeeIdDigits(undefined), null);
  assert.equal((await setup(t).ask("nadia", "vl 0388", "the executive office")).result, "approved");
});

test("a missing ID, a wrong ID or a wrong department are refused, each with its own reason", async (t) => {
  assert.equal((await setup(t).ask("Nadia Rahman", undefined, "Executive Office")).message, rc.missingId);
  assert.equal((await setup(t).ask("Nadia Rahman", "VL-0383", "Executive Office")).message, rc.wrongId);
  assert.equal((await setup(t).ask("Nadia Rahman", "VL-0388", "Finance")).message, rc.wrongDepartment);
  assert.equal((await setup(t).ask("Nadia Rahman", "VL-0388", undefined)).message, rc.wrongDepartment);
});

test("only Nadia has a pending reset; executives and Erik himself get their own refusals", async (t) => {
  assert.equal((await setup(t).ask("Timur Bekov", "VL-0412", "Operations")).message, rc.refusal);
  assert.match((await setup(t).ask("Emma Clarke", "VL-0001", "Executive Office")).message, /executive accounts/);
  assert.match((await setup(t).ask("Mr. Sokolov", "VL-0001", "Executive Office")).message, /executive accounts/);
  assert.match((await setup(t).ask("Erik Lind", "VL-0094", "IT")).message, /your own account/);
});

test("word travels: the names that won Levels 1 and 2 are frozen", async (t) => {
  const laura = await setup(t).ask("Laura Weber", "VL-0233", "Finance");
  assert.equal(laura.result, "refused");
  assert.match(laura.message, /frozen after this week's security notice/);
  assert.equal((await setup(t).ask("Mark Keller", "VL-0001", "Operations")).result, "refused");
});

test("no password before Erik trusts the caller, even with perfect details", async (t) => {
  const res = await setup(t, { trust: 40 }).ask("Nadia Rahman", "VL-0388", "Executive Office");
  assert.equal(res.result, "not_yet");
  assert.ok(!res.message.includes(code()));
});

// ---------- HACK + VitalNet Mail ----------

function playerApp(t) {
  const db = openDb(":memory:");
  const server = createApp({ config, db }).listen(0);
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
  return { db, api };
}

// A browser player who won Levels 1-2 and whose Level 3 call got the password from Erik.
async function playerWithPassword(t) {
  const { db, api } = playerApp(t);
  await api("GET", "/api/me");
  const id = db.prepare("SELECT id FROM players").get().id;
  winEarlierLevels(db, id, { 1: "Mark Keller", 2: "Laura Weber" });
  db.prepare("INSERT INTO calls (id, player_id, level, attempt, external_client_id, status, created_at) VALUES ('call_l3', ?, 3, 1, 'x', 'ended', 2)").run(id);
  db.prepare("INSERT INTO tool_calls (call_id, level, tool, claimed_name, arguments_json, approved, created_at) VALUES ('call_l3', 3, 'request_code', 'Nadia Rahman', '{}', 1, 2)").run();
  return { db, api, password: code(id) };
}

test("the password clears Level 3 in HACK, and HACK points the player to VitalNet Mail", async (t) => {
  const { api, password } = await playerWithPassword(t);
  const res = await api("POST", "/api/hack", { code: password });
  assert.equal(res.body.result, "granted");
  assert.equal(res.body.level, 3);
  assert.match(res.body.afterHack, /mail\.vitality-logistics\.ae/);
});

test("VitalNet Mail opens Nadia's inbox only after HACK, and only with this player's password", async (t) => {
  const { api, password } = await playerWithPassword(t);
  const login = (username, pw) => api("POST", "/api/mail/login", { username, password: pw });

  assert.equal((await login("nadia.rahman", password)).status, 401, "not before the level is cleared in HACK");
  await api("POST", "/api/hack", { code: password });

  const ok = await login("Nadia.Rahman@vitality-logistics.ae", password.toLowerCase().replace("-", " "));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.address, "nadia.rahman@vitality-logistics.ae");
  assert.equal(ok.body.emails.length, 8);
  assert.ok(ok.body.emails.some((e) => e.id === "ceo-forward"));

  const wrongPassword = await login("nadia.rahman", code("someoneelse"));
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.body.error, "wrong_login");
  assert.equal((await login("emma.clarke", password)).status, 401);
  assert.equal((await login("nadia", password)).status, 400);
});

test("the inbox is never part of the public content", async (t) => {
  const { api } = await playerWithPassword(t);
  const body = JSON.stringify((await api("GET", "/api/content")).body);
  for (const secret of ["saffron", "enjoy Muscat", "Sandgrouse folder locked", "88214", "inbox/nadia", "Al Noor"]) assert.ok(!body.includes(secret), `leaked: ${secret}`);
  assert.ok(body.includes("new-joiner-guide-2024.pdf"), "the leaked PDF is public on purpose");
});

test("usernames are normalised, everything else is rejected", () => {
  assert.equal(normalizeUsername(" Nadia.Rahman@vitality-logistics.ae "), "nadia.rahman");
  assert.equal(normalizeUsername("nadia"), null);
  assert.equal(normalizeUsername("x".repeat(100)), null);
  assert.equal(normalizeUsername(42), null);
});
