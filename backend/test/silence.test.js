// Tests the phone's silence watcher (frontend/src/phone/silenceWatch.js) with a fake clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSilenceWatch } from "../../frontend/src/phone/silenceWatch.js";
import { loadContent } from "../src/game/content.js";

const config = loadContent().levelByNumber.get(1).silence;

function setup() {
  let clock = 0;
  const events = [];
  const watch = createSilenceWatch({
    config,
    say: (text) => events.push(["say", text]),
    uneasy: () => events.push(["uneasy"]),
    hangUp: () => events.push(["hangUp"]),
    now: () => clock,
    setTimer: () => 0,
    clearTimer: () => {},
  });
  // Moves the fake clock forward in half-second ticks.
  const wait = (seconds) => {
    for (let t = 0; t < seconds * 2; t++) {
      clock += 500;
      watch.tick();
    }
  };
  return { watch, events, wait };
}

test("silence: check in, get uneasy, then say goodbye and hang up", () => {
  const { events, wait } = setup();
  wait(config.checkInAfterS + 1);
  assert.equal(events.length, 1);
  assert.ok(config.checkIns.includes(events[0][1]));
  wait(config.uneasyAfterS - config.checkInAfterS);
  assert.deepEqual(events[1], ["uneasy"]);
  assert.ok(config.uneasy.includes(events[2][1]));
  wait(config.hangUpAfterS - config.uneasyAfterS);
  assert.ok(config.goodbyes.includes(events[3][1]));
  assert.deepEqual(events[4], ["hangUp"]);
  wait(30);
  assert.equal(events.length, 5, "nothing after hanging up");
});

test("speaking resets the clock; the character talking pauses it", () => {
  const { watch, events, wait } = setup();
  watch.agentSpeaking(true);
  wait(30);
  assert.equal(events.length, 0, "no check-in while the character is talking");
  watch.agentSpeaking(false);
  wait(config.checkInAfterS + 1);
  assert.equal(events.length, 1);
  watch.userSpeaking(true);
  wait(30);
  watch.userSpeaking(false);
  assert.equal(events.length, 1, "no warnings while the caller talks");
  reply(watch);
  wait(config.checkInAfterS + 1);
  assert.equal(events.length, 2, "a new silence starts over with a check-in");
});

// The character answers: starts talking, then stops.
function reply(watch) {
  watch.agentSpeaking(true);
  watch.agentSpeaking(false);
}

test("the character thinking before a reply is not the caller's silence", () => {
  const { watch, events, wait } = setup();
  watch.userSpeaking(true);
  watch.userSpeaking(false);
  wait(config.checkInAfterS + 4); // checking the caller, then the reply starts
  assert.equal(events.length, 0, "no 'hello?' while the character is still working out an answer");
  reply(watch);
  wait(config.checkInAfterS - 1);
  assert.equal(events.length, 0);
  wait(2);
  assert.equal(events.length, 1, "after the reply, the caller's turn is timed as usual");
});

test("if the character never replies, the clock starts anyway", () => {
  const { watch, events, wait } = setup();
  watch.userSpeaking(true);
  watch.userSpeaking(false);
  wait(15 + config.checkInAfterS + 1);
  assert.equal(events.length, 1);
});

test("check-in lines don't repeat until all have been used", () => {
  const { watch, events, wait } = setup();
  for (let i = 0; i < config.checkIns.length; i++) {
    wait(config.checkInAfterS + 1);
    watch.userSpeaking(true);
    watch.userSpeaking(false);
    reply(watch);
  }
  const said = events.map((e) => e[1]);
  assert.equal(new Set(said).size, config.checkIns.length);
});
