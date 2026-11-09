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
