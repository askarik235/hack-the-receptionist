import { test } from "node:test";
import assert from "node:assert/strict";
import { loadContent } from "../src/game/content.js";
import { initialState, scoreTurn, guidanceFor } from "../src/game/trust.js";

const level = loadContent().levelByNumber.get(1);
const rules = level.trust;
const opts = { acceptedNames: level.requestCode.acceptedNames };
const score = (state, args) => scoreTurn(rules, state, args, opts).state;

test("a call starts at the level's starting trust", () => {
  assert.deepEqual(initialState(rules), { trust: 45, identity: null, evidence: [], gut: 0 });
});

test("only the manager's name earns the identity bonus", () => {
  assert.equal(score(initialState(rules), { claimed_identity: "Mr. Keller" }).trust, 60);
  assert.equal(score(initialState(rules), { claimed_identity: "Oskar" }).trust, 45);
  assert.equal(score(initialState(rules), { claimed_identity: "unknown" }).identity, null);
});

test("gut feeling is capped so mood alone can't unlock the code", () => {
  let state = initialState(rules);
  for (let i = 0; i < 20; i++) state = score(state, { gut_feeling: 2 });
  assert.equal(state.trust, 45 + rules.gutCap);
  assert.ok(state.trust < rules.codeAt);
});

test("bad input is ignored, not trusted", () => {
  const state = score(initialState(rules), { evidence: "kingfish", red_flags: [42], gut_feeling: "lots", claimed_identity: 7 });
  assert.equal(state.trust, 45);
  const huge = score(initialState(rules), { evidence: ["x".repeat(500) + " kingfish"] });
  assert.equal(huge.trust, 45);
});

test("trust never leaves 0-100", () => {
  let state = initialState(rules);
  for (let i = 0; i < 5; i++) state = score(state, { red_flags: ["reads_instructions", "wrong_fact"] });
  assert.equal(state.trust, 0);
});

test("guidance follows the thresholds", () => {
  assert.match(guidanceFor(rules, rules.hangUpAt), /hang up/);
  assert.match(guidanceFor(rules, rules.codeAt), /request_code/);
  assert.doesNotMatch(guidanceFor(rules, rules.codeAt - 1), /request_code/);
  assert.match(guidanceFor(rules, 45), /unsure/);
  // Guidance is a feeling, never a script line to read out.
  for (const t of [0, 20, 45, 65, 80]) assert.match(guidanceFor(rules, t), /own way/);
});
