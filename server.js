'use strict';
require('dotenv').config();
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Server } = require('socket.io');
const { initializeDatabase } = require('./database');
const { RoomManager } = require('./roomManager');
const { installSocketHandlers } = require('./socketHandler');

const required = ['ROOM_CODE_PEPPER'];
for (const key of required) if (!process.env[key] || process.env[key].length < 32) throw new Error(`${key} must be set to at least 32 characters`);
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
const retentionDays = Number(process.env.MESSAGE_RETENTION_DAYS || 0);
if (!Number.isInteger(retentionDays) || retentionDays < 0 || retentionDays > 36500) throw new Error('MESSAGE_RETENTION_DAYS must be an integer between 0 and 36500');
const graceSeconds = Number(process.env.DISCONNECT_GRACE_SECONDS || 90);
if (!Number.isInteger(graceSeconds) || graceSeconds < 1 || graceSeconds > 3600) throw new Error('DISCONNECT_GRACE_SECONDS must be an integer between 1 and 3600');
const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(v => v.trim()).filter(Boolean);
for (const origin of origins) {
  let parsed;
  try { parsed = new URL(origin); } catch { throw new Error('ALLOWED_ORIGINS must contain exact origins, not URLs with paths or wildcards'); }
  if (parsed.origin !== origin || (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) throw new Error('Production ALLOWED_ORIGINS entries must be exact HTTPS origins');
}
if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) throw new Error('ALLOWED_ORIGINS must be explicitly configured in production');
const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'", 'ws:', 'wss:'], imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"], upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null } } }));
app.use(express.json({ limit: '16kb' }));
app.use('/api/', rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
app.get('/healthz', (_req, res) => {
  try { db.prepare('SELECT 1').get(); return res.status(200).json({ ok: true, service: 'private-duo-chat' }); }
  catch { return res.status(503).json({ ok: false, service: 'private-duo-chat' }); }
});
app.use(express.static(path.join(__dirname, '..', 'frontend'), { etag: true, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.use((err, _req, res, _next) => { if (err instanceof SyntaxError) return res.status(400).json({ error: 'Invalid request.' }); res.status(500).json({ error: 'Something went wrong.' }); });
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin(origin, callback) { if (!origin || origins.includes(origin)) return callback(null, true); return callback(new Error('Origin not allowed')); }, methods: ['GET', 'POST'] },
  allowRequest: (req, callback) => { const origin = req.headers.origin; callback(null, !origin || origins.includes(origin)); },
  maxHttpBufferSize: 1e5, pingInterval: 25000, pingTimeout: 20000
});
const dbPath = path.resolve(process.env.DATABASE_PATH || './data/private-duo.sqlite');
const db = initializeDatabase(dbPath);
const manager = new RoomManager(db, process.env.ROOM_CODE_PEPPER, graceSeconds);
const stopCleanup = installSocketHandlers(io, manager, db);
server.listen(port, '0.0.0.0', () => console.log(`PRIVATE DUO CHAT listening on ${port}`));
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopCleanup(); manager.shutdown();
  const forceExit = setTimeout(() => process.exit(1), 5000); forceExit.unref();
  io.close(() => { clearTimeout(forceExit); db.close(); process.exit(0); });
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
module.exports = { app, server, io, db, manager };
