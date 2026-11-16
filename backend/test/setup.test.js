import { test } from "node:test";
import assert from "node:assert/strict";
import { runSetup } from "../../scripts/lib/napsterSetup.js";
import { loadContent } from "../src/game/content.js";

const config = { toolSecret: "t".repeat(32), publicBaseUrl: "https://example.ngrok-free.app" };

// In-memory stand-in for the Napster API, enough for the setup script.
function fakeNapster() {
  const store = { functions: new Map(), agents: new Map(), companions: new Map() };
  const calls = [];
  let next = 1;
  const notFound = () => Object.assign(new Error("404"), { status: 404 });

  async function request(method, path, body) {
    calls.push({ method, path, body });
    const [, , kind, id, sub] = path.split("?")[0].split("/");
    if (kind === "companions" && id === "napster-stock") return { items: [{ id: "stock_1", firstName: "Rory", lastName: "Callan" }] };
    const table = store[kind];
    if (method === "GET" && !id) return kind === "agents" ? [...table.values()] : { items: [...table.values()] };
    if (method === "GET") { if (!table.has(id)) throw notFound(); return table.get(id); }
    if (method === "POST") { const item = { ...body, id: `${kind}_${next++}`, status: "readyToUse" }; table.set(item.id, item); return item; }
    if (method === "PUT" && sub === "channels") return body;
    if (method === "PUT" || method === "PATCH") { if (!table.has(id)) throw notFound(); table.set(id, { ...table.get(id), ...body }); return table.get(id); }
    throw new Error(`unexpected ${method} ${path}`);
  }
  return { napster: { request }, store, calls };
}

const quiet = () => {};

// The same content as before stock faces were chosen: nobody has a stockFace.
function withoutStockFaces(content) {
  const staffById = new Map([...content.staffById].map(([id, person]) => [id, { ...person, stockFace: undefined }]));
  return { ...content, staffById };
}

const TIMUR_FACE = loadContent().staffById.get("timur-bekov").stockFace;

test("first run creates the tool, Timur's chosen face and his agent", async () => {
  const { napster, store, calls } = fakeNapster();
  const content = loadContent();
  const ids = await runSetup({ napster, config, content, log: quiet, portraitFor: () => null });

  const fn = store.functions.get(ids.functions.request_code);
  assert.equal(fn.url, "https://example.ngrok-free.app/tools/request_code");
  assert.equal(fn.headers["x-tool-secret"], config.toolSecret);
  assert.equal(fn.flow, "explicit");

  const agent = store.agents.get(ids.agents["level-1-timur"]);
  assert.equal(agent.companionId, TIMUR_FACE);
  assert.equal(agent.voiceId, "ash");
  assert.equal(agent.useWebSearch, false);
  assert.deepEqual(agent.functions, [ids.functions.request_code, ids.functions.assess_caller]);
  assert.equal(store.functions.get(ids.functions.assess_caller).url, "https://example.ngrok-free.app/tools/assess_caller");
  assert.match(agent.providerSettings.instructions, /Timur Bekov/);
  assert.doesNotMatch(JSON.stringify(agent), /[A-Z]{3,10}-\d{4}/, "no code in the agent config");
  assert.deepEqual(ids.companions["timur-bekov"], { id: TIMUR_FACE, placeholder: true });
  assert.ok(!calls.some((c) => c.path.includes("napster-stock")), "every target has a chosen face, so no catalogue lookup");

  const channel = calls.find((c) => c.path.endsWith("/channels/webrtc"));
  assert.equal(channel.body.videoPolicy, "deferred");
});

test("re-running updates in place, even if the saved IDs file was lost", async () => {
  const { napster, store, calls } = fakeNapster();
  const content = loadContent();
  const ids = await runSetup({ napster, config, content, log: quiet, portraitFor: () => null });
  await runSetup({ napster, config, content, ids, log: quiet, portraitFor: () => null });
  await runSetup({ napster, config, content, ids: {}, log: quiet, portraitFor: () => null });

  assert.equal(store.functions.size, 2);
  assert.equal(store.agents.size, content.levels.length);
  assert.equal(calls.filter((c) => c.method === "POST").length, 2 + content.levels.length, "only the first run creates (2 tools + 1 agent per level)");
});

test("a portrait replaces the stock face and setup waits until it is ready", async () => {
  const { napster, store } = fakeNapster();
  const content = loadContent();
  const ids = await runSetup({ napster, config, content, log: quiet, portraitFor: () => null });

  // The custom avatar takes two polls to become ready.
  const realRequest = napster.request;
  let polls = 0;
  napster.request = async (method, path, body) => {
    const out = await realRequest(method, path, body);
    if (method === "GET" && /^\/public\/companions\/companions_/.test(path)) return { ...out, status: ++polls < 2 ? "pending" : "readyToUse" };
    return out;
  };
  await runSetup({ napster, config, content, ids, log: quiet, portraitFor: (id) => (id === "timur-bekov" ? "timur-bekov.jpg" : null), sleep: async () => {}, pollMs: 0 });

  const companion = [...store.companions.values()][0];
  assert.equal(companion.pictureUrl, "https://example.ngrok-free.app/portraits/timur-bekov.jpg");
  assert.equal(companion.version, "v1");
  assert.equal(store.agents.get(ids.agents["level-1-timur"]).companionId, companion.id);
  assert.equal(ids.companions["timur-bekov"].placeholder, false);
  assert.equal(polls, 2);
});

test("someone without a chosen face still gets the first stock face of their gender", async () => {
  const { napster, store, calls } = fakeNapster();
  const content = withoutStockFaces(loadContent());
  const ids = await runSetup({ napster, config, content, log: quiet, portraitFor: () => null });

  assert.equal(store.agents.get(ids.agents["level-1-timur"]).companionId, "stock_1");
  assert.deepEqual(ids.companions["timur-bekov"], { id: "stock_1", placeholder: true });
  assert.ok(calls.some((c) => c.path.includes("napster-stock")));
});

test("a saved stock face is swapped for the chosen one; a custom face is kept", async () => {
  const { napster, store } = fakeNapster();
  const content = loadContent();
  const ids = {
    companions: {
      "timur-bekov": { id: "stock_1", placeholder: true },
      "anna-petrova": { id: "custom_anna", placeholder: false },
    },
  };
  await runSetup({ napster, config, content, ids, log: quiet, portraitFor: () => null });

  assert.equal(store.agents.get(ids.agents["level-1-timur"]).companionId, TIMUR_FACE);
  assert.deepEqual(ids.companions["timur-bekov"], { id: TIMUR_FACE, placeholder: true });
  assert.equal(store.agents.get(ids.agents["level-2-anna"]).companionId, "custom_anna");
  assert.deepEqual(ids.companions["anna-petrova"], { id: "custom_anna", placeholder: false });
});

test("choosing faces changes only the face: every agent is configured exactly as before", async () => {
  const configured = async (content) => {
    const { napster, calls } = fakeNapster();
    await runSetup({ napster, config, content, log: quiet, portraitFor: () => null });
    // Everything sent to Napster for agents and their channels, with only the face taken out.
    return calls
      .filter((c) => c.path.startsWith("/public/agents") && c.method !== "GET")
      .map(({ method, path, body }) => ({ method, path, body: { ...body, companionId: undefined } }));
  };
  const content = loadContent();
  const before = await configured(withoutStockFaces(content));
  const after = await configured(content);

  assert.equal(after.length, before.length);
  assert.equal(after.filter((c) => c.method === "POST").length, content.levels.length);
  assert.deepEqual(after, before);
});
