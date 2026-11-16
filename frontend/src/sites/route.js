// Turns whatever the player types in the address bar into one of our fake sites.
export const START = "start";
export const SITES = {
  vitality: "vitality-logistics.ae",
  mail: "mail.vitality-logistics.ae",
  files: "files.vitality-logistics.ae",
  worknet: "worknet.io",
  pixa: "pixa.photos",
};

export function normalizeUrl(input) {
  const text = String(input ?? "").trim().toLowerCase();
  if (!text || text === START) return START;
  return text.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

export function parseUrl(input) {
  const url = normalizeUrl(input);
  if (url === START) return { site: "start", url };
  const [hostAndPath, query = ""] = url.split("?");
  const [host, ...parts] = hostAndPath.split("/");
  const params = new URLSearchParams(query);
  for (const [site, domain] of Object.entries(SITES)) {
    if (host === domain) return { site, url, path: parts, params };
  }
  return { site: "none", url, host };
}

// Address bar convenience: typing "pixa", "worknet", "mail" or "vitalnet" goes to that site.
export function resolveTyped(input) {
  const url = normalizeUrl(input);
  if (url === "vitalnet") return SITES.mail;
  for (const domain of Object.values(SITES)) {
    if (url === domain.split(".")[0]) return domain;
  }
  if (url.startsWith("vitality")) return url.includes(".") ? url : SITES.vitality;
  return url;
}
