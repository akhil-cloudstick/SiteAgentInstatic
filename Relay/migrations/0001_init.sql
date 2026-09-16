-- Deploy Relay schema.
--
-- Append-only is enforced by triggers, not only by the Worker exposing no
-- update or delete routes: messages, transitions, artefacts and flags can never
-- be changed or removed; a GO can only be stamped consumed, once; a ticket's
-- identity, text, artefacts and deploy binding (action, target, sha256,
-- content_digest) are frozen at creation. Only a ticket's current state and its
-- stall/validator stamps move, and their history is the transitions and flags
-- tables.

CREATE TABLE seq (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO seq (name, value) VALUES ('global', 0);

CREATE TABLE tickets (
  id                TEXT PRIMARY KEY,
  seq               INTEGER NOT NULL UNIQUE,
  type              TEXT NOT NULL CHECK (type IN ('ticket', 'deploy-request')),
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  state             TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  state_since       TEXT NOT NULL,
  artefacts         TEXT NOT NULL DEFAULT '[]',
  action            TEXT CHECK (action IS NULL OR action IN ('import', 'merge-overwrite', 'merge-add', 'publish',
                      'publish-row', 'set-status-draft', 'set-status-unpublished', 'delete')),
  target            TEXT,
  sha256            TEXT,
  -- The draft site hash a publish GO must also bind; null for every other action.
  content_digest    TEXT CHECK (content_digest IS NULL OR action = 'publish'),
  deploy_id         TEXT,
  validator_stalled INTEGER NOT NULL DEFAULT 0,
  last_validator_at TEXT,
  adjudicated       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  seq        INTEGER NOT NULL UNIQUE,
  ticket_id  TEXT NOT NULL REFERENCES tickets (id),
  kind       TEXT NOT NULL CHECK (kind IN ('comment', 'info', 'evidence', 'reported-instruction')),
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  evidence   TEXT,
  reply_to   TEXT REFERENCES messages (id),
  artefacts  TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX messages_ticket ON messages (ticket_id, seq);

CREATE TABLE transitions (
  seq                 INTEGER PRIMARY KEY,
  ticket_id           TEXT NOT NULL REFERENCES tickets (id),
  from_state          TEXT NOT NULL,
  to_state            TEXT NOT NULL,
  by_role             TEXT NOT NULL,
  at                  TEXT NOT NULL,
  evidence_message_id TEXT REFERENCES messages (id),
  deploy_id           TEXT
);
CREATE INDEX transitions_ticket ON transitions (ticket_id, seq);

CREATE TABLE artefacts (
  sha256      TEXT PRIMARY KEY,
  seq         INTEGER NOT NULL UNIQUE,
  bytes       INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE gos (
  ticket_id             TEXT PRIMARY KEY REFERENCES tickets (id),
  seq                   INTEGER NOT NULL UNIQUE,
  nonce                 TEXT NOT NULL UNIQUE,
  payload               TEXT NOT NULL,
  owner_key_fingerprint TEXT NOT NULL,
  granted_at            TEXT NOT NULL,
  consumed_at           TEXT,
  consumed_seq          INTEGER UNIQUE
);

CREATE TABLE flags (
  seq               INTEGER PRIMARY KEY,
  ticket_id         TEXT NOT NULL REFERENCES tickets (id),
  validator_stalled INTEGER NOT NULL,
  at                TEXT NOT NULL
);

CREATE TABLE idempotency (
  subject        TEXT NOT NULL,
  key            TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  status         INTEGER NOT NULL,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (subject, key)
);

CREATE TRIGGER tickets_frozen_fields BEFORE UPDATE ON tickets
WHEN NEW.id IS NOT OLD.id OR NEW.seq IS NOT OLD.seq OR NEW.type IS NOT OLD.type
  OR NEW.title IS NOT OLD.title OR NEW.body IS NOT OLD.body OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_at IS NOT OLD.created_at OR NEW.artefacts IS NOT OLD.artefacts
  OR NEW.action IS NOT OLD.action OR NEW.target IS NOT OLD.target OR NEW.sha256 IS NOT OLD.sha256
  OR NEW.content_digest IS NOT OLD.content_digest
BEGIN
  SELECT RAISE(ABORT, 'ticket identity, text, artefacts and deploy binding are immutable');
END;
CREATE TRIGGER tickets_no_delete BEFORE DELETE ON tickets
BEGIN SELECT RAISE(ABORT, 'tickets are never deleted'); END;

CREATE TRIGGER messages_no_update BEFORE UPDATE ON messages
BEGIN SELECT RAISE(ABORT, 'messages are append-only'); END;
CREATE TRIGGER messages_no_delete BEFORE DELETE ON messages
BEGIN SELECT RAISE(ABORT, 'messages are append-only'); END;

CREATE TRIGGER transitions_no_update BEFORE UPDATE ON transitions
BEGIN SELECT RAISE(ABORT, 'transitions are append-only'); END;
CREATE TRIGGER transitions_no_delete BEFORE DELETE ON transitions
BEGIN SELECT RAISE(ABORT, 'transitions are append-only'); END;

CREATE TRIGGER artefacts_no_update BEFORE UPDATE ON artefacts
BEGIN SELECT RAISE(ABORT, 'artefacts are immutable'); END;
CREATE TRIGGER artefacts_no_delete BEFORE DELETE ON artefacts
BEGIN SELECT RAISE(ABORT, 'artefacts are immutable'); END;

CREATE TRIGGER flags_no_update BEFORE UPDATE ON flags
BEGIN SELECT RAISE(ABORT, 'flags are append-only'); END;
CREATE TRIGGER flags_no_delete BEFORE DELETE ON flags
BEGIN SELECT RAISE(ABORT, 'flags are append-only'); END;

CREATE TRIGGER gos_consume_once BEFORE UPDATE ON gos
WHEN OLD.consumed_at IS NOT NULL OR NEW.ticket_id IS NOT OLD.ticket_id OR NEW.seq IS NOT OLD.seq
  OR NEW.nonce IS NOT OLD.nonce OR NEW.payload IS NOT OLD.payload
  OR NEW.owner_key_fingerprint IS NOT OLD.owner_key_fingerprint OR NEW.granted_at IS NOT OLD.granted_at
BEGIN
  SELECT RAISE(ABORT, 'a GO can only be stamped consumed, once');
END;
CREATE TRIGGER gos_no_delete BEFORE DELETE ON gos
BEGIN SELECT RAISE(ABORT, 'GOs are never deleted'); END;
