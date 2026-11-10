'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = { socket: null, room: null, seen: new Set(), lastDateLabel: '', typingTimer: null, toastTimer: null, remoteTypingTimer: null, connected: false, busy: false, sessionReplaced: false, pendingMessage: null };
  const SESSION_KEY = 'pdc.session.v1';
  const savedTheme = localStorage.getItem('pdc.theme');
  const theme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark';
  document.documentElement.dataset.theme = theme;
  const updateThemeIcons = () => { $('themeIcon').textContent = document.documentElement.dataset.theme === 'dark' ? '☼' : '☾'; $('chatThemeToggle').textContent = $('themeIcon').textContent; };
  updateThemeIcons();
  function toggleTheme() { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; localStorage.setItem('pdc.theme', next); updateThemeIcons(); }
  $('themeToggle').addEventListener('click', toggleTheme); $('chatThemeToggle').addEventListener('click', toggleTheme);
  $('year').textContent = new Date().getFullYear();
  function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove('visible'), 2600); }
  function setServer(online, label) { $('serverDot').className = `status-dot ${online ? 'online' : 'offline'}`; $('serverLabel').textContent = label; }
  function setConnection(online, label) { $('chatConnectionDot').className = `status-dot ${online ? 'online' : 'offline'}`; $('chatConnectionText').textContent = label; $('messageInput').disabled = !online; $('sendBtn').disabled = !online || !$('messageInput').value.trim(); }
  function saveSession() { if (state.room) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: state.room.code, participantId: state.room.participantId, token: state.room.token, displayName: state.room.displayName })); }
  function clearSession() { sessionStorage.removeItem(SESSION_KEY); state.room = null; }
  function friendlyError(code) { return ({ INVALID_CODE: 'Enter a valid 12-character room code.', ROOM_NOT_FOUND: 'That room does not exist. Check the code and try again.', ROOM_FULL: 'This room is full. Only two participants can join.', INVALID_SESSION: 'Your room session is no longer valid. Please join again.', RATE_LIMITED: 'Too many attempts. Please wait a moment.', ALREADY_IN_ROOM: 'You are already in a room. Leave it before joining another.', NOT_IN_ROOM: 'You are no longer a member of this room.', SERVER_ERROR: 'The server could not complete that request. Please try again.', INVALID_MESSAGE_ID: 'This message could not be identified. Please try again.', MESSAGE_ID_CONFLICT: 'This message could not be sent. Please try again.' })[code] || 'Something went wrong. Please try again.'; }
  function setBusy(busy) { state.busy = busy; $('createBtn').disabled = busy; $('joinBtn').disabled = busy; $('createBtn').style.opacity = busy ? '.6' : ''; $('joinBtn').style.opacity = busy ? '.6' : ''; }
  function connectSocket() {
    if (state.socket) return state.socket;
    if (typeof io !== 'function') { setServer(false, 'Unavailable'); return null; }
    const socket = io({ reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 700, reconnectionDelayMax: 5000, timeout: 10000 }); state.socket = socket;
    socket.on('connect', () => { state.connected = true; setServer(true, 'Server online'); if (state.room) resumeRoom(); });
    socket.on('disconnect', reason => { state.connected = false; setServer(false, 'Reconnecting…'); if (state.room) setConnection(false, 'Reconnecting…'); if (reason === 'io server disconnect' && !state.sessionReplaced) socket.connect(); });
    socket.on('connect_error', () => { state.connected = false; setServer(false, 'Server unavailable'); if (state.room) setConnection(false, 'Connection lost'); });
    socket.on('message:new', message => appendMessage(message));
    socket.on('presence:update', payload => renderPresence(payload.participants || []));
    socket.on('typing:update', payload => { if (!state.room || payload.participantId === state.room.participantId) return; $('typingText').textContent = `${payload.displayName || 'Someone'} is typing…`; $('typingRow').classList.toggle('visible', Boolean(payload.typing)); clearTimeout(state.remoteTypingTimer); if (payload.typing) state.remoteTypingTimer = setTimeout(() => $('typingRow').classList.remove('visible'), 3500); });
    socket.on('session:replaced', () => { state.sessionReplaced = true; clearSession(); $('chatView').classList.add('hidden'); $('landing').classList.remove('hidden'); toast('This room session was opened in another tab.'); socket.disconnect(); });
    return socket;
  }
  function withAck(event, payload) { return new Promise((resolve, reject) => { const socket = connectSocket(); if (!socket || !socket.connected) return reject(new Error('SERVER_UNAVAILABLE')); socket.timeout(12000).emit(event, payload, (err, response) => err ? reject(new Error('SERVER_UNAVAILABLE')) : resolve(response)); }); }
  function displayEntryError(message) { $('entryNotice').textContent = message; }
  async function startRoom(mode) {
    if (state.busy) return;
    const name = $('displayName').value.trim() || 'Guest';
    $('nameError').textContent = ''; $('codeError').textContent = ''; displayEntryError('');
    if (name.length > 32) { $('nameError').textContent = 'Name must be 32 characters or fewer.'; return; }
    if (mode === 'join' && !$('roomCode').value.trim()) { $('codeError').textContent = 'Enter the room code.'; return; }
    setBusy(true);
    try {
      const response = await withAck(mode === 'create' ? 'room:create' : 'room:join', mode === 'create' ? { displayName: name } : { displayName: name, code: $('roomCode').value });
      if (!response.ok) { displayEntryError(friendlyError(response.error)); return; }
      enterRoom(response);
    } catch { displayEntryError('Could not reach the server. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  function enterRoom(response) {
    state.sessionReplaced = false;
    state.room = { code: response.code, participantId: response.participantId, token: response.token, displayName: response.displayName };
    state.seen.clear(); state.lastDateLabel = ''; saveSession(); $('activeRoomCode').textContent = response.code; $('landing').classList.add('hidden'); $('chatView').classList.remove('hidden'); document.body.classList.add('in-chat');
    $('messages').replaceChildren(); (response.history || []).forEach(appendMessage); if (!(response.history || []).length) showEmptyState(); renderPresence(response.participants || []); setConnection(true, 'Connected'); $('messageInput').disabled = false; $('messageInput').focus(); window.scrollTo(0, 0);
  }
  async function resumeRoom() {
    if (!state.room || !state.socket?.connected) return;
    try { const response = await withAck('room:resume', { code: state.room.code, participantId: state.room.participantId, token: state.room.token }); if (!response.ok) { clearSession(); $('chatView').classList.add('hidden'); $('landing').classList.remove('hidden'); toast('Your previous room session expired.'); return; } enterRoom(response); }
    catch { setConnection(false, 'Reconnecting…'); }
  }
  function renderPresence(participants) {
    if (!state.room) return;
    const others = participants.filter(p => p.id !== state.room.participantId); const online = others.some(p => p.online);
    $('participantCount').textContent = `${participants.length} of 2 here`;
    if (state.connected) setConnection(true, online ? `${others[0]?.displayName || 'Participant'} online` : others.length ? 'Other participant offline' : 'Waiting for someone');
  }
  function showEmptyState() {
    const wrap = document.createElement('div'); wrap.id = 'emptyState'; wrap.className = 'empty-state';
    const orbit = document.createElement('div'); orbit.className = 'empty-orbit'; orbit.textContent = '✧';
    const heading = document.createElement('h3'); heading.textContent = 'Your conversation starts here';
    const copy = document.createElement('p'); copy.textContent = 'Send the first message and say hello.';
    wrap.append(orbit, heading, copy); $('messages').append(wrap);
  }
  function appendMessage(message) {
    if (!message || !message.id || state.seen.has(message.id)) return;
    state.seen.add(message.id); const empty = $('emptyState'); if (empty) empty.remove();
    const date = new Date(message.createdAt);
    const dateLabel = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (dateLabel && dateLabel !== state.lastDateLabel) { const separator = document.createElement('div'); separator.className = 'date-separator'; separator.textContent = dateLabel; $('messages').append(separator); state.lastDateLabel = dateLabel; }
    const mine = message.participantId === state.room?.participantId;
    const row = document.createElement('div'); row.className = `message-row${mine ? ' mine' : ''}`;
    if (!mine) { const avatar = document.createElement('div'); avatar.className = 'message-avatar'; avatar.textContent = (message.displayName || '?').slice(0, 1).toUpperCase(); row.append(avatar); }
    const wrap = document.createElement('div'); wrap.className = 'message-content';
    if (!mine) { const name = document.createElement('div'); name.className = 'message-name'; name.textContent = message.displayName || 'Guest'; wrap.append(name); }
    const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = message.content;
    const time = document.createElement('div'); time.className = 'message-time'; time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    wrap.append(bubble, time); row.append(wrap); $('messages').append(row); $('messages').scrollTop = $('messages').scrollHeight;
  }
  $('createBtn').addEventListener('click', () => startRoom('create')); $('joinBtn').addEventListener('click', () => startRoom('join'));
  $('roomCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9\s-]/g, '').slice(0, 14); });
  $('entryForm').addEventListener('submit', e => e.preventDefault());
  $('copyRoomBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.room?.code || ''); toast('Room code copied.'); } catch { toast('Copy is unavailable in this browser.'); } });
  $('messageInput').addEventListener('input', () => { $('messageCount').textContent = `${$('messageInput').value.length} / 4000`; $('sendBtn').disabled = !$('messageInput').value.trim() || !state.connected; if (state.room && state.connected) { state.socket.emit('typing:update', { typing: true }); clearTimeout(state.typingTimer); state.typingTimer = setTimeout(() => state.socket.emit('typing:update', { typing: false }), 1200); } });
  $('messageInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit(); } });
  $('composer').addEventListener('submit', async e => {
    e.preventDefault(); const content = $('messageInput').value.trim();
    if (!content || !state.room || !state.connected || state.busy) return;
    if (!state.pendingMessage || state.pendingMessage.content !== content) state.pendingMessage = { content, id: crypto.randomUUID() };
    state.busy = true; $('sendBtn').disabled = true;
    try {
      const result = await withAck('message:send', { content, messageId: state.pendingMessage.id });
      if (!result.ok) toast(friendlyError(result.error));
      else { state.pendingMessage = null; $('messageInput').value = ''; $('messageCount').textContent = '0 / 4000'; state.socket.emit('typing:update', { typing: false }); }
    } catch { toast('Message was not confirmed. Retrying will not create a duplicate.'); }
    finally { state.busy = false; $('sendBtn').disabled = !$('messageInput').value.trim() || !state.connected; }
  });
  $('leaveBtn').addEventListener('click', () => $('leaveDialog').showModal()); $('cancelLeave').addEventListener('click', () => $('leaveDialog').close());
  $('confirmLeave').addEventListener('click', async () => { $('leaveDialog').close(); try { if (state.socket?.connected) await withAck('room:leave', {}); } catch {} clearSession(); $('chatView').classList.add('hidden'); $('landing').classList.remove('hidden'); $('messages').replaceChildren(); showEmptyState(); $('roomCode').value = ''; toast('You left the room.'); });
  connectSocket();
  try { const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); if (saved && saved.code && saved.participantId && saved.token) { state.room = saved; if (state.socket?.connected) resumeRoom(); } } catch { clearSession(); }
})();
