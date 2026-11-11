// Loads game content (staff, levels, OSINT pages, agent prompts) from backend/data and checks
// that it is consistent. Called once at startup; a broken content file stops the server early.
import { FLAGS as TRUST_FLAGS, GUIDANCE_KEYS as TRUST_GUIDANCE_KEYS } from "./trust.js";
import { TECHNIQUE_IDS } from "./techniques.js";
import { CHECK_TYPES } from "./levelRules.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");

// Voices listed in the Napster docs (Agent Configuration > Voice).
export const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"];

// Anything shaped like a level code (WORD-1234). Must never appear in prompts or public pages.
const CODE_LIKE = /\b[A-Z]{3,10}-\d{4}\b/;

function readText(path) {
  return readFileSync(path, "utf8").replace(/^﻿/, "");
}

function readJson(dir, file) {
  try {
    return JSON.parse(readText(join(dir, file)));
  } catch (err) {
    throw new Error(`Content file ${file}: ${err.message}`);
  }
}

export function loadContent(dataDir = DEFAULT_DATA_DIR) {
  const { company, staff } = readJson(dataDir, "staff.json");
  const { phoneBook, levels } = readJson(dataDir, "levels.json");
  const osint = {
    website: readJson(dataDir, "osint/website.json"),
    worknet: readJson(dataDir, "osint/worknet.json"),
    pixa: readJson(dataDir, "osint/pixa.json"),
  };
  const { techniques } = readJson(dataDir, "techniques.json");

  const problems = [];
  const check = (ok, message) => { if (!ok) problems.push(message); };

  const staffById = new Map();
  for (const person of staff) {
    check(!staffById.has(person.id), `staff: duplicate id ${person.id}`);
    staffById.set(person.id, person);
  }
  for (const person of staff) {
    check(person.managerId === null || staffById.has(person.managerId), `staff ${person.id}: unknown managerId ${person.managerId}`);
    check(["male", "female"].includes(person.gender), `staff ${person.id}: gender must be male or female`);
  }

  const levelByNumber = new Map();
  const prompts = new Map();
  const usedVoices = new Set();
  for (const level of levels) {
    const where = `level ${level.level}`;
    check(!levelByNumber.has(level.level), `${where}: duplicate level number`);
    levelByNumber.set(level.level, level);

    const target = staffById.get(level.targetId);
    check(target, `${where}: unknown targetId ${level.targetId}`);
    check(!target || target.level === level.level, `${where}: target's level does not match`);

    const { agent } = level;
    check(VOICES.includes(agent.voiceId), `${where}: unknown voice ${agent.voiceId}`);
    check(!usedVoices.has(agent.voiceId), `${where}: voice ${agent.voiceId} already used by another character`);
    usedVoices.add(agent.voiceId);
    check(typeof agent.temperature === "number" && agent.temperature >= 0 && agent.temperature <= 2, `${where}: bad temperature`);

    let instructions = null;
    try {
      instructions = readText(join(dataDir, agent.instructionsFile)).trim();
    } catch {
      problems.push(`${where}: missing prompt file ${agent.instructionsFile}`);
    }
    if (instructions !== null) check(instructions.length > 0, `${where}: empty prompt file`);
    instructions ??= "";
    check(!CODE_LIKE.test(instructions), `${where}: prompt contains something that looks like a code`);
    prompts.set(level.level, instructions);

    check(level.code.words.length > 0 && level.code.words.every((w) => /^[A-Z]{3,10}$/.test(w)), `${where}: code words must be 3-10 uppercase letters`);
    const { requestCode } = level;
    const nameList = (list) => Array.isArray(list) && list.length > 0 && list.every((n) => typeof n === "string" && n === n.toLowerCase().trim() && n.length > 0);
    const text = (value) => typeof value === "string" && value.trim().length > 0 && !CODE_LIKE.test(value);
    check(CHECK_TYPES.includes(requestCode.check), `${where}: unknown requestCode.check ${requestCode.check}`);
    if (requestCode.check === "manager_name") check(nameList(requestCode.acceptedNames), `${where}: acceptedNames must be lowercase`);
    if (requestCode.check === "host_with_reason") {
      check(Array.isArray(requestCode.hosts) && requestCode.hosts.length > 0, `${where}: requestCode.hosts is missing`);
      for (const host of requestCode.hosts ?? []) {
        check(staffById.has(host.staffId), `${where}: unknown host ${host.staffId}`);
        check(nameList(host.names), `${where}: host ${host.staffId} names must be lowercase`);
        check(nameList(host.reasonKeywords), `${where}: host ${host.staffId} reasonKeywords must be lowercase`);
      }
      check(text(requestCode.wrongReason), `${where}: bad wrongReason text`);
      for (const r of requestCode.refusalsFor ?? []) check(nameList(r.names) && text(r.message), `${where}: bad refusalsFor entry`);
    }
    check(typeof requestCode.approvedTemplate === "string" && requestCode.approvedTemplate.includes("{code}"), `${where}: approvedTemplate needs {code}`);
    check(text(requestCode.refusal), `${where}: bad refusal text`);
    for (const field of ["notYet", "burned"]) check(requestCode[field] === undefined || text(requestCode[field]), `${where}: bad ${field} text`);
    check(requestCode.maxRefusals === undefined || (Number.isInteger(requestCode.maxRefusals) && requestCode.maxRefusals > 0), `${where}: maxRefusals must be a positive number`);
    check(level.rumour === undefined || text(level.rumour), `${where}: bad rumour text`);

    const { trust } = level;
    const pct = (n) => Number.isInteger(n) && n >= 0 && n <= 100;
    check(trust && pct(trust.start) && pct(trust.codeAt) && pct(trust.hangUpAt), `${where}: trust needs start, codeAt and hangUpAt (0-100)`);
    if (trust) {
      check(trust.hangUpAt < trust.start && trust.start < trust.codeAt, `${where}: trust must be hangUpAt < start < codeAt`);
      check(Number.isInteger(trust.identityBonus?.points), `${where}: trust.identityBonus.points is missing`);
      const keys = new Set();
      for (const e of trust.evidence ?? []) {
        check(!keys.has(e.key), `${where}: duplicate evidence key ${e.key}`);
        keys.add(e.key);
        check(Number.isInteger(e.points) && e.points > 0, `${where}: evidence ${e.key} needs positive points`);
        check(e.keywords?.length > 0 && e.keywords.every((k) => k === k.toLowerCase() && k.trim()), `${where}: evidence ${e.key} keywords must be lowercase`);
      }
      for (const flag of ["changed_identity", ...TRUST_FLAGS]) check(Number.isInteger(trust.flags?.[flag]) && trust.flags[flag] < 0, `${where}: trust.flags.${flag} must be negative`);
      const knownTrick = trust.flags?.known_trick;
      check(knownTrick === undefined || (Number.isInteger(knownTrick) && knownTrick < 0), `${where}: trust.flags.known_trick must be negative`);
      check(Number.isInteger(trust.gutStep) && Number.isInteger(trust.gutCap), `${where}: trust needs gutStep and gutCap`);
      for (const [key, value] of Object.entries(trust.guidance ?? {})) {
        check(TRUST_GUIDANCE_KEYS.includes(key), `${where}: unknown trust.guidance.${key}`);
        check(text(value), `${where}: bad trust.guidance.${key} text`);
      }
    }

    const { silence } = level;
    const lines = (list, min) => Array.isArray(list) && list.length >= min && list.every((t) => typeof t === "string" && t.trim() && t.length <= 160);
    check(
      silence && 0 < silence.checkInAfterS && silence.checkInAfterS < silence.uneasyAfterS && silence.uneasyAfterS < silence.hangUpAfterS,
      `${where}: silence needs checkInAfterS < uneasyAfterS < hangUpAfterS`
    );
    if (silence) {
      check(Number.isInteger(silence.penalty) && silence.penalty > 0, `${where}: silence.penalty must be a positive number`);
      check(lines(silence.checkIns, 2) && lines(silence.uneasy, 1) && lines(silence.goodbyes, 1), `${where}: silence needs checkIns, uneasy and goodbyes lines`);
    }
  }

  const numbers = new Set();
  for (const entry of phoneBook) {
    check(/^0\d{8}$/.test(entry.number), `phoneBook: bad number ${entry.number}`);
    check(!numbers.has(entry.number), `phoneBook: duplicate number ${entry.number}`);
    check(levelByNumber.has(entry.level), `phoneBook: ${entry.number} points to unknown level ${entry.level}`);
    numbers.add(entry.number);
  }

  const osintStaffIds = [
    ...osint.website.pages.team.members.map((m) => m.staffId),
    ...osint.worknet.profiles.map((p) => p.staffId),
    ...osint.pixa.accounts.map((a) => a.staffId),
  ];
  for (const id of osintStaffIds) check(id === null || staffById.has(id), `osint: unknown staffId ${id}`);
  check(!CODE_LIKE.test(JSON.stringify(osint)), "osint: public pages contain something that looks like a code");

  const techniqueIds = new Set();
  for (const t of techniques) {
    check(!techniqueIds.has(t.id), `techniques: duplicate id ${t.id}`);
    techniqueIds.add(t.id);
    check(["name", "whatYouDid", "realWorld", "defence", "category"].every((f) => typeof t[f] === "string" && t[f]), `techniques: ${t.id} is missing text`);
  }
  for (const id of TECHNIQUE_IDS) check(techniqueIds.has(id), `techniques: no entry for detected technique ${id}`);

  if (problems.length > 0) throw new Error(`Game content is invalid:\n- ${problems.join("\n- ")}`);

  return Object.freeze({ company, staff, staffById, levels, levelByNumber, phoneBook, osint, prompts, techniques });
}
