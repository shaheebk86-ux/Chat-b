'use strict';
const { randomUUID } = require('node:crypto');
const { validateMessage, validateDisplayName } = require('./validation');
const HISTORY_LIMIT = 50;
function installSocketHandlers(io, manager, db) {
  const eventBuckets = new Map();
  function limited(socket, key, max = 12, windowMs = 10000) {
    const now = Date.now();
    const scope = ['create', 'join', 'resume'].includes(key) ? (socket.handshake.address || 'unknown') : (socket.data.participantId || socket.id);
    const id = `${scope}:${key}`;
    let bucket = eventBuckets.get(id);
    if (!bucket || now - bucket.start > windowMs) bucket = { start: now, count: 0 };
    bucket.count++; eventBuckets.set(id, bucket);
    return bucket.count <= max;
  }
  const history = roomId => db.prepare('SELECT m.id,m.content,m.created_at AS createdAt,m.participant_id AS participantId,p.display_name AS displayName FROM messages m JOIN participants p ON p.id=m.participant_id WHERE m.room_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT ?').all(roomId, HISTORY_LIMIT).reverse();
  io.on('connection', socket => {
    let identity = null;
    const objectPayload = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const reply = (ack, payload) => { if (typeof ack === 'function') ack(payload); };
    const presence = roomId => io.to(`room:${roomId}`).emit('presence:update', { participants: manager.participants(roomId) });
    const enter = (result, ack) => {
      if (!result.ok) return reply(ack, result);
      identity = { roomId: result.roomId, participantId: result.participantId, displayName: result.displayName };
      socket.data.participantId = identity.participantId;
      const old = manager.attach(identity.participantId, socket.id);
      if (old.replacedSocketId) {
        const previous = io.sockets.sockets.get(old.replacedSocketId);
        if (previous) {
          previous.emit('session:replaced');
          previous.disconnect(true); // Remove the superseded socket from every joined room immediately.
        }
      }
      socket.join(`room:${identity.roomId}`);
      reply(ack, { ok: true, code: result.code, participantId: result.participantId, token: result.token, displayName: result.displayName, count: result.count, history: history(identity.roomId), participants: manager.participants(identity.roomId) });
      presence(identity.roomId);
    };
    socket.on('room:create', (rawPayload, ack) => {
      const payload = objectPayload(rawPayload);
      if (identity) return reply(ack, { ok: false, error: 'ALREADY_IN_ROOM' });
      if (!limited(socket, 'create', 4, 60000)) return reply(ack, { ok: false, error: 'RATE_LIMITED' });
      const name = validateDisplayName(payload.displayName);
      if (!name.ok) return reply(ack, name);
      try { enter(manager.create(name.value), ack); } catch { reply(ack, { ok: false, error: 'SERVER_ERROR' }); }
    });
    socket.on('room:join', (rawPayload, ack) => {
      const payload = objectPayload(rawPayload);
      if (identity) return reply(ack, { ok: false, error: 'ALREADY_IN_ROOM' });
      if (!limited(socket, 'join', 8, 60000)) return reply(ack, { ok: false, error: 'RATE_LIMITED' });
      try { enter(manager.join(payload.code, payload.displayName), ack); } catch { reply(ack, { ok: false, error: 'SERVER_ERROR' }); }
    });
    socket.on('room:resume', (rawPayload, ack) => {
      const payload = objectPayload(rawPayload);
      if (identity) return reply(ack, { ok: false, error: 'ALREADY_IN_ROOM' });
      if (!limited(socket, 'resume', 10, 60000)) return reply(ack, { ok: false, error: 'RATE_LIMITED' });
      const auth = manager.authenticate(payload.code, payload.participantId, payload.token);
      if (!auth) return reply(ack, { ok: false, error: 'INVALID_SESSION' });
      enter({ ok: true, ...auth, code: payload.code, token: payload.token, count: manager.participants(auth.roomId).length }, ack);
    });
    socket.on('message:send', (rawPayload, ack) => {
      const payload = objectPayload(rawPayload);
      if (!identity || manager.activeSockets.get(identity.participantId) !== socket.id) return reply(ack, { ok: false, error: 'NOT_IN_ROOM' });
      if (!limited(socket, 'message', 30, 10000)) return reply(ack, { ok: false, error: 'RATE_LIMITED' });
      const valid = validateMessage(payload.content); if (!valid.ok) return reply(ack, valid);
      if (payload.messageId !== undefined && (typeof payload.messageId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.messageId))) return reply(ack, { ok: false, error: 'INVALID_MESSAGE_ID' });
      const id = payload.messageId || randomUUID(), createdAt = new Date().toISOString();
      try {
        const existing = db.prepare('SELECT m.id,m.room_id,m.participant_id,m.content,m.created_at AS createdAt,p.display_name AS displayName FROM messages m JOIN participants p ON p.id=m.participant_id WHERE m.id=?').get(id);
        if (existing) {
          if (existing.room_id !== identity.roomId || existing.participant_id !== identity.participantId || existing.content !== valid.value) return reply(ack, { ok: false, error: 'MESSAGE_ID_CONFLICT' });
          const message = { id: existing.id, content: existing.content, createdAt: existing.createdAt, participantId: existing.participant_id, displayName: existing.displayName };
          io.to(`room:${identity.roomId}`).emit('message:new', message);
          return reply(ack, { ok: true, message, duplicate: true });
        }
        db.prepare('INSERT INTO messages(id,room_id,participant_id,content,created_at) VALUES(?,?,?,?,?)').run(id, identity.roomId, identity.participantId, valid.value, createdAt);
        const message = { id, content: valid.value, createdAt, participantId: identity.participantId, displayName: identity.displayName };
        io.to(`room:${identity.roomId}`).emit('message:new', message);
        reply(ack, { ok: true, message, duplicate: false });
      } catch { reply(ack, { ok: false, error: 'SERVER_ERROR' }); }
    });
    socket.on('typing:update', rawPayload => {
      const payload = objectPayload(rawPayload);
      if (!identity || manager.activeSockets.get(identity.participantId) !== socket.id || !limited(socket, 'typing', 8, 5000)) return;
      socket.to(`room:${identity.roomId}`).emit('typing:update', { participantId: identity.participantId, displayName: identity.displayName, typing: Boolean(payload.typing) });
    });
    socket.on('history:older', (rawPayload, ack) => {
      const payload = objectPayload(rawPayload);
      if (!identity || manager.activeSockets.get(identity.participantId) !== socket.id) return reply(ack, { ok: false, error: 'NOT_IN_ROOM' });
      if (!limited(socket, 'history', 20, 10000)) return reply(ack, { ok: false, error: 'RATE_LIMITED' });
      const before = typeof payload.before === 'string' ? payload.before : new Date().toISOString();
      const rows = db.prepare('SELECT m.id,m.content,m.created_at AS createdAt,m.participant_id AS participantId,p.display_name AS displayName FROM messages m JOIN participants p ON p.id=m.participant_id WHERE m.room_id=? AND m.created_at<? ORDER BY m.created_at DESC,m.id DESC LIMIT ?').all(identity.roomId, before, HISTORY_LIMIT).reverse();
      reply(ack, { ok: true, messages: rows });
    });
    socket.on('room:leave', (_payload, ack) => {
      if (!identity) return reply(ack, { ok: true });
      const roomId = manager.leave(identity.participantId, socket.id);
      socket.leave(`room:${identity.roomId}`); identity = null; delete socket.data.participantId;
      if (roomId) presence(roomId);
      reply(ack, { ok: true });
    });
    socket.on('disconnect', () => {
      if (!identity) return;
      const current = identity; identity = null;
      manager.disconnect(current.participantId, socket.id, roomId => presence(roomId));
      socket.to(`room:${current.roomId}`).emit('typing:update', { participantId: current.participantId, typing: false });
      presence(current.roomId);
    });
  });
  const cleanup = setInterval(() => {
    const cutoff = Number(process.env.MESSAGE_RETENTION_DAYS || 0);
    if (cutoff > 0) db.prepare("DELETE FROM messages WHERE created_at < datetime('now', ?)").run(`-${cutoff} days`);
    for (const [key, bucket] of eventBuckets) if (Date.now() - bucket.start > 120000) eventBuckets.delete(key);
  }, 60000);
  cleanup.unref?.();
  return () => clearInterval(cleanup);
}
module.exports = { installSocketHandlers, HISTORY_LIMIT };
