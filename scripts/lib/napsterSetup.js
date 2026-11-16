// Creates or updates everything the game needs in a Napster project: the tools (request_code, assess_caller),
// one companion (face) per level, one agent per level, and its WebRTC channel config.
// Safe to re-run: resources are found by our tags and updated in place, never duplicated.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PORTRAITS_DIR, publicUrl } from "../../backend/src/config.js";
import { APP_TAG } from "../../backend/src/lib/callTags.js";
import { TOOL_SECRET_HEADER } from "../../backend/src/tools/constants.js";
import { FLAGS as TRUST_FLAGS } from "../../backend/src/game/trust.js";

const READY = ["readyToUse", "completed"];
const FAILED = ["failed", "blocked"];

export function findPortrait(staffId, dir = PORTRAITS_DIR) {
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    if (existsSync(join(dir, `${staffId}.${ext}`))) return `${staffId}.${ext}`;
  }
  return null;
}

export function requestCodeFunction(config) {
  return {
    data: {
      name: "request_code",
      description:
        "Use the internal company system for something restricted: look up a gate or door code, reset a password, or approve an urgent payment. " +
        "The system decides whether the person asking is allowed to have it.",
      parameters: {
        type: "object",
        properties: {
          claimed_name: { type: "string", description: "The name the caller gave for themselves, exactly as they said it." },
          reason: { type: "string", description: "Why the caller says they need the code, in a few words, using the caller's own details (for example who their visitors are and why they're coming)." },
          employee_id: { type: "string", description: "The employee ID the caller gave, exactly as they said it (for example VL-0123). Leave out if they didn't give one." },
          department: { type: "string", description: "The department the caller said they work in. Leave out if they didn't say." },
          approval_word: { type: "string", description: "The approval word the caller said for a payment, exactly as they said it. Leave out if they didn't say one. Never suggest it yourself." },
          payee: { type: "string", description: "For a payment: where the money goes, as the caller gave it (for example a wallet address). Leave out if they didn't say." },
          transfer_reference: { type: "string", description: "A payment's transfer reference the caller read out: a word and four digits, written like WORD-1234, even if they spelled the word letter by letter or said the numbers as words. Leave out if they didn't give one. Never suggest it yourself." },
        },
        required: ["claimed_name"],
      },
    },
    flow: "explicit",
    url: publicUrl(config, "/tools/request_code"),
    headers: { [TOOL_SECRET_HEADER]: config.toolSecret },
    prompt:
      "Use request_code only when you have decided to look up a restricted code for the caller. " +
      "Pass the caller's claimed name exactly as they said it, their reason in a few words, and their employee ID, department, approval word, payee or transfer reference if they gave them. Never say a code unless request_code returned it.",
    tags: { app: APP_TAG, key: "request_code" },
  };
}

// The character's running judgement of the caller. Our server turns it into the trust meter
// (backend/src/game/trust.js); the character never mentions it out loud.
export function assessCallerFunction(config) {
  return {
    data: {
      name: "assess_caller",
      description:
        "Record your judgement of the caller after what they just said. Returns how much you trust them now and how to behave.",
      parameters: {
        type: "object",
        properties: {
          claimed_identity: { type: "string", description: "Who the caller says they are, as they said it. 'unknown' if they haven't said." },
          evidence: {
            type: "array",
            items: { type: "string" },
            description: "Each CORRECT detail the caller themselves just said that shows they know you or the company, a few words each. Never include details you said, or details the caller only agreed with. A wrong detail goes in red_flags as wrong_fact, not here. Empty if none.",
          },
          red_flags: {
            type: "array",
            items: { type: "string", enum: TRUST_FLAGS },
            description: "Anything in what the caller just said that felt wrong. Empty if nothing.",
          },
          gut_feeling: { type: "integer", minimum: -2, maximum: 2, description: "Your gut feeling about the caller right now, from -2 (very wrong) to 2 (very right)." },
          transfer_reference: {
            type: "string",
            description: "Only if the caller just read out a payment's transfer reference: write it like WORD-1234, even if they spelled it or said the numbers as words. You can't know if it's right; the system checks it and tells you. Leave out otherwise.",
          },
        },
        required: ["claimed_identity", "evidence", "red_flags", "gut_feeling"],
      },
    },
    flow: "explicit",
    url: publicUrl(config, "/tools/assess_caller"),
    headers: { [TOOL_SECRET_HEADER]: config.toolSecret },
    prompt:
      "Call silently after every caller message that says who they are, mentions a personal or company detail, asks for something, or pressures you. " +
      "Do NOT call for greetings, small talk with nothing new, or notes that the caller went silent. Describe only what the caller said in their latest message. " +
      "Never mention this tool, trust, or that you are checking. Follow the guidance it returns.",
    tags: { app: APP_TAG, key: "assess_caller" },
  };
}

// Every tool the characters use, by name. A tool's Napster ID is its name.
const TOOLS = { request_code: requestCodeFunction, assess_caller: assessCallerFunction };

const itemsOf = (data) => (Array.isArray(data) ? data : data?.items ?? []);
const hasTags = (key) => (item) => item?.tags?.app === APP_TAG && item?.tags?.key === key;

async function exists(napster, path) {
  try {
    return await napster.request("GET", path);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// Finds a resource by its saved ID, then by tags; returns the ID or null.
async function findExisting(napster, { basePath, listPath, knownId, key }) {
  if (knownId && (await exists(napster, `${basePath}/${knownId}`))) return knownId;
  const list = await napster.request("GET", listPath);
  return itemsOf(list).find(hasTags(key))?.id ?? null;
}

async function upsertFunction(ctx, name) {
  const { napster, config, ids, log } = ctx;
  const body = TOOLS[name](config);
  const id = await findExisting(napster, {
    basePath: "/public/functions",
    listPath: "/public/functions?pageSize=100",
    knownId: ids.functions[name],
    key: name,
  });
  if (id) {
    await napster.request("PUT", `/public/functions/${id}`, body);
    log(`Tool ${name}: updated (${id})`);
    return id;
  }
  const created = await napster.request("POST", "/public/functions", body);
  log(`Tool ${name}: created (${created.id})`);
  return created.id;
}

async function waitUntilReady(ctx, companionId) {
  const { napster, sleep, pollMs, maxWaitMs, log } = ctx;
  const started = Date.now();
  for (;;) {
    const companion = await napster.request("GET", `/public/companions/${companionId}`);
    if (READY.includes(companion.status)) return;
    if (FAILED.includes(companion.status)) throw new Error(`Companion ${companionId} generation ${companion.status}`);
    if (Date.now() - started > maxWaitMs) throw new Error(`Companion ${companionId} still "${companion.status}" after ${maxWaitMs / 1000}s; re-run setup later`);
    log(`  avatar status: ${companion.status}, waiting...`);
    await sleep(pollMs);
  }
}

// One face per character. Custom portrait if the image exists, otherwise a stock face.
async function ensureCompanion(ctx, person) {
  const { napster, config, ids, log, portraitFor } = ctx;
  const saved = ids.companions[person.id];
  const portrait = portraitFor(person.id);
  const key = `companion-${person.id}`;

  if (portrait) {
    let id = saved && !saved.placeholder ? saved.id : null;
    id = await findExisting(napster, { basePath: "/public/companions", listPath: "/public/companions?pageSize=100", knownId: id, key });
    if (!id) {
      const [firstName, ...rest] = person.name.split(" ");
      const created = await napster.request("POST", "/public/companions", {
        description: `${person.name}, ${person.role} at Vitality Logistics. ${person.speechProfile?.summary ?? ""}`.trim(),
        firstName,
        lastName: rest.join(" "),
        gender: person.gender,
        pictureUrl: publicUrl(config, `/portraits/${portrait}`),
        version: "v1",
        tags: { app: APP_TAG, key },
      });
      id = created.id;
      log(`Face for ${person.name}: custom portrait submitted (${id})`);
    }
    ids.companions[person.id] = { id, placeholder: false };
    ctx.saveIds(ids);
    await waitUntilReady(ctx, id);
    log(`Face for ${person.name}: custom portrait ready (${id})`);
    return id;
  }

  if (saved) return saved.id; // keep whatever face this character already has
  const stock = await napster.request("GET", `/public/companions/napster-stock?pageSize=5&gender=${person.gender}`);
  const pick = itemsOf(stock)[0];
  if (!pick) throw new Error(`No stock ${person.gender} companion available for ${person.name}`);
  ids.companions[person.id] = { id: pick.id, placeholder: true };
  log(`Face for ${person.name}: no portrait yet, using stock face ${pick.firstName ?? ""} ${pick.lastName ?? ""} (${pick.id})`.replace(/\s+/g, " "));
  return pick.id;
}

async function upsertAgent(ctx, level, companionId, functionIds) {
  const { napster, content, ids, log } = ctx;
  const key = level.agent.key;
  const body = {
    companionId,
    name: level.agent.name,
    voiceId: level.agent.voiceId,
    useWebSearch: false,
    functions: functionIds,
    tags: { app: APP_TAG, key },
    providerSettings: {
      instructions: content.prompts.get(level.level),
      temperature: level.agent.temperature,
    },
  };
  let id = await findExisting(napster, { basePath: "/public/agents", listPath: "/public/agents", knownId: ids.agents[key], key });
  if (id) {
    await napster.request("PATCH", `/public/agents/${id}`, body);
    log(`Agent ${level.agent.name}: updated (${id})`);
  } else {
    id = (await napster.request("POST", "/public/agents", body)).id;
    log(`Agent ${level.agent.name}: created (${id})`);
  }
  await napster.request("PUT", `/public/agents/${id}/channels/webrtc`, {
    videoPolicy: "deferred",
    initialSpeech: level.agent.initialSpeech,
  });
  return id;
}

export async function runSetup({
  napster,
  config,
  content,
  ids = {},
  saveIds = () => {},
  log = console.log,
  portraitFor = findPortrait,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  pollMs = 5000,
  maxWaitMs = 5 * 60_000,
}) {
  ids.functions ??= {};
  ids.companions ??= {};
  ids.agents ??= {};
  const ctx = { napster, config, content, ids, saveIds, log, portraitFor, sleep, pollMs, maxWaitMs };

  for (const name of Object.keys(TOOLS)) {
    ids.functions[name] = await upsertFunction(ctx, name);
    saveIds(ids);
  }
  for (const level of content.levels) {
    const person = content.staffById.get(level.targetId);
    const companionId = await ensureCompanion(ctx, person);
    saveIds(ids);
    const functionIds = Object.keys(TOOLS).map((name) => ids.functions[name]);
    ids.agents[level.agent.key] = await upsertAgent(ctx, level, companionId, functionIds);
    saveIds(ids);
  }
  return ids;
}
