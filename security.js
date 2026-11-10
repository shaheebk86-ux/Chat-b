'use strict';
const crypto = require('node:crypto');
const { normalizeRoomCode } = require('./validation');
function createRoomCode() {
  // A 32-symbol alphabet and 12 characters provide 60 bits of entropy.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}
function hashRoomCode(code, pepper) {
  const normalized = normalizeRoomCode(code);
  if (!normalized) throw new Error('Invalid room code');
  return crypto.createHmac('sha256', pepper).update(normalized).digest('hex');
}
function createSessionToken() { return crypto.randomBytes(32).toString('base64url'); }
function hashSessionToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
module.exports = { createRoomCode, hashRoomCode, createSessionToken, hashSessionToken, safeEqualHex };
