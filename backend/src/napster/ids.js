// IDs of the Napster resources created by `npm run setup`. One file per Napster project
// (dev and prod keys differ), named by a short hash of the API key. Gitignored.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backendDir } from "../config.js";

export const projectHash = (apiKey) => createHash("sha256").update(apiKey).digest("hex").slice(0, 8);

export const napsterIdsPath = (apiKey) => join(backendDir, "data", `napster-ids.${projectHash(apiKey)}.json`);

export function readNapsterIds(apiKey) {
  const path = napsterIdsPath(apiKey);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

// Napster list endpoints answer with either a bare array or { items: [...] }.
export const itemsOf = (data) => (Array.isArray(data) ? data : (data?.items ?? []));

// On a fresh server (the hosted demo) there is no IDs file. Setup tags every agent with
// { app, key }, so the agents can be found by listing them: one read-only request.
export async function findAgentIdsByTag(napster, appTag) {
  const agents = {};
  for (const agent of itemsOf(await napster.request("GET", "/public/agents"))) {
    if (agent?.tags?.app === appTag && typeof agent.tags.key === "string" && typeof agent.id === "string") {
      agents[agent.tags.key] = agent.id;
    }
  }
  return agents;
}

export function writeNapsterIds(apiKey, ids) {
  writeFileSync(napsterIdsPath(apiKey), JSON.stringify(ids, null, 2) + "\n");
}
