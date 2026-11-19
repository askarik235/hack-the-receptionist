// Reads settings from the environment (and the repo-root .env file locally).
// Every Napster-facing URL is built from PUBLIC_BASE_URL via publicUrl(), never hard-coded.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const rootDir = resolve(backendDir, "..");
// Character portraits (one image per character, named <staffId>.jpg/.png/.webp).
export const PORTRAITS_DIR = join(rootDir, "scripts", "assets", "portraits");

const SECRETS = ["NAPSTER_API_KEY", "TOOL_SECRET", "CODE_SECRET", "SESSION_SECRET"];
const MIN_SECRET_LENGTH = 16;
// Values copied from .env.example count as missing.
const PLACEHOLDER = /^(change-me|your-|paste-from)/i;

// Loads KEY=value pairs from a .env file into `env` without overriding values that are
// already set (so real environment variables on Render win). Strips a UTF-8 BOM, which
// PowerShell sometimes writes and which would otherwise corrupt the first key.
export function loadEnvFile(path = join(rootDir, ".env"), env = process.env) {
  if (!existsSync(path)) return false;
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (env[key] === undefined) env[key] = value;
  }
  return true;
}

// Validates the environment and returns a frozen config. Throws one error listing every
// problem, so a missing setting is obvious at startup instead of failing mid-call.
export function loadConfig(rawEnv = process.env) {
  const problems = [];
  const warnings = [];
  // Values pasted into a dashboard (Render) easily pick up a stray space or line break, which
  // would make a secret silently differ from the one Napster sends. Edges are never meaningful.
  const env = Object.fromEntries(Object.entries(rawEnv).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
  const isSet = (key) => Boolean(env[key]) && !PLACEHOLDER.test(env[key]);

  for (const key of SECRETS) {
    if (!isSet(key)) problems.push(`${key} is missing`);
    else if (key !== "NAPSTER_API_KEY" && env[key].length < MIN_SECRET_LENGTH) {
      problems.push(`${key} must be at least ${MIN_SECRET_LENGTH} characters`);
    }
  }

  // Optional daily spending cap: minutes of calls across the whole game per 24 hours.
  let dailyCallMinutes = null;
  if (env.DAILY_CALL_MINUTES) {
    dailyCallMinutes = Number(env.DAILY_CALL_MINUTES);
    if (!Number.isInteger(dailyCallMinutes) || dailyCallMinutes < 1 || dailyCallMinutes > 100_000) {
      problems.push("DAILY_CALL_MINUTES must be a whole number of minutes (1 or more)");
    }
  }

  let publicBaseUrl = null;
  if (isSet("PUBLIC_BASE_URL")) {
    try {
      const url = new URL(env.PUBLIC_BASE_URL);
      if (url.protocol !== "https:") problems.push("PUBLIC_BASE_URL must start with https://");
      else publicBaseUrl = (url.origin + url.pathname).replace(/\/+$/, "");
    } catch {
      problems.push("PUBLIC_BASE_URL is not a valid URL");
    }
  } else {
    warnings.push("PUBLIC_BASE_URL is not set: Napster can't reach tool endpoints or webhooks yet");
  }

  if (!isSet("NAPSTER_WEBHOOK_SECRET")) {
    warnings.push("NAPSTER_WEBHOOK_SECRET is not set: webhook requests will be rejected");
  }

  // Optional judge access code for the hosted demo. Unset = the game is open (local play).
  const accessCode = isSet("ACCESS_CODE") ? env.ACCESS_CODE : null;
  if (accessCode !== null && (accessCode.length < 8 || accessCode.length > 64)) {
    problems.push("ACCESS_CODE must be 8 to 64 characters");
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("PORT must be a number between 1 and 65535");

  if (problems.length) {
    throw new Error(
      `Configuration problems:\n  - ${problems.join("\n  - ")}\n` +
        "Copy .env.example to .env and fill it in. Generate a secret with:\n" +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
    );
  }

  const production = env.NODE_ENV === "production";
  return Object.freeze({
    napsterApiKey: env.NAPSTER_API_KEY,
    toolSecret: env.TOOL_SECRET,
    codeSecret: env.CODE_SECRET,
    sessionSecret: env.SESSION_SECRET,
    webhookSecret: isSet("NAPSTER_WEBHOOK_SECRET") ? env.NAPSTER_WEBHOOK_SECRET : null,
    publicBaseUrl,
    accessCode,
    dailyCallMinutes,
    port,
    production,
    dbPath: env.DB_PATH ? resolve(rootDir, env.DB_PATH) : join(backendDir, "data", "game.db"),
    warnings: Object.freeze(warnings),
  });
}

// Builds an absolute public URL for something Napster must reach (tools, webhooks, images).
export function publicUrl(config, path) {
  if (!config.publicBaseUrl) throw new Error("PUBLIC_BASE_URL is not set in .env");
  return config.publicBaseUrl + (path.startsWith("/") ? path : `/${path}`);
}
