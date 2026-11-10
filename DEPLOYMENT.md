# Deployment

## Local

```bash
npm install
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
# Put the output in ROOM_CODE_PEPPER in .env
npm start
```

Browse to `http://localhost:3000`. For two-person testing, use two separate browser profiles or one normal and one private window.

## Render

- Web Service, Node runtime.
- Build: `npm install`
- Start: `npm start`
- Health check: `/healthz`
- Set `NODE_ENV=production`.
- Set a strong persistent `ROOM_CODE_PEPPER` (32+ characters).
- Set `ALLOWED_ORIGINS` to the exact HTTPS origin.
- Attach a persistent disk mounted at `/var/data` and set `DATABASE_PATH=/var/data/private-duo.sqlite`.
- Keep one instance only. Multiple instances need shared membership coordination, distributed Socket.IO adapter, and transactional capacity enforcement.
- Termination closes the database cleanly; persistent storage preserves message history.

Use HTTPS only in production. Never put `.env` or SQLite backups in the public static directory.
