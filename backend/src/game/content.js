// Loads game content (staff, levels, OSINT pages, agent prompts) from backend/data and checks
// that it is consistent. Called once at startup; a broken content file stops the server early.
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
    check(typeof requestCode.check === "string", `${where}: requestCode.check is missing`);
    check(requestCode.acceptedNames.every((n) => n === n.toLowerCase().trim() && n.length > 0), `${where}: acceptedNames must be lowercase`);
    check(typeof requestCode.approvedTemplate === "string" && requestCode.approvedTemplate.includes("{code}"), `${where}: approvedTemplate needs {code}`);
    check(typeof requestCode.refusal === "string" && !CODE_LIKE.test(requestCode.refusal), `${where}: bad refusal text`);
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

  if (problems.length > 0) throw new Error(`Game content is invalid:\n- ${problems.join("\n- ")}`);

  return Object.freeze({ company, staff, staffById, levels, levelByNumber, phoneBook, osint, prompts });
}
