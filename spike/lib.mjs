// Throwaway spike helpers. Zero dependencies (Node 18+ fetch).
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", ".env");
const idsPath = join(here, "spike-ids.json");

// Minimal .env reader: KEY=value lines, ignores comments and blank lines.
export function loadEnv() {
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const line of readFileSync(envPath, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

export const env = loadEnv();
if (!env.NAPSTER_API_KEY) {
  console.error("NAPSTER_API_KEY is missing from .env");
  process.exit(1);
}

const BASE = "https://companion-api.napster.com";

export async function napster(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "X-Api-Key": env.NAPSTER_API_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, retryAfter: res.headers.get("retry-after"), data };
}

export const readIds = () => (existsSync(idsPath) ? JSON.parse(readFileSync(idsPath, "utf8")) : {});
export const writeIds = (ids) => writeFileSync(idsPath, JSON.stringify(ids, null, 2));
