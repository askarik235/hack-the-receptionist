import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, loadEnvFile, publicUrl } from "../src/config.js";

const valid = {
  NAPSTER_API_KEY: "napster-key",
  TOOL_SECRET: "t".repeat(32),
  CODE_SECRET: "c".repeat(32),
  SESSION_SECRET: "s".repeat(32),
  PUBLIC_BASE_URL: "https://example.ngrok-free.app/",
  NAPSTER_WEBHOOK_SECRET: "webhook-secret",
};

test("valid config loads and trims the trailing slash", () => {
  const config = loadConfig(valid);
  assert.equal(config.publicBaseUrl, "https://example.ngrok-free.app");
  assert.equal(config.port, 3000);
  assert.equal(config.production, false);
  assert.deepEqual(config.warnings, []);
  assert.equal(publicUrl(config, "tools/request-code"), "https://example.ngrok-free.app/tools/request-code");
});

test("lists every missing secret in one error", () => {
  assert.throws(() => loadConfig({}), (err) => {
    for (const key of ["NAPSTER_API_KEY", "TOOL_SECRET", "CODE_SECRET", "SESSION_SECRET"]) {
      assert.match(err.message, new RegExp(`${key} is missing`));
    }
    return true;
  });
});

test(".env.example placeholders count as missing", () => {
  assert.throws(() => loadConfig({ ...valid, TOOL_SECRET: "change-me-random-string" }), /TOOL_SECRET is missing/);
});

test("short secrets are rejected", () => {
  assert.throws(() => loadConfig({ ...valid, CODE_SECRET: "short" }), /CODE_SECRET must be at least 16/);
});

test("PUBLIC_BASE_URL must be https", () => {
  assert.throws(() => loadConfig({ ...valid, PUBLIC_BASE_URL: "http://localhost:3000" }), /must start with https/);
});

test("missing PUBLIC_BASE_URL and webhook secret are warnings, not errors", () => {
  const { PUBLIC_BASE_URL, NAPSTER_WEBHOOK_SECRET, ...rest } = valid;
  const config = loadConfig(rest);
  assert.equal(config.publicBaseUrl, null);
  assert.equal(config.webhookSecret, null);
  assert.equal(config.warnings.length, 2);
  assert.throws(() => publicUrl(config, "/x"), /PUBLIC_BASE_URL is not set/);
});

test("loadEnvFile strips a BOM and never overrides existing values", () => {
  const dir = mkdtempSync(join(tmpdir(), "htr-env-"));
  const file = join(dir, ".env");
  writeFileSync(file, "﻿NAPSTER_API_KEY=from-file\nPORT=4000\n");
  const env = { PORT: "5000" };
  assert.equal(loadEnvFile(file, env), true);
  assert.equal(env.NAPSTER_API_KEY, "from-file");
  assert.equal(env.PORT, "5000");
  assert.equal(loadEnvFile(join(dir, "missing.env"), env), false);
});
