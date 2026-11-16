# Code guide: what every file does

A walk through the whole repo, folder by folder. Start with "The big picture", then read
the folder you're about to change.

---

## The big picture

```
Player's browser (React)                 Our server (Node + Express)            Napster cloud
─────────────────────────                ───────────────────────────            ─────────────
Desktop, apps, fake websites  ──/api──►  game rules, codes, database   ◄─────► AI characters
Phone app ◄──── voice/video (WebRTC, Napster Web SDK) ─────────────────────────► (Timur, Anna, Erik)
                                         /tools/*  ◄── the character calls our tools mid-call
                                         /webhooks ◄── "call ended" notice
```

One call, start to finish:
1. The player dials 04 555 0214 in the **Phone** app. The browser asks our server for a call.
2. The server (`calls/router.js`) finds which level that number belongs to and asks Napster for a
   session with that level's character. It sends tags that tie the session to this player and
   call, plus `office_news` (security notices from levels the player already won).
3. The player talks to Erik by voice. After each thing the player says, Erik silently calls our
   **assess_caller** tool (`tools/router.js`). Our server scores it with fixed rules
   (`game/trust.js`) and tells Erik how he feels ("you mostly believe them...").
4. When Erik decides to reset a password, he calls **request_code**. Our server checks the
   facts (`game/levelRules.js`): right name, right employee ID, right department, name not
   burned, trust high enough. Only then does it send back this player's code.
5. Erik reads the code out loud. The player types it into **HACK** (`hack/router.js`). The server
   recomputes the code, compares, and clears the level.
6. Napster tells us the call ended (`webhooks/router.js`). We fetch the transcript, detect the
   techniques used (`game/techniques.js`), and the **Training** app shows the debrief.

The rule that holds it all together: **the AI never decides alone.** Characters judge, but
codes come only from our server, after our checks. Codes are never stored. They're
recalculated from a secret each time (`game/codes.js`).

---

## Root folder

| File | What it does |
|---|---|
| `package.json` | One project with two parts (`backend`, `frontend`). Scripts: `npm run dev` (play locally), `npm run setup` (create the characters on Napster), `npm test`, `npm run playtest:text` (scripted text calls), `npm run build`. |
| `.env.example` | The settings you must fill in (Napster key, secrets, public URL). The real `.env` is never committed. |
| `CLAUDE.md` | The project brief: rules, level plan, architecture, submission checklist. |
| `SECURITY.md` | How the game protects itself: secrets, rate limits, what the browser can and can't see. |
| `napster-findings.md` | Things learned about the Napster API while building (quirks, field names). |
| `playtest-log.md` | Every test call: date, level, caller, result. Used to tune difficulty. |
| `story/` | Level stories written before building: a draft or sketch for each level. |
| `docs/code-guide.md` | This file. |

---

## `backend/src`: the server

### Starting up
| File | What it does |
|---|---|
| `server.js` | Builds the Express app and plugs everything in: player cookies, `/api/content`, `/api/hack`, `/api/mail`, `/api/training`, `/api/calls`, `/tools`, `/webhooks`. Adds security headers to every response and hides error details from the browser. `main()` runs it on port 3000. |
| `config.js` | Reads `.env` and checks every setting (key present, secrets long enough). `publicUrl()` builds every URL Napster calls from `PUBLIC_BASE_URL`, so nothing is hard-coded. |
| `db.js` | Opens the SQLite database and runs migrations (numbered schema steps, never edited once shipped). Tables: `players`, `calls` (one row per phone call, including live trust), `tool_calls` (every assess_caller / request_code / silence event), `cleared_levels`, `webhook_events`, `player_techniques`. |

### Players
| File | What it does |
|---|---|
| `lib/players.js` | Guest players with no accounts. First visit: a random player ID in a signed, HttpOnly cookie. Also builds the `externalClientId` we give Napster (`p_<player>_L<level>_a<attempt>`), so each Napster session maps back to one player and attempt. Caps new players per IP. |
| `lib/rateLimit.js` | A tiny in-memory limiter ("at most N per minute per key"). Used on dials, HACK guesses, mail logins, tools. |

### Game rules (`game/`)
| File | What it does |
|---|---|
| `content.js` | Loads all game data from `backend/data` at startup and **checks it**: every level has a valid voice, prompt, code words, trust rules; no prompt or public page contains anything code-shaped; inbox emails are complete. A broken file stops the server with a clear list of problems. Returns the content (staff, levels, OSINT pages, prompts, mailboxes). |
| `publicContent.js` | What the browser may see, built from an allow-list: the target board, briefings for unlocked levels, and the fake websites (including the leaked PDF). Never prompts, private facts, code words, accepted names or inboxes. |
| `codes.js` | `codeFor(secret, player, level, words)` makes a code like `HERON-4821` from a secret, so every player gets a different code and nothing is stored. `codesMatch()` compares in constant time and forgives formatting ("heron 4821"). |
| `names.js` | Forgiving name matching, because speech-to-text writes "Marc Kellar". Ignores case, accents and titles, and allows one wrong letter. `samePerson()` spots a caller switching identities. |
| `levelRules.js` | The **facts lock** of each level, one check per type. `manager_name` (Level 1: claim to be Mark). `host_with_reason` (Level 2: a real host plus a matching visit). `employee_reset` (Level 3: Nadia plus ID `VL-0388` plus Executive Office; executives refused). Also `mentionsAny()` (keyword matching) and `employeeIdDigits()` ("V L 0 3 8 8" becomes "0388"). |
| `trust.js` | The **trust meter**. Turns each assess_caller report into points with fixed rules: identity bonus, each fact from the level's evidence list counts once, red flags cost points, gut feeling is capped. Burned names cost 25 and can't earn trust back. `guidanceFor()` turns the score into a feeling for the character ("you mostly believe them"); each level can override the wording. |
| `playerHistory.js` | **Viktor's memory** (levels with `remembersPlayer`). Built when the call starts and passed in as `player_history`: the names that won earlier levels, the methods this player has used, and earlier calls to him and how they ended. Caller-chosen names are cleaned; no code ever appears. |
| `wordTravels.js` | **Word travels.** `burnedNames()` lists names that already won an earlier level for this player (refused and penalised later). `officeNews()` lists the security notices later characters have heard. |
| `techniques.js` | After a call, works out which social-engineering techniques the player used (pretexting, OSINT, urgency, prompt injection...) from the trust log and the transcript. `trustMoves()` lists what moved the meter, for the debrief. |

### API routes
| File | What it does |
|---|---|
| `calls/router.js` | The Phone. `lookup` says whether a number connects. `POST /api/calls` creates a Napster session for that level's character (with tags and office_news) and returns the token. Status polling (trust meter, did they hang up). Silence reports (lower trust). Hang-up. A sweeper ends calls over 10 minutes. Several rate limits protect your Napster credits. |
| `tools/router.js` | The endpoints **Napster's characters** call mid-call. Every request needs the shared secret header plus signed call tags. **assess_caller** updates the trust meter, returns guidance, and schedules a hang-up if trust hits the floor. **request_code** runs the checks in order (changed story, too many refusals, burned name, trust too low, then the level's facts check) and only then returns the code. |
| `hack/router.js` | The HACK app. Finds the player's open level, recomputes their code, compares, and clears the level. Only works if a character really handed the code over on a call, so codes can't be guessed. Returns the debrief and `afterHack` (Level 3: "log into VitalNet Mail"). |
| `mail/router.js` | **VitalNet Mail.** `POST /api/mail/login` opens an inbox only if that level is cleared and the password is this player's own code. Every failure gives the same "wrong login" answer. |
| `files/router.js` | **VitalNet Files.** `POST /api/files/open` opens the locked Sandgrouse folder only if Level 5 is cleared and the code is this player's own. Same rules as VitalNet Mail. |
| `debrief/router.js` | The Training app's data: one debrief per finished call (outcome, trust moves, techniques, defences, transcript with codes hidden). |
| `debrief/processCall.js` | After a call: fetches the transcript and cost from Napster, detects techniques, saves them to the player's collection. |
| `webhooks/router.js` | Receives Napster's "session closed" webhook, checks its signature, ignores duplicates, answers fast, then runs `processCall`. |

### Napster
| File | What it does |
|---|---|
| `napster/client.js` | A small wrapper around the Napster REST API (`X-Api-Key` header, errors with status codes). The key never leaves the server. |
| `napster/ids.js` | Reads and saves the IDs `npm run setup` created (agents, tools, faces), one file per Napster project. Gitignored. |
| `lib/callTags.js` | Signs the tags attached to each Napster session (call ID, player, level), so a tool call can't be forged for someone else's call. |
| `tools/constants.js` | The name of the secret header Napster sends to our tools. |

---

## `backend/data`: the game content (no code)

| File | What it holds |
|---|---|
| `staff.json` | Every fictional person: role, department, manager, employee ID, phone, how they speak, public facts (findable online) and private facts (only learnable on calls). |
| `levels.json` | The phone book (number to level) and, per level: character settings (voice, opening line), code words, the facts check and its replies, trust rules, silence lines, briefing, debrief, rumour (word travels), and for Level 3 `afterHack` and `mailbox`. |
| `prompts/level-N-*.txt` | Each character's instructions (personality, what they know, rules). Never contain a code. |
| `osint/website.json` | The company site: home, about, team, careers (with the PDF link), news, contact. |
| `osint/worknet.json` | WorkNet profiles and posts (who reports to whom, audit week, interviews, new joiners). |
| `osint/pixa.json` | Pixa photo accounts (Timur's fishing and badge photo, Anna's cat and karak, Nadia's office selfie with her badge). A post's `badges` list draws readable or turned-around staff badges. |
| `osint/onboarding.json` | The **leaked New Joiner Guide** PDF: ID format, VitalNet, ext. 214. |
| `inbox/nadia-rahman.json` | **Nadia's inbox** (server-only): 1 ad, story emails showing the damage from Levels 1–2, a phishing email, and 2 gold emails for Level 4. |
| `techniques.json` | Text for each technique in the debrief: what you did, the real-world version, the defence. |

---

## `frontend/src`: the game screen (React)

### Shell
| File | What it does |
|---|---|
| `main.jsx` | Starts React. |
| `App.jsx` | The fake desktop: loads `/api/content`, shows icons, the target board and the taskbar, and opens apps in windows (full screen, one at a time, on phones). |
| `api.js` | Every call to our server in one place (`getContent`, `submitHack`, `mailLogin`, `dialCall`...). |
| `os/Window.jsx`, `os/useWindows.js` | Draggable windows and which one is on top. |
| `os/Taskbar.jsx`, `os/icons.jsx` | The bottom bar, clock, and the hand-drawn app icons. |
| `os/TargetBoard.jsx` | The 5 targets. Locked ones stay anonymous; cleared ones get a stamp. |

### Apps
| File | What it does |
|---|---|
| `apps/Mail.jsx` | NIGHTJAR's mission briefings, one per unlocked level, with links that open the Browser. |
| `apps/Browser.jsx` | The in-game web browser: tabs, back/forward, address bar, bookmarks. Picks which fake site to show from the address. |
| `apps/Phone.jsx` | The smartphone overlay: dial pad, contacts, recent calls, in-call screen (timer, mute, video, trust meter), mic permission explainer. |
| `apps/Hack.jsx` | The terminal: type a code, ACCESS GRANTED or DENIED, the debrief, and the hint for VitalNet Mail. |
| `apps/Notes.jsx` | A notepad for recon, saved in this browser. |
| `apps/Training.jsx` | Debrief cards for each call and the technique collection. |

### Phone internals
| File | What it does |
|---|---|
| `phone/callSession.js` | One call through the Napster Web SDK. Our server creates the session; the SDK only sees a short-lived token. Handles voice versus video, the hang-up, and call-ended events. |
| `phone/silenceWatch.js` | If the player goes quiet: a "hello?" check-in, then the character gets uneasy (trust drops), then hangs up. |
| `phone/contacts.js` | Contacts and recent calls, saved in the browser. Numbers are added as the player discovers them. |

### Fake websites (`sites/`)
| File | What it does |
|---|---|
| `route.js` | Turns an address like `mail.vitality-logistics.ae` into a site plus path. Shortcuts: typing `pixa`, `worknet`, `mail` or `vitalnet`. |
| `StartPage.jsx` | The new-tab page with tiles for each site. |
| `VitalitySite.jsx` | The company website (light, corporate). Also the **Careers page with the PDF link** and the **PDF viewer** for `vitality-logistics.ae/files/new-joiner-guide-2024.pdf`. |
| `WorkNet.jsx` | The professional network: search, profiles, "reports to", posts. |
| `Pixa.jsx` | The photo app: accounts, photo grid, captions, comments. |
| `VitalNetMail.jsx` | **VitalNet Mail**: the login form, then Nadia's inbox (list plus reading pane). The inbox comes from the server only after a correct login. |
| `VitalNetFiles.jsx` | **VitalNet Files**: the shared drive. Every folder but Sandgrouse says "no access"; Sandgrouse asks for the folder code, then shows the sale documents the server sends back. |

### Styles
| File | What it does |
|---|---|
| `styles/os.css` | The dark desktop, windows, phone, HACK terminal, Training app. |
| `styles/sites.css` | Each fake site's own look (Vitality, WorkNet, Pixa, the PDF viewer, VitalNet Mail). |

---

## `scripts/`: tools you run

| File | What it does |
|---|---|
| `setup.js` + `lib/napsterSetup.js` | `npm run setup`. Creates or updates everything on Napster: the two tools (`request_code`, `assess_caller`, pointing at our public URL with the secret header), a face per character, and an agent per level with its prompt, voice and opening line. Safe to re-run: finds existing items by tag and updates them. |
| `dev.js` | `npm run dev`. Starts the backend and the Vite frontend together. |
| `playtest-text.js` + `playtest/personas.js` | `npm run playtest:text -- <persona ids>`. Scripted callers over cheap text sessions. Each persona says fixed lines and is expected to get the code or not. Earlier levels count as won (Mark, Laura) so word travels is tested. Results go to `playtest-log.md`. |
| `assets/portraits/` | Character portrait images, once they exist. |

---

## `backend/test`: automated tests (`npm test`, 109 tests)

One file per area: `config`, `db`, `players`, `content`, `public-content`, `game` (codes and names),
`trust`, `tools`, `calls`, `silence`, `hack`, `debrief`, `napster-client`, `setup`, plus
`level2.test.js` and `level3.test.js` for the per-level rules (word travels, the employee ID
check, VitalNet Mail login, and that inboxes never reach the public content).
