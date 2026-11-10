# Test and verification record

## Automated checks

Run with Node.js 20.11+ and a working npm registry:

```bash
npm install
npm run check
npm test
```

The test suite covers:

- Room-code format, normalization, malformed inputs, display-name and message validation, and session-token hashing.
- SQLite schema initialization, foreign keys, message persistence, and WAL behavior on file-backed databases.
- Room creation, two-participant capacity, explicit leave, reconnect identity, and competing joins.
- Socket.IO room creation/join, two-way message delivery, private history access, typing events, third-participant rejection, explicit leave acknowledgements, malformed payloads, and forced disconnection of a superseded socket.

## Execution status in the packaging environment

- `npm run check`: passed after the final source edits.
- `node --test tests/validation.test.js`: passed (3 tests).
- HTML static check: no duplicate element IDs; local app.js and style.css references resolve.
- Chromium UI shell checks (HTML/CSS/app.js embedded in a test document with Socket.IO intentionally unavailable): all nine requested widths (320, 360, 375, 390, 430, 768, 1024, 1366, 1920px) had no horizontal overflow and no browser JavaScript page errors. Theme toggle and local preference persistence passed. The actual networked chat was not tested in this browser pass.
- Full `npm test`: **blocked**, not passed. Dependencies are absent because npm registry DNS resolution failed (`EAI_AGAIN registry.npmjs.org`). The database and Socket.IO tests could not execute.
- Networked browser automation of the real chat, physical-device testing, and Render deployment were not available in this environment.

Do not interpret authored tests as executed tests. After installing dependencies, run the commands above and retain the full TAP output as the runtime verification record. Then manually test two separate browser profiles and the viewport widths listed in the project brief.
