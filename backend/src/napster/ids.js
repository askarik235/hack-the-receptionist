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

export function writeNapsterIds(apiKey, ids) {
  writeFileSync(napsterIdsPath(apiKey), JSON.stringify(ids, null, 2) + "\n");
}
