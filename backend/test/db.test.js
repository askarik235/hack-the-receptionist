import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";

test("creates all tables and sets the schema version", () => {
  const db = openDb(":memory:");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ["calls", "cleared_levels", "players", "sqlite_sequence", "tool_calls", "webhook_events"]);
  assert.equal(db.pragma("user_version", { simple: true }), 3);
});

test("reopening an existing database file does not re-run migrations", () => {
  const file = join(mkdtempSync(join(tmpdir(), "htr-db-")), "nested", "game.db");
  const first = openDb(file);
  first.prepare("INSERT INTO players VALUES ('abcdef0123', 1, 1)").run();
  first.close();
  const second = openDb(file);
  assert.equal(second.prepare("SELECT COUNT(*) AS n FROM players").get().n, 1);
  second.close();
});

test("one attempt number per player and level; foreign keys enforced", () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO players VALUES ('abcdef0123', 1, 1)").run();
  const insertCall = db.prepare(
    "INSERT INTO calls (id, player_id, level, attempt, external_client_id, created_at) VALUES (?, ?, 1, ?, 'x', 1)"
  );
  insertCall.run("c1", "abcdef0123", 1);
  assert.throws(() => insertCall.run("c2", "abcdef0123", 1), /UNIQUE/);
  assert.throws(() => insertCall.run("c3", "nobody0000", 1), /FOREIGN KEY/);
});
