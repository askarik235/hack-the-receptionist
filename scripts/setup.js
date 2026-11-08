// `npm run setup`: builds the game's characters in the Napster project whose key is in .env.
// Safe to re-run after changing a prompt, voice or tool: it updates instead of duplicating.
// Created IDs are saved in backend/data/napster-ids.<project>.json (gitignored).
import { loadConfig, loadEnvFile } from "../backend/src/config.js";
import { loadContent } from "../backend/src/game/content.js";
import { createNapsterClient } from "../backend/src/napster/client.js";
import { napsterIdsPath, projectHash, readNapsterIds, writeNapsterIds } from "../backend/src/napster/ids.js";
import { runSetup } from "./lib/napsterSetup.js";

loadEnvFile();
let config;
try {
  config = loadConfig();
  if (!config.publicBaseUrl) throw new Error("PUBLIC_BASE_URL must be set: Napster calls the request_code tool there.");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const apiKey = config.napsterApiKey;
console.log(`Napster project ${projectHash(apiKey)}, tool URL base ${config.publicBaseUrl}`);
try {
  await runSetup({
    napster: createNapsterClient({ apiKey }),
    config,
    content: loadContent(),
    ids: readNapsterIds(apiKey),
    saveIds: (ids) => writeNapsterIds(apiKey, ids),
  });
  console.log(`Done. IDs saved to ${napsterIdsPath(apiKey)}`);
} catch (err) {
  const detail = err.body ? ` ${JSON.stringify(err.body)}` : "";
  console.error(`Setup failed: ${err.message}${detail}`);
  process.exit(1);
}
