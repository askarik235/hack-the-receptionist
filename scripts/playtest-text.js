// `npm run playtest:text -- [persona ...] [--runs N] [--no-log] [--list]`
// Plays scripted callers (scripts/playtest/personas.js) against the real characters over a
// Napster TEXT session: cheaper than voice and repeatable. Each run is a fresh playtest player
// with a real call row, so the backend's tools (assess_caller, request_code) score it exactly
// like a phone call. Needs the backend running and reachable at PUBLIC_BASE_URL (ngrok).
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadConfig, loadEnvFile, rootDir } from "../backend/src/config.js";
import { openDb, now } from "../backend/src/db.js";
import { loadContent } from "../backend/src/game/content.js";
import { codeFor } from "../backend/src/game/codes.js";
import { createNapsterClient } from "../backend/src/napster/client.js";
import { readNapsterIds } from "../backend/src/napster/ids.js";
import { externalClientIdFor, generatePlayerId } from "../backend/src/lib/players.js";
import { buildCallTags } from "../backend/src/lib/callTags.js";
import { createWordTravels } from "../backend/src/game/wordTravels.js";
import { callerIdLabel } from "../backend/src/game/callerId.js";
import { normalizeNumber } from "../backend/src/lib/phoneNumbers.js";
import { PERSONAS, personaById } from "./playtest/personas.js";

const GREETING_WAIT_MS = 6000; // the character may or may not speak first
const REPLY_TIMEOUT_MS = 30000;
const QUIET_AFTER_REPLY_MS = 2500; // a turn can be several messages (e.g. around a tool call)
const LOG_FILE = join(rootDir, "playtest-log.md");

// ---------- arguments ----------
const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const p of PERSONAS) console.log(`${p.id.padEnd(16)} L${p.level}  expect ${p.expect.padEnd(7)}  ${p.pretext}`);
  process.exit(0);
}
const runsIndex = args.indexOf("--runs");
const runs = runsIndex >= 0 ? Math.max(1, Math.min(10, Number(args[runsIndex + 1]) || 1)) : 1;
const writeLog = !args.includes("--no-log");
const names = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--runs");
const unknown = names.filter((n) => !personaById.has(n));
if (unknown.length) {
  console.error(`Unknown persona: ${unknown.join(", ")}. Use --list.`);
  process.exit(1);
}
const personas = names.length ? names.map((n) => personaById.get(n)) : PERSONAS;

// ---------- setup ----------
loadEnvFile();
const config = loadConfig();
if (!config.publicBaseUrl) {
  console.error("PUBLIC_BASE_URL is not set. The characters' tools need the backend reachable from Napster.");
  process.exit(1);
}
try {
  const res = await fetch(new URL("/api/health", config.publicBaseUrl), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (err) {
  console.error(`Backend not reachable at ${config.publicBaseUrl} (${err.message}). Start ngrok and npm run dev first.`);
  process.exit(1);
}

const db = openDb(config.dbPath);
const content = loadContent();
const napster = createNapsterClient({ apiKey: config.napsterApiKey });
const agentIds = readNapsterIds(config.napsterApiKey).agents ?? {};
const wordTravels = createWordTravels(db);
// Who a typical player was when they won each earlier level.
const WON_AS = { 1: "Mark Keller", 2: "Laura Weber", 3: "Nadia Rahman" };

const q = {
  addPlayer: db.prepare("INSERT INTO players (id, created_at, last_seen_at) VALUES (?, ?, ?)"),
  addCall: db.prepare(
    `INSERT INTO calls (id, player_id, level, attempt, external_client_id, status, created_at, caller_id) VALUES (?, ?, ?, 1, ?, 'dialing', ?, ?)`
  ),
  // For Level 2+: pretend the player already won the earlier levels (needed for "word travels").
  addWonCall: db.prepare(
    `INSERT INTO calls (id, player_id, level, attempt, external_client_id, status, close_reason, created_at, ended_at, won)
     VALUES (?, ?, ?, 1, ?, 'ended', 'playtest_setup', ?, ?, 1)`
  ),
  addWinningTool: db.prepare(
    `INSERT INTO tool_calls (call_id, level, tool, claimed_name, arguments_json, approved, created_at) VALUES (?, ?, 'request_code', ?, '{}', 1, ?)`
  ),
  addCleared: db.prepare("INSERT INTO cleared_levels (player_id, level, cleared_at, winning_call_id) VALUES (?, ?, ?, ?)"),
  live: db.prepare("UPDATE calls SET status = 'live', napster_session_id = ? WHERE id = ?"),
  end: db.prepare("UPDATE calls SET status = 'ended', close_reason = ?, ended_at = ? WHERE id = ? AND status IN ('dialing', 'live')"),
  call: db.prepare("SELECT status, close_reason, trust FROM calls WHERE id = ?"),
  approved: db.prepare("SELECT 1 FROM tool_calls WHERE call_id = ? AND tool = 'request_code' AND approved = 1"),
  moves: db.prepare("SELECT arguments_json FROM tool_calls WHERE call_id = ? AND tool = 'assess_caller' ORDER BY id"),
};

const squash = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- one text session ----------
// Collects the character's messages; `nextReply()` resolves once they've gone quiet after replying.
function openSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages = [];
    let waiter = null;
    let closed = false;

    const settle = () => {
      if (!waiter) return;
      clearTimeout(waiter.quiet);
      waiter.quiet = setTimeout(() => {
        const w = waiter;
        waiter = null;
        clearTimeout(w.timeout);
        w.resolve(messages.splice(0));
      }, QUIET_AFTER_REPLY_MS);
    };

    ws.addEventListener("message", (e) => {
      let event;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      if (event.event === "message_received") {
        const m = event.data?.message;
        if (m?.role === "assistant" && m.action === "completed" && m.content) {
          messages.push(m.content);
          settle();
        }
      }
    });
    ws.addEventListener("close", () => {
      closed = true;
      if (waiter) {
        clearTimeout(waiter.quiet);
        clearTimeout(waiter.timeout);
        waiter.resolve(messages.splice(0));
        waiter = null;
      }
    });
    ws.addEventListener("error", () => reject(new Error("WebSocket error")));
    ws.addEventListener("open", () =>
      resolve({
        send: (text) => ws.send(JSON.stringify({ type: "send_message", data: { role: "user", text, trigger_response: true, delay: false } })),
        nextReply: (timeoutMs = REPLY_TIMEOUT_MS) =>
          new Promise((res) => {
            if (closed) return res(messages.splice(0));
            waiter = { resolve: res, quiet: null, timeout: setTimeout(() => {
              const w = waiter;
              waiter = null;
              if (w) res(messages.splice(0));
            }, timeoutMs) };
            if (messages.length) settle();
          }),
        isClosed: () => closed,
        close: () => ws.close(),
      })
    );
  });
}

async function playOnce(persona, runNo) {
  const level = content.levelByNumber.get(persona.level);
  const agentId = agentIds[level.agent.key];
  if (!agentId) throw new Error(`No agent for ${level.agent.key}. Run npm run setup.`);

  const playerId = generatePlayerId();
  const callId = `call_${randomBytes(12).toString("base64url")}`;
  const externalClientId = externalClientIdFor(playerId, level.level, 1);
  q.addPlayer.run(playerId, now(), now());
  // Earlier levels count as won, by the identity in persona.wonAs (default: Level 1 as Mark Keller).
  for (let n = 1; n < level.level; n++) {
    const wonCallId = `call_${randomBytes(12).toString("base64url")}`;
    q.addWonCall.run(wonCallId, playerId, n, externalClientIdFor(playerId, n, 1), now(), now());
    q.addWinningTool.run(wonCallId, n, persona.wonAs?.[n] ?? WON_AS[n] ?? "unknown", now());
    q.addCleared.run(playerId, n, now(), wonCallId);
  }
  // persona.callerId: the number the caller ID kit shows (Level 4 on), as the Phone would send it.
  const callerId = persona.callerId ? normalizeNumber(persona.callerId) : null;
  q.addCall.run(callId, playerId, level.level, externalClientId, now(), callerId);
  const code = codeFor(config.codeSecret, playerId, level.level, level.code.words);
  const profile = {};
  const officeNews = wordTravels.officeNews(content, playerId, level.level);
  if (officeNews.length) profile.office_news = officeNews;
  if (level.callerId) profile.caller_id = callerIdLabel(content, callerId);

  const started = Date.now();
  const connection = await napster.createConnection(agentId, {
    channelType: "websocket",
    modality: "text",
    externalClientId,
    tags: buildCallTags(config.toolSecret, { callId, playerId, level: level.level }),
    ...(Object.keys(profile).length ? { externalClientProfile: profile } : {}),
  });
  const sessionId = connection.connection.id;
  q.live.run(sessionId, callId);
  const { url } = JSON.parse(Buffer.from(connection.token, "base64").toString());

  console.log(`\n=== ${persona.id} (run ${runNo}) L${level.level}, expect ${persona.expect} ===`);
  const socket = await openSocket(url);
  const say = (who, text) => console.log(`${who === "you" ? "  YOU " : "  THEM"}  ${text}`);
  const gotCodeIn = (texts) => texts.some((t) => squash(t).includes(squash(code)));

  let spokeCode = false;
  let turns = 0;
  for (const t of await socket.nextReply(GREETING_WAIT_MS)) say("them", t);

  for (const line of persona.lines) {
    if (socket.isClosed()) break;
    say("you", line);
    socket.send(line);
    turns++;
    const reply = await socket.nextReply();
    for (const t of reply) say("them", t.replace(new RegExp(code.split("-")[1], "g"), "####"));
    if (gotCodeIn(reply)) spokeCode = true;
    const state = q.call.get(callId);
    console.log(`        trust ${state.trust ?? level.trust.start}%${state.status === "ended" ? `, call ended (${state.close_reason})` : ""}`);
    if (spokeCode || state.status === "ended") break;
  }

  // Give a distrust hang-up time to land before reading the result.
  await sleep(500);
  const state = q.call.get(callId);
  const approved = Boolean(q.approved.get(callId));
  // End it on Napster first; once the socket closes the session is already gone (400).
  if (!socket.isClosed()) {
    try {
      await napster.closeConnection(sessionId);
    } catch (err) {
      if (err.status !== 404 && err.code !== "ConnectionNotFound") console.warn(`  (could not close session: ${err.message} ${JSON.stringify(err.body ?? "")})`);
    }
  }
  socket.close();
  q.end.run("playtest_done", now(), callId);

  const flags = q.moves.all(callId).flatMap((r) => JSON.parse(r.arguments_json).changes ?? []).filter((c) => c.points < 0 && c.key !== "gut").map((c) => c.key);
  const result = spokeCode ? "cleared" : state.close_reason === "distrust" ? "hung up" : "refused";
  const ok = (persona.expect === "code") === spokeCode;
  const notes = [
    ok ? "as expected" : `UNEXPECTED (wanted ${persona.expect})`,
    `trust ${level.trust.start}->${state.trust ?? level.trust.start}`,
    approved && !spokeCode ? "tool approved but code not said" : null,
    !approved && spokeCode ? "CODE SAID WITHOUT TOOL APPROVAL" : null,
    flags.length ? `flags: ${[...new Set(flags)].join(", ")}` : null,
  ].filter(Boolean).join("; ");
  return { persona, result, ok, turns, seconds: Math.round((Date.now() - started) / 1000), notes };
}

// ---------- run ----------
const results = [];
for (const persona of personas) {
  for (let i = 1; i <= runs; i++) {
    try {
      results.push(await playOnce(persona, i));
    } catch (err) {
      console.error(`  ${persona.id} run ${i} failed: ${err.message} ${err.body ? JSON.stringify(err.body) : ""}`);
      results.push({ persona, result: "broke", ok: false, turns: 0, seconds: 0, notes: `runner error: ${err.message}` });
    }
  }
}

console.log("\n=== Summary ===");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.persona.id.padEnd(16)} ${r.result.padEnd(8)} ${r.turns} turns  ${r.notes}`);
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} as expected`);

if (writeLog) {
  const date = new Date().toISOString().slice(0, 10);
  const rows = results.map((r) =>
    `| ${date} | ${r.persona.level} | text | ${r.persona.id}: ${r.persona.pretext} | ${r.result} | ${r.seconds}s, ${r.turns} turns | ${r.notes} |`
  );
  appendFileSync(LOG_FILE, rows.join("\n") + "\n");
  console.log(`Logged ${rows.length} rows to playtest-log.md`);
}
db.close();
process.exit(passed === results.length ? 0 : 2);
