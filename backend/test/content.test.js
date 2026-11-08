import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContent, DEFAULT_DATA_DIR } from "../src/game/content.js";

// Copies the real content to a temp folder so a test can break one file.
function copyData() {
  const dir = mkdtempSync(join(tmpdir(), "htr-content-"));
  cpSync(DEFAULT_DATA_DIR, dir, { recursive: true, filter: (src) => !/\.db/.test(src) && !/napster-ids/.test(src) });
  return dir;
}

function editJson(dir, file, change) {
  const path = join(dir, file);
  const data = JSON.parse(readFileSync(path, "utf8"));
  change(data);
  writeFileSync(path, JSON.stringify(data));
}

test("the real game content loads and is consistent", () => {
  const content = loadContent();
  const level1 = content.levelByNumber.get(1);
  assert.equal(level1.targetId, "timur-bekov");
  assert.equal(content.staffById.get("timur-bekov").managerId, "mark-keller");
  assert.match(content.prompts.get(1), /request_code/);
  assert.deepEqual(content.phoneBook.find((e) => e.number === "045550142"), { number: "045550142", level: 1 });
});

test("Timur's prompt keeps his speech profile", () => {
  const prompt = loadContent().prompts.get(1);
  assert.match(prompt, /Mr. Keller/);
  assert.match(prompt, /stutter/);
});

test("a code-shaped string in a prompt is rejected", () => {
  const dir = copyData();
  writeFileSync(join(dir, "prompts/level-1-timur.txt"), "The code is TIDE-4471.");
  assert.throws(() => loadContent(dir), /looks like a code/);
});

test("a code-shaped string in public OSINT pages is rejected", () => {
  const dir = copyData();
  editJson(dir, "osint/pixa.json", (d) => { d.accounts[0].posts[0].caption = "gate code KANAAD-1234"; });
  assert.throws(() => loadContent(dir), /osint: public pages/);
});

test("broken references are reported", () => {
  const dir = copyData();
  editJson(dir, "levels.json", (d) => {
    d.levels[0].targetId = "nobody";
    d.phoneBook.push({ number: "045559999", level: 9 });
  });
  editJson(dir, "osint/worknet.json", (d) => { d.profiles[0].staffId = "ghost"; });
  assert.throws(() => loadContent(dir), (err) =>
    /unknown targetId nobody/.test(err.message) && /unknown level 9/.test(err.message) && /unknown staffId ghost/.test(err.message));
});

test("unknown voices and a missing prompt file are reported", () => {
  const dir = copyData();
  editJson(dir, "levels.json", (d) => {
    d.levels[0].agent.voiceId = "robot";
    d.levels[0].agent.instructionsFile = "prompts/missing.txt";
  });
  assert.throws(() => loadContent(dir), (err) => /unknown voice robot/.test(err.message) && /missing prompt file/.test(err.message));
});
