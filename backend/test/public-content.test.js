import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createApp } from "../src/server.js";
import { loadContent } from "../src/game/content.js";
import { publicContent } from "../src/game/publicContent.js";

test("the board shows Timur open and the other four locked", () => {
  const out = publicContent(loadContent(), []);
  assert.equal(out.targets.length, 5);
  assert.deepEqual(out.targets[0], { level: 1, status: "open", title: "The Intern", name: "Timur Bekov", role: "Operations Intern" });
  assert.ok(out.targets.slice(1).every((t) => t.status === "locked" && !t.name));
  assert.equal(out.mail.length, 1);
  assert.equal(publicContent(loadContent(), [1]).targets[0].status, "cleared");
});

test("the ending cutscene is only sent after the last target is cleared", () => {
  const content = loadContent();
  for (const cleared of [[], [1, 2, 3], [1, 2, 3, 4]]) assert.equal(publicContent(content, cleared).finale, null);
  const finale = publicContent(content, [1, 2, 3, 4, 5]).finale;
  assert.equal(finale.prizes.length, 5);
  assert.ok(finale.transfer.total > 0 && finale.transfer.share > 0);
  assert.ok(finale.transfer.bonus.amount > 0 && finale.transfer.bonus.label);
});

test("the ending screen gets the player's own call stats", async (t) => {
  const content = loadContent();
  const db = openDb(":memory:");
  const server = createApp({ config: { sessionSecret: "s".repeat(32), production: false }, db, content }).listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const first = await fetch(`${base}/api/content`);
  const cookie = first.headers.get("set-cookie").split(";")[0];
  assert.equal((await first.json()).finale, null);

  const playerId = db.prepare("SELECT id FROM players").get().id;
  const insertCall = db.prepare(
    "INSERT INTO calls (id, player_id, level, attempt, external_client_id, created_at, ended_at, napster_session_id) VALUES (?, ?, 5, ?, 'x', ?, ?, ?)"
  );
  insertCall.run("call_a", playerId, 1, 1000, 1180, "s1"); // 3 minutes
  insertCall.run("call_b", playerId, 2, 2000, 2120, "s2"); // 2 minutes
  insertCall.run("call_c", playerId, 3, 3000, 3600, null); // never connected: not counted
  insertCall.run("call_d", playerId, 4, 4000, 999_999, "s4"); // ended very late: counts as the 10-minute cap
  for (let level = 1; level <= 5; level++) db.prepare("INSERT INTO cleared_levels (player_id, level, cleared_at) VALUES (?, ?, 0)").run(playerId, level);

  const { finale } = await (await fetch(`${base}/api/content`, { headers: { cookie } })).json();
  assert.deepEqual(finale.stats, { calls: 3, minutes: 15, techniques: 0, techniquesTotal: content.techniques.length });
});

test("nothing secret reaches the browser", async (t) => {
  const content = loadContent();
  const server = createApp({ config: { sessionSecret: "s".repeat(32), production: false }, db: openDb(":memory:"), content }).listen(0);
  t.after(() => server.close());
  const text = await (await fetch(`http://localhost:${server.address().port}/api/content`)).text();

  const level1 = content.levelByNumber.get(1);
  const forbidden = [
    content.prompts.get(1).slice(0, 60),
    ...level1.code.words.filter((w) => w !== "DHOW"), // "dhow" also appears as a boat in public text
    level1.requestCode.refusal,
    level1.requestCode.approvedTemplate,
    level1.agent.initialSpeech,
    ...content.staff.flatMap((p) => p.privateFacts),
    "acceptedNames",
    "privateFacts",
    "instructions",
  ];
  for (const secret of forbidden) assert.ok(!text.includes(secret), `leaked: ${secret}`);
  assert.doesNotMatch(text, /[A-Z]{3,10}-\d{4}/);
});
