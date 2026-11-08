import { test } from "node:test";
import assert from "node:assert/strict";
import { codeFor, codesMatch, normalizeCode } from "../src/game/codes.js";
import { nameMatches, normalizeName } from "../src/game/names.js";
import { loadContent } from "../src/game/content.js";
import { CHECK_TYPES } from "../src/tools/router.js";

const WORDS = ["KANAAD", "TIDE", "REEF"];

test("codes are per player and level, stable, and in WORD-1234 format", () => {
  const a = codeFor("secret-1234567890", "abcdef0123", 1, WORDS);
  assert.match(a, /^(KANAAD|TIDE|REEF)-\d{4}$/);
  assert.equal(codeFor("secret-1234567890", "abcdef0123", 1, WORDS), a);
  assert.notEqual(codeFor("secret-1234567890", "abcdef0124", 1, WORDS), a);
  assert.notEqual(codeFor("other-secret-12345", "abcdef0123", 1, WORDS), a);
});

test("typed codes are matched leniently on format, strictly on content", () => {
  assert.equal(normalizeCode(" kanaad 4471 "), "KANAAD-4471");
  assert.equal(normalizeCode("Kanaad4471"), "KANAAD-4471");
  assert.equal(normalizeCode("KANAAD-447"), null);
  assert.equal(normalizeCode("x".repeat(100)), null);
  assert.equal(normalizeCode(42), null);
  assert.ok(codesMatch("KANAAD-4471", "kanaad 4471"));
  assert.ok(!codesMatch("KANAAD-4471", "KANAAD-4472"));
  assert.ok(!codesMatch("KANAAD-4471", ""));
});

test("manager name matching survives speech-recognition spelling", () => {
  const accepted = loadContent().levelByNumber.get(1).requestCode.acceptedNames;
  for (const said of ["Mark", "mark keller", "Mr. Keller", "Marc Kellar", "MARK KELLER here", "Mark Kéller", "Mark Kellr"]) {
    assert.ok(nameMatches(said, accepted), `should accept "${said}"`);
  }
  for (const said of ["Viktor Sokolov", "Timur", "IT department", "", "Markus Schmidt", "Mike"]) {
    assert.ok(!nameMatches(said, accepted), `should refuse "${said}"`);
  }
  assert.equal(normalizeName("  Dr. Mark-Keller! "), "mark keller");
});

test("every level uses a check the tool endpoint knows", () => {
  for (const level of loadContent().levels) assert.ok(CHECK_TYPES.includes(level.requestCode.check), level.requestCode.check);
});
