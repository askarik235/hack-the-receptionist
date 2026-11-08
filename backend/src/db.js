// SQLite storage (better-sqlite3). Schema changes go in MIGRATIONS, never edit an old step.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MIGRATIONS = [
  // 1: players, calls (one row per phone call = one attempt), cleared levels, webhook dedupe
  `
  CREATE TABLE players (
    id            TEXT PRIMARY KEY,     -- random, also part of the Napster externalClientId
    created_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL
  );

  CREATE TABLE calls (
    id                  TEXT PRIMARY KEY,   -- our call ID, sent to Napster in session tags
    player_id           TEXT NOT NULL REFERENCES players(id),
    level               INTEGER NOT NULL,
    attempt             INTEGER NOT NULL,   -- 1, 2, 3... per player and level
    external_client_id  TEXT NOT NULL,      -- p_<player>_L<level>_a<attempt>
    napster_session_id  TEXT UNIQUE,        -- connection.id returned by Napster
    status              TEXT NOT NULL DEFAULT 'dialing',  -- dialing | live | ended | failed
    close_reason        TEXT,
    cost                REAL,
    transcript_json     TEXT,
    won                 INTEGER NOT NULL DEFAULT 0,  -- 1 = this call led to clearing the level
    created_at          INTEGER NOT NULL,
    ended_at            INTEGER,
    UNIQUE (player_id, level, attempt)
  );
  CREATE INDEX calls_by_player_level ON calls(player_id, level);

  CREATE TABLE cleared_levels (
    player_id        TEXT NOT NULL REFERENCES players(id),
    level            INTEGER NOT NULL,
    cleared_at       INTEGER NOT NULL,
    winning_call_id  TEXT REFERENCES calls(id),
    PRIMARY KEY (player_id, level)
  );

  CREATE TABLE webhook_events (
    event_id     TEXT PRIMARY KEY,   -- Napster eventId, used to skip duplicate deliveries
    event_type   TEXT NOT NULL,
    received_at  INTEGER NOT NULL
  );
  `,
  // 2: every server-tool call a character makes (who the caller claimed to be, approved or not).
  // Feeds the debrief and "word travels": identities that worked once are refused later.
  `
  CREATE TABLE tool_calls (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id         TEXT NOT NULL REFERENCES calls(id),
    level           INTEGER NOT NULL,
    tool            TEXT NOT NULL,
    claimed_name    TEXT,
    arguments_json  TEXT NOT NULL,
    approved        INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX tool_calls_by_call ON tool_calls(call_id);
  `,
];

export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.pragma("user_version", { simple: true });
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

export const now = () => Math.floor(Date.now() / 1000);
