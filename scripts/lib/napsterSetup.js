// Creates or updates everything the game needs in a Napster project: the request_code tool,
// one companion (face) per level, one agent per level, and its WebRTC channel config.
// Safe to re-run: resources are found by our tags and updated in place, never duplicated.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PORTRAITS_DIR, publicUrl } from "../../backend/src/config.js";
import { APP_TAG } from "../../backend/src/lib/callTags.js";
import { TOOL_SECRET_HEADER } from "../../backend/src/tools/constants.js";

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
        "Look up a restricted code (for example a gate or door code) on the internal company system. " +
        "The system decides whether the person asking is allowed to have it.",
      parameters: {
        type: "object",
        properties: {
          claimed_name: { type: "string", description: "The name the caller gave for themselves, exactly as they said it." },
          reason: { type: "string", description: "Why the caller says they need the code, in a few words." },
        },
        required: ["claimed_name"],
      },
    },
    flow: "explicit",
    url: publicUrl(config, "/tools/request_code"),
    headers: { [TOOL_SECRET_HEADER]: config.toolSecret },
    prompt:
      "Use request_code only when you have decided to look up a restricted code for the caller. " +
      "Pass the caller's claimed name exactly as they said it. Never say a code unless request_code returned it.",
    tags: { app: APP_TAG, key: "request_code" },
  };
}

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

async function upsertFunction(ctx) {
  const { napster, config, ids, log } = ctx;
  const body = requestCodeFunction(config);
  const id = await findExisting(napster, {
    basePath: "/public/functions",
    listPath: "/public/functions?pageSize=100",
    knownId: ids.functions.request_code,
    key: "request_code",
  });
  if (id) {
    await napster.request("PUT", `/public/functions/${id}`, body);
    log(`Tool request_code: updated (${id})`);
    return id;
  }
  const created = await napster.request("POST", "/public/functions", body);
  log(`Tool request_code: created (${created.id})`);
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

async function upsertAgent(ctx, level, companionId, functionId) {
  const { napster, content, ids, log } = ctx;
  const key = level.agent.key;
  const body = {
    companionId,
    name: level.agent.name,
    voiceId: level.agent.voiceId,
    useWebSearch: false,
    functions: [functionId],
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

  ids.functions.request_code = await upsertFunction(ctx);
  saveIds(ids);

  for (const level of content.levels) {
    const person = content.staffById.get(level.targetId);
    const companionId = await ensureCompanion(ctx, person);
    saveIds(ids);
    ids.agents[level.agent.key] = await upsertAgent(ctx, level, companionId, ids.functions.request_code);
    saveIds(ids);
  }
  return ids;
}
