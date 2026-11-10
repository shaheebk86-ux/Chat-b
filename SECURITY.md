# Security and privacy notes

- Room codes are twelve characters from a reduced ambiguity alphabet, generated with `crypto.randomBytes`; the database stores an HMAC hash keyed by `ROOM_CODE_PEPPER`.
- Participant session tokens are random 256-bit bearer values; only SHA-256 token hashes are stored. Browser storage is tab-scoped `sessionStorage`.
- SQLite uses parameterized statements, foreign keys, WAL, and a busy timeout. User content is rendered with DOM text nodes / `textContent`.
- Express uses Helmet, restrictive CSP, JSON body limits, and API rate limiting. Socket.IO checks exact allowed origins, caps packet size, and rate-limits room and message events.
- The server is authoritative for room membership and the two-participant capacity.
- HTTPS is required in production. CORS/origin checks are not a replacement for authentication.
- Display names are unverified. Room codes and session tokens are bearer access credentials.
- **No end-to-end encryption is implemented.** Messages are plaintext at the server and in SQLite. The operator can access them. Use HTTPS to protect transport and restrict access to the host, disk, and backups.
- Run a single server instance. In-memory socket coordination is not shared between replicas.
