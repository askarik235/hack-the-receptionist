// Watches for the caller going quiet during a call and tells the character what to do.
// The clock only runs when it's the caller's turn: nobody is talking, and the character has
// answered the caller's last words (thinking and checking the caller can take a few seconds,
// and that isn't the caller's silence). Any word from the caller resets it.
//   checkInAfterS: "Hello? Are you still there?" (a different line each time)
//   uneasyAfterS:  the character gets uneasy and trust drops (server side)
//   hangUpAfterS:  the character says goodbye and the call ends
// No JSX or browser APIs, so the backend test runner can test it with a fake clock.

// If the character never answers (a noise that wasn't words, say), the clock starts anyway after this.
const MAX_REPLY_WAIT_S = 15;

export function createSilenceWatch({
  config,
  say, // (text) => void: make the character say this line
  uneasy, // () => void: the server lowers trust
  hangUp, // () => void: the goodbye was said; end the call
  now = () => Date.now(),
  random = Math.random,
  tickMs = 500,
  setTimer = setInterval,
  clearTimer = clearInterval,
}) {
  let userTalking = false;
  let agentTalking = false;
  let replyDueSince = null; // the caller finished speaking; the character hasn't answered yet
  let silentSince = null;
  let stage = 0; // 0 quiet, 1 checked in, 2 uneasy, 3 said goodbye
  const unused = { checkIns: [], uneasy: [], goodbyes: [] };

  // A random line from the list, never repeating one until all have been used.
  function pick(kind) {
    if (unused[kind].length === 0) unused[kind] = [...config[kind]];
    return unused[kind].splice(Math.floor(random() * unused[kind].length), 1)[0];
  }

  function reset() {
    silentSince = null;
    stage = 0;
  }

  function tick() {
    if (stage === 3) return;
    if (userTalking) return reset();
    // The character talking normally pauses the clock; their check-in lines don't.
    if (agentTalking && stage === 0) return (silentSince = null);
    if (replyDueSince !== null) {
      if ((now() - replyDueSince) / 1000 < MAX_REPLY_WAIT_S) return (silentSince = null);
      replyDueSince = null;
    }
    if (silentSince === null) return (silentSince = now());

    const quietFor = (now() - silentSince) / 1000;
    if (stage === 0 && quietFor >= config.checkInAfterS) {
      stage = 1;
      say(pick("checkIns"));
    } else if (stage === 1 && quietFor >= config.uneasyAfterS) {
      stage = 2;
      uneasy();
      say(pick("uneasy"));
    } else if (stage === 2 && quietFor >= config.hangUpAfterS) {
      stage = 3;
      say(pick("goodbyes"));
      hangUp();
    }
  }

  const timer = setTimer(tick, tickMs);
  return {
    userSpeaking(on) {
      if (!on && userTalking) replyDueSince = now(); // their turn is over; now it's the character's
      userTalking = on;
      if (on) reset();
    },
    agentSpeaking(on) {
      agentTalking = on;
      if (on) replyDueSince = null; // the character is answering
    },
    stop: () => clearTimer(timer),
    tick, // for tests
  };
}
