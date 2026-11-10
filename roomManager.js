'use strict';
const { randomUUID } = require('node:crypto');
const { createRoomCode, hashRoomCode, createSessionToken, hashSessionToken, safeEqualHex } = require('./security');
const { normalizeRoomCode, validateDisplayName, validateSessionToken } = require('./validation');

class RoomManager {
  constructor(db, pepper, graceSeconds = 90) {
    this.db = db; this.pepper = pepper; this.graceMs = graceSeconds * 1000;
    this.activeSockets = new Map(); // participant id -> socket id
    this.graceTimers = new Map();
    // A process restart loses live sockets; give persisted sessions a fresh reconnect window.
    const restartNow = new Date().toISOString();
    db.prepare("UPDATE participants SET disconnected_at=? WHERE status='active'").run(restartNow);
    for (const row of db.prepare("SELECT id,room_id FROM participants WHERE status='active'").all()) this.scheduleExpiry(row.id, row.room_id, () => {});
    this.createRoomTx = db.transaction((roomId, codeHash, now, participantId, name, tokenHash) => {
      db.prepare('INSERT INTO rooms(id,code_hash,created_at,status) VALUES(?,?,?,\'open\')').run(roomId, codeHash, now);
      db.prepare('INSERT INTO participants(id,room_id,display_name,token_hash,created_at,last_seen_at) VALUES(?,?,?,?,?,?)').run(participantId, roomId, name, tokenHash, now, now);
    });
    this.joinTx = db.transaction((roomId, participantId, name, tokenHash, now) => {
      const room = db.prepare('SELECT id,status FROM rooms WHERE id=?').get(roomId);
      if (!room || room.status !== 'open') return { error: 'ROOM_NOT_FOUND' };
      const count = db.prepare("SELECT COUNT(*) AS n FROM participants WHERE room_id=? AND status='active'").get(roomId).n;
      if (count >= 2) return { error: 'ROOM_FULL' };
      db.prepare('INSERT INTO participants(id,room_id,display_name,token_hash,created_at,last_seen_at) VALUES(?,?,?,?,?,?)').run(participantId, roomId, name, tokenHash, now, now);
      return { ok: true };
    });
  }
  create(name) {
    const valid = validateDisplayName(name); if (!valid.ok) return valid;
    let code, codeHash;
    for (let i = 0; i < 5; i++) {
      code = createRoomCode(); codeHash = hashRoomCode(code, this.pepper);
      if (!this.db.prepare('SELECT 1 FROM rooms WHERE code_hash=?').get(codeHash)) break;
      code = null;
    }
    if (!code) throw new Error('Could not allocate a unique room code');
    const now = new Date().toISOString(), roomId = randomUUID(), participantId = randomUUID(), token = createSessionToken();
    this.createRoomTx(roomId, codeHash, now, participantId, valid.value, hashSessionToken(token));
    return { ok: true, code, roomId, participantId, token, displayName: valid.value, count: 1 };
  }
  join(rawCode, name) {
    const code = normalizeRoomCode(rawCode); if (!code) return { ok: false, error: 'INVALID_CODE' };
    const valid = validateDisplayName(name); if (!valid.ok) return valid;
    const codeHash = hashRoomCode(code, this.pepper);
    const room = this.db.prepare('SELECT id FROM rooms WHERE code_hash=? AND status=\'open\'').get(codeHash);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    const participantId = randomUUID(), token = createSessionToken(), now = new Date().toISOString();
    try {
      const result = this.joinTx.immediate(room.id, participantId, valid.value, hashSessionToken(token), now);
      if (result.error) return { ok: false, error: result.error };
    } catch (error) {
      if (String(error.code).startsWith('SQLITE_CONSTRAINT')) return { ok: false, error: 'ROOM_FULL' };
      throw error;
    }
    return { ok: true, code, roomId: room.id, participantId, token, displayName: valid.value, count: 2 };
  }
  authenticate(code, participantId, token) {
    if (!normalizeRoomCode(code) || typeof participantId !== 'string' || !validateSessionToken(token)) return null;
    const room = this.db.prepare('SELECT id FROM rooms WHERE code_hash=? AND status=\'open\'').get(hashRoomCode(code, this.pepper));
    if (!room) return null;
    const participant = this.db.prepare("SELECT * FROM participants WHERE id=? AND room_id=? AND status='active'").get(participantId, room.id);
    if (!participant || !safeEqualHex(participant.token_hash, hashSessionToken(token))) return null;
    return { roomId: room.id, participantId, displayName: participant.display_name };
  }
  attach(participantId, socketId) {
    const old = this.activeSockets.get(participantId);
    this.activeSockets.set(participantId, socketId);
    const timer = this.graceTimers.get(participantId); if (timer) clearTimeout(timer);
    this.graceTimers.delete(participantId);
    this.db.prepare('UPDATE participants SET disconnected_at=NULL,last_seen_at=? WHERE id=?').run(new Date().toISOString(), participantId);
    return { replacedSocketId: old && old !== socketId ? old : null };
  }
  scheduleExpiry(participantId, roomId, onExpired) {
    const timer = setTimeout(() => {
      this.graceTimers.delete(participantId);
      if (this.activeSockets.has(participantId)) return;
      this.db.prepare("UPDATE participants SET status='left',token_hash=? WHERE id=? AND status='active'").run(require('node:crypto').randomBytes(32).toString('hex'), participantId);
      onExpired?.(roomId, participantId);
    }, this.graceMs);
    timer.unref?.(); this.graceTimers.set(participantId, timer);
  }
  disconnect(participantId, socketId, onExpired) {
    if (this.activeSockets.get(participantId) !== socketId) return;
    this.activeSockets.delete(participantId);
    this.db.prepare('UPDATE participants SET disconnected_at=?,last_seen_at=? WHERE id=?').run(new Date().toISOString(), new Date().toISOString(), participantId);
    const row = this.db.prepare('SELECT room_id FROM participants WHERE id=?').get(participantId);
    if (row) this.scheduleExpiry(participantId, row.room_id, onExpired);
  }
  leave(participantId, socketId) {
    if (socketId && this.activeSockets.get(participantId) !== socketId) return null;
    const row = this.db.prepare('SELECT room_id FROM participants WHERE id=?').get(participantId);
    if (!row) return null;
    this.activeSockets.delete(participantId);
    const timer = this.graceTimers.get(participantId); if (timer) clearTimeout(timer);
    this.graceTimers.delete(participantId);
    this.db.prepare("UPDATE participants SET status='left',token_hash=? WHERE id=?").run(require('node:crypto').randomBytes(32).toString('hex'), participantId);
    return row.room_id;
  }
  roomByCode(code) {
    const normalized = normalizeRoomCode(code); if (!normalized) return null;
    return this.db.prepare('SELECT id FROM rooms WHERE code_hash=?').get(hashRoomCode(normalized, this.pepper)) || null;
  }
  participants(roomId) {
    return this.db.prepare("SELECT id,display_name,disconnected_at FROM participants WHERE room_id=? AND status='active' ORDER BY created_at").all(roomId)
      .map(p => ({ id: p.id, displayName: p.display_name, online: this.activeSockets.has(p.id) }));
  }
  shutdown() { for (const timer of this.graceTimers.values()) clearTimeout(timer); this.graceTimers.clear(); }
}
module.exports = { RoomManager };
