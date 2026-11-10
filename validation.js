'use strict';
const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{12}$/;
const NAME_RE = /^[\p{L}\p{N} ._'’-]{1,32}$/u;
const MAX_MESSAGE_LENGTH = 4000;
function normalizeRoomCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase().replace(/[\s-]/g, '');
  return ROOM_CODE_RE.test(code) ? code : null;
}
function validateDisplayName(value) {
  if (typeof value !== 'string') return { ok: false, error: 'Enter a display name.' };
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 32 || !NAME_RE.test(name)) return { ok: false, error: 'Use 1–32 letters, numbers, spaces, or . _ ’ - characters.' };
  return { ok: true, value: name };
}
function validateMessage(value) {
  if (typeof value !== 'string') return { ok: false, error: 'Message must be text.' };
  const content = value.trim();
  if (!content) return { ok: false, error: 'Write a message first.' };
  if (content.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.` };
  return { ok: true, value: content };
}
function validateSessionToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{40,100}$/.test(value);
}
module.exports = { ROOM_CODE_RE, MAX_MESSAGE_LENGTH, normalizeRoomCode, validateDisplayName, validateMessage, validateSessionToken };
