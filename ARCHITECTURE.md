# Architecture

The Express process serves the static browser app, `/healthz`, and Socket.IO on the same HTTP server. `socketHandler.js` owns the event contract and validates each operation. `RoomManager` owns room and participant state and performs room creation/join/leave/reconnect operations against SQLite. `database.js` creates the schema on startup.

## Socket event contract

| Client event | Purpose | Server acknowledgement |
|---|---|---|
| `room:create` | Create room and creator participant | `{ok, code, participantId, token, history, participants}` |
| `room:join` | Join with room code | Same shape, or `{ok:false,error}` |
| `room:resume` | Resume existing participant using code, id, token | Same shape, or `INVALID_SESSION` |
| `message:send` | Validate, persist, broadcast message | `{ok:true,message}` or error |
| `typing:update` | Notify other room participant | Broadcast only to same Socket.IO room |
| `history:older` | Fetch older messages for authenticated participant | `{ok:true,messages}` |
| `room:leave` | Explicitly release slot | `{ok:true}` |

Server broadcasts: `message:new`, `presence:update`, `typing:update`, and `session:replaced`.

## Membership policy

A participant remains active while connected or during the configured disconnect grace period. Explicit leave releases the slot immediately. A grace expiry marks the participant left. Message rows retain their participant foreign key and display-name history; participant records are therefore status-marked rather than deleted. Join capacity checks are transactional. The in-memory active socket map assumes one server process.

## Data flow

Messages are validated, inserted into SQLite, and only then broadcast. The sender receives an acknowledgement after successful persistence. On reconnect, the participant token is validated against a stored token hash, and recent room history is reloaded. Client-generated UUID message IDs are persisted as primary keys; a retry with the same ID returns the original row and re-broadcasts it rather than inserting a duplicate. The browser also suppresses duplicate rendering by message ID.

## Empty and abandoned room policy

An empty room remains in the database and its messages remain available to its original valid participant sessions only during their reconnect grace windows. Once a participant explicitly leaves or their grace period expires, their session is invalidated and that slot is reusable. The room record itself is not automatically deleted, and a room with zero active participants is effectively dormant; its messages persist unless the optional message-retention setting is enabled. This avoids silent message deletion but means operators should manage database size and backups.
