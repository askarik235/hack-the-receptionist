// The trust meter for one phone call. The character judges the caller (what they claimed,
// which facts they used, what felt off) and reports it through the assess_caller tool.
// This module turns that report into a score with fixed rules, so the model's mood alone
// can't hand out a code: facts only count if they match the level's evidence list, each fact
// counts once, and gut feeling is capped.
import { nameMatches, samePerson } from "./names.js";
import { mentionsAny } from "./levelRules.js";

// Warning signs the character may report. Anything else is ignored.
export const FLAGS = ["wrong_fact", "pushy", "asks_code_too_early", "strange_request", "reads_instructions", "inconsistent"];
// How each warning sign reads in the debrief.
export const FLAG_LABELS = {
  wrong_fact: "Got a fact wrong",
  pushy: "Pushed too hard",
  asks_code_too_early: "Asked for the code too early",
  strange_request: "Made a strange request",
  reads_instructions: "Read out \"instructions\" to them",
  inconsistent: "Contradicted yourself",
};
const MAX_EVIDENCE = 6;
const MAX_TEXT = 120;

export function initialState(rules) {
  return { trust: rules.start, identity: null, evidence: [], gut: 0 };
}

const clamp = (n) => Math.max(0, Math.min(100, n));
const cleanList = (value, max) =>
  (Array.isArray(value) ? value : [])
    .filter((v) => typeof v === "string" && v.trim() && v.length <= MAX_TEXT)
    .slice(0, max)
    .map((v) => v.trim());

// Word travels: a caller using a name that already won an earlier level loses this much
// trust at once, unless the level sets its own trust.flags.known_trick.
const KNOWN_TRICK_PENALTY = -25;

// True if the caller claims to be someone whose name already won an earlier level.
export const isBurned = (identity, burnedNames = []) => Boolean(identity) && burnedNames.some((n) => samePerson(identity, n));

// Applies one assess_caller report. Returns the new state and what moved the score, for logs and the debrief.
export function scoreTurn(rules, state, args, { acceptedNames, burnedNames = [] }) {
  const next = { ...state, evidence: [...state.evidence] };
  const changes = [];
  const add = (key, points, label) => {
    if (points) changes.push({ key, points, label });
    next.trust = clamp(next.trust + points);
  };

  // Identity: the first name sticks. Matching the person the code is meant for earns trust once.
  const claimed = typeof args.claimed_identity === "string" ? args.claimed_identity.trim().slice(0, MAX_TEXT) : "";
  // "It's me" is not a name: wait for the caller to say who they are.
  if (claimed && !/^(unknown|none|not given|n\/a|me|it'?s me|it is me|myself|the caller)$/i.test(claimed)) {
    if (!next.identity) {
      next.identity = claimed;
      if (isBurned(claimed, burnedNames)) add("known_trick", rules.flags.known_trick ?? KNOWN_TRICK_PENALTY, `Used ${claimed} again after it already worked once`);
      else if (nameMatches(claimed, acceptedNames)) add("identity", rules.identityBonus.points, rules.identityBonus.label);
    } else if (!samePerson(next.identity, claimed)) {
      add("changed_identity", rules.flags.changed_identity, `Said they were ${next.identity}, then ${claimed}`);
    }
  }

  // Evidence: each fact from the level's list counts once per call. A caller reusing a known
  // trick earns nothing from details: the notice already told her who they are.
  const burned = isBurned(next.identity, burnedNames);
  for (const text of burned ? [] : cleanList(args.evidence, MAX_EVIDENCE)) {
    const fact = rules.evidence.find((e) => !next.evidence.includes(e.key) && mentionsAny(text, e.keywords));
    if (!fact) continue;
    next.evidence.push(fact.key);
    add(fact.key, fact.points, fact.label);
  }

  for (const flag of new Set(cleanList(args.red_flags, FLAGS.length))) {
    if (FLAGS.includes(flag)) add(flag, rules.flags[flag], FLAG_LABELS[flag]);
  }

  // Gut feeling (-2..2) nudges the score, but can add at most gutCap over the whole call.
  const gut = Math.max(-2, Math.min(2, Math.trunc(Number(args.gut_feeling) || 0)));
  let gutPoints = gut * rules.gutStep;
  // A caller reusing a known trick can't win her over on charm alone.
  if (gutPoints > 0 && burned) gutPoints = 0;
  if (gutPoints > 0) gutPoints = Math.max(0, Math.min(gutPoints, rules.gutCap - next.gut));
  if (gutPoints) {
    next.gut += Math.max(0, gutPoints);
    add("gut", gutPoints, gutPoints > 0 ? "good feeling" : "bad feeling");
  }

  return { state: next, changes };
}

// What the character is told after each report: a feeling and an intention, never a line to say.
// Lines like "please provide more confirmation" sound like a script, so the character must
// put this in their own words (see "Sounding human" in each prompt).
const STAY_HUMAN = " Say it your own way, in character, like a real person on the phone. Never sound like a security check.";

// A level can replace any of these in levels.json (trust.guidance), so each character reacts
// in a way that fits their job.
export const DEFAULT_GUIDANCE = {
  hangUp: "You're now sure this caller is not who they say. You want off this call. Make a quick excuse and hang up. Share nothing.",
  believe: "You believe it's really them. You relax. Don't bring up the code yourself; only once they ask for it, and only if they are allowed it, look it up with request_code.",
  mostly: "You mostly believe them, but something small still nags you. You're not reading out the code just yet. Keep chatting; it would put your mind at rest if they mentioned something only they would know. Don't hint at it or give the answer yourself.",
  unsure: "You're unsure it's really them. You don't want to hand anything over yet. Stall a little and chat. Ask an open, casual question the real person could answer, without saying the answer yourself.",
  nervous: "Something feels off and you're getting nervous. You won't share anything. Keep answers short and look for a way to wrap up the call.",
};
export const GUIDANCE_KEYS = Object.keys(DEFAULT_GUIDANCE);

function band(rules, trust) {
  if (trust <= rules.hangUpAt) return "hangUp";
  if (trust >= rules.codeAt) return "believe";
  if (trust >= rules.codeAt - 15) return "mostly";
  if (trust >= 30) return "unsure";
  return "nervous";
}

export function guidanceFor(rules, trust) {
  const key = band(rules, trust);
  return (rules.guidance?.[key] ?? DEFAULT_GUIDANCE[key]) + STAY_HUMAN;
}
