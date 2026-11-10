# QA report — PRIVATE DUO CHAT

Date: 2026-11-10

## Executed successfully

| Check | Result | Scope |
|---|---|---|
| `npm run check` | Pass | JavaScript syntax checks for server, browser, and test files |
| `node --test tests/validation.test.js` | Pass: 3/3 | Pure validation and cryptographic utility tests |
| SQLite schema execution | Pass | Extracted schema executed with Python's SQLite engine; tables, indexes, foreign keys, message persistence, WAL, and two-slot count verified |
| Chromium responsive layout | Pass: 9/9 widths | UI shell rendered at 320, 360, 375, 390, 430, 768, 1024, 1366, and 1920 CSS pixels; no horizontal overflow or page errors |
| Theme toggle | Pass | Dark-to-light transition and local preference persistence verified in browser harness |
| HTML structure | Pass | No duplicate IDs; local app stylesheet and script references exist |
| ZIP integrity | Pass | Rebuilt archive passed `unzip -t` |

## Blocked / not executed

| Check | Status | Reason |
|---|---|---|
| `npm install` | Blocked | `EAI_AGAIN registry.npmjs.org` DNS failure |
| Full `npm test` | Blocked | Required packages (`better-sqlite3`, `socket.io`, etc.) are not installed |
| Node better-sqlite3 integration | Not executed | Dependency unavailable; Python SQLite schema check is not a substitute for driver testing |
| Socket.IO live integration | Not executed | Socket.IO server/client dependencies unavailable |
| Two real browser chat clients | Not executed | Requires running backend and installed dependencies |
| Production CORS / rate-limit runtime | Not executed | Requires installed Express/Socket.IO dependencies and a running server |
| Render deployment | Not executed | Requires deployment account, persistent disk, secrets, and network access |
| Real Android/iOS devices | Not executed | Chromium desktop viewport simulation is not a physical-device test |

## Repairs made during QA

- Fixed the `room:leave` acknowledgement argument position.
- Normalized malformed/null Socket.IO payloads.
- Force-disconnect superseded sockets after notifying the old client, preventing stale room subscriptions and reconnect ping-pong.
- Removed duplicate reconnect listener on initial page restore.
- Increased room codes to 12 characters (60 bits from a 32-symbol alphabet).
- Use SQLite `BEGIN IMMEDIATE` semantics for capacity-checked joins.
- Added client message UUIDs and idempotent retry handling.
- Removed the internal room database ID from the browser response.
- Validate production HTTPS origins and numeric environment settings.
- Make `/healthz` check the SQLite connection.
- Added regression assertions for session replacement, malformed payloads, duplicate message retries, and leave acknowledgements.

## Release gate

This project is **not yet runtime-certified**. Run `npm install`, `npm run check`, and `npm test` on a network-enabled Node.js 20.11+ host. Fix any failing integration tests before public deployment. Then execute the two-browser scenario and deployment checks from `docs/TESTING.md` and `docs/DEPLOYMENT.md`.

## Final rerun in the packaging environment

- `npm run check`: **PASS** (all configured JavaScript syntax checks).
- `npm test`: **BLOCKED / FAILS BEFORE TEST EXECUTION** because `better-sqlite3` and `socket.io` are not installed. Three validation tests ran and passed; the database, room-manager, and Socket.IO test files could not load their dependencies.
- `npm install --no-audit --no-fund`: **TIMED OUT** while attempting to reach the npm registry. Direct DNS lookup for `registry.npmjs.org` also failed (`Could not resolve host`).
- `package-lock.json`: currently contains only the root package manifest, not a fully resolved dependency tree. Run `npm install` with registry access to generate the complete lockfile before using `npm ci` or deploying.

This archive contains the complete application source and test suite, but it is not a self-contained offline installer and must not be described as fully runtime-tested. No live chat or production deployment success is claimed.
