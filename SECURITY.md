# Security

This is a training game about social engineering. Everything in it is fictional: the company,
the people, the codes. Players never enter real passwords or personal data. This page covers how
the game protects its own secrets, its players and the Napster account it runs on.

Last full review: 2026-11-18, whole repository, no open findings.

## What is worth protecting

| Asset | Why it matters |
|---|---|
| Napster API key | Anyone holding it can spend the account's credits. |
| Napster credits | Every call costs money ($3.50/hour). A script that opens calls in a loop drains them. |
| Level codes | If a code can be read or guessed without convincing the character, the game is pointless. |
| Tool endpoints | Napster calls these mid-call. A forged call could hand out a code. |
| Players' calls | Transcripts and debriefs belong to one player only. |

## Controls

**Secrets**
- All secrets live in `.env` (gitignored). `.env.example` holds placeholders only.
- The server refuses to start if a secret is missing, a placeholder, or shorter than 16 characters.
- The API key is used only on the server. The browser gets a short-lived Napster session token per call.
- Checked on 2026-11-19: no secret value appears in any commit, any tracked file or the built
  frontend bundle, and the build ships no source maps.

**Hosted demo access**
- With `ACCESS_CODE` set, every `/api` route needs it. The code is checked on the server in
  constant time, 10 tries per 10 minutes per IP. The cookie it grants is `HttpOnly` and holds a
  signature, not the code; changing the code signs everyone out.

**Codes**
- Codes are never stored. Each one is derived from `CODE_SECRET`, the player and the level
  (HMAC-SHA256), so every player has their own code.
- A code exists only in the tool reply the character reads after its checks pass. It never
  appears in the frontend bundle or in any API response. Transcripts shown in Training are redacted.
- The HACK app compares in constant time, allows 6 tries a minute per player, and only accepts a
  code after a character has actually handed it over (an approved `request_code` in one of that
  player's calls). Guessing all 80,000 combinations therefore gets nowhere.

**Tool endpoints (`/tools/*`, called by Napster)**
- Each request must carry the shared `TOOL_SECRET` header (compared in constant time).
- The call's tags are HMAC-signed per call, player and level, and must match the `externalClientId`
  and an open call in our database. A leaked header alone can't act on someone else's call.
- Inputs are type-checked and length-limited, unknown red flags are ignored, and limits apply
  per call and globally.
- Trust is scored by fixed server rules: facts count once, gut feeling is capped. The model's
  mood alone can't unlock a code.
- Text a caller controls (their claimed name) is stripped to letters before the character reads it back.

**Webhooks (`/webhooks/napster`)**
- An HMAC-SHA256 signature over the raw body is checked in constant time before anything is parsed.
- Events are deduplicated by `eventId`. The body is capped at 64 KB.
- Without a configured secret, the endpoint refuses everything.

**Players and the browser API**
- Guest players get a random ID in a signed, `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production).
- No CORS is enabled, and all writes are JSON, so other sites can't act for a player.
- Each player sees only their own calls, transcripts and techniques.
- Requests are capped at 16 KB. Errors never return stack traces.
- Headers on every response: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  a `Permissions-Policy` that limits mic and camera to the game itself, and COOP. In production
  also `Strict-Transport-Security`.

**Credit protection**
- Dials are limited per player (6/min), per IP (12/min) and across the game (40/min).
- New guest players are limited per IP (30 per 10 min). Without this, a script that drops its
  cookie would get a fresh player, and fresh limits, on every request.
- One open call per player: a new dial ends the old one.
- The server ends any call after 10 minutes, whatever the browser does.
- Napster itself allows 5 concurrent sessions per transport and closes idle sessions after 3 minutes.
- Training fetches transcripts from Napster at most once every 15 s per player.

## Review findings (2026-11-09)

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Dial limits were per player only. Dropping the cookie gave a fresh player and fresh limits, so a script could open Napster sessions nonstop and add a database row per request. | High | Fixed: per-IP and game-wide dial limits, per-IP new-player limit |
| 2 | No server-side limit on call length; a call kept alive from the browser could run for hours. | Medium | Fixed: calls end after 10 minutes |
| 3 | HACK codes (8 words x 10,000) could be guessed by a script without ever calling anyone, at 6 tries/min. | Medium | Fixed: a code is accepted only after a character handed it over |
| 4 | `/api/training` had no rate limit and each request could trigger up to 3 Napster API calls. | Low | Fixed: rate limits on views and transcript fetches |
| 5 | The caller's claimed name was repeated verbatim in a tool reply the character reads (a small prompt-injection path). | Low | Fixed: names are stripped to letters and shortened |
| 6 | No security headers. | Low | Fixed (no Content-Security-Policy yet, see below) |
| 7 | The player's browser controls its own Napster session and can send `set_settings` (replace the character's prompt) or `role: "system"` messages from devtools. The character's reports drive trust, so a devtools user can talk the character into clearing Level 1. | Medium | Known limitation, see below |
| 8 | Redaction misses a code read out as spelled-out words ("five one three eight"). Only affects the player who heard the code anyway. | Info | Accepted |

`npm audit --omit=dev`: 0 vulnerabilities.

## Known limitations

- **Devtools can rewrite a character (finding 7).** This is how Napster's browser sessions work:
  whoever holds the session can send it commands. Cheating this way only affects the cheater's
  own game. It matters if a public leaderboard is added. Planned fix: before a level counts as
  cleared, check the call's transcript on the server, so the facts that raised trust must
  appear in what the player actually said.
- **No Content-Security-Policy yet.** The Napster Web SDK's media and network sources must be
  tested in a live call first.
- **Rate limits are in memory.** Fine for one server process (the planned deployment). Several
  instances would need a shared store.
