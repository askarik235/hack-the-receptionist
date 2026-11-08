// Creates (or reuses) ONE throwaway test agent on a stock companion.
// Safe to re-run. Remove later with: node spike/setup.mjs --delete
import { napster, readIds, writeIds } from "./lib.mjs";

const ids = readIds();

if (process.argv.includes("--delete")) {
  if (!ids.agentId) { console.log("Nothing to delete."); process.exit(0); }
  const r = await napster("DELETE", `/public/agents/${ids.agentId}`);
  console.log("Delete agent:", r.status);
  if (r.status < 300) writeIds({});
  process.exit(0);
}

// 1. Reuse the spike agent if it still exists.
if (ids.agentId) {
  const r = await napster("GET", `/public/agents/${ids.agentId}`);
  if (r.status === 200) {
    console.log("Reusing spike agent", ids.agentId);
  } else {
    delete ids.agentId;
  }
}

// 2. Otherwise pick a stock companion and create the agent.
if (!ids.agentId) {
  const stock = await napster("GET", "/public/companions/napster-stock?pageSize=5&gender=male");
  if (stock.status !== 200 || !stock.data?.items?.length) {
    console.error("Could not list stock companions:", stock.status, JSON.stringify(stock.data));
    process.exit(1);
  }
  const c = stock.data.items[0];
  console.log("Using stock companion:", c.id, c.firstName ?? "", c.lastName ?? "");

  const agent = await napster("POST", "/public/agents", {
    companionId: c.id,
    name: "SPIKE - phone test (delete me)",
    voiceId: "ash",
    useWebSearch: false,
    tags: { app: "hack-the-receptionist", purpose: "spike" },
    providerSettings: {
      temperature: 0.6,
      instructions:
        "You are Sam, a junior employee answering your office phone. Keep replies to one or two " +
        "short sentences. This is a technical test call: chat casually and answer simple questions.",
    },
  });
  if (agent.status !== 200) {
    console.error("Create agent failed:", agent.status, JSON.stringify(agent.data));
    process.exit(1);
  }
  ids.agentId = agent.data.id;
  ids.companionId = c.id;
  writeIds(ids);
  console.log("Created agent", ids.agentId);
}

// 3. WebRTC channel config: audio first, video later; answer like a phone.
const ch = await napster("PUT", `/public/agents/${ids.agentId}/channels/webrtc`, {
  videoPolicy: "deferred",
  initialSpeech: "Answer the phone briefly, like an office worker: say your name and ask who is calling.",
});
console.log("WebRTC channel config:", ch.status, ch.status === 200 ? `videoPolicy=${ch.data.videoPolicy}` : JSON.stringify(ch.data));
