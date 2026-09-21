-- The approver registry (MMSBUILD R6, and what NEW-4 actually asked for).
--
-- Until now an approver lived in two hand-edited places: a JSON file committed
-- to the builder's repository, and an environment variable on this Worker. Both
-- ends applied the same rule to two separate copies of the map, and a human
-- comparing fingerprints was the only thing keeping them in step. The PRD asks
-- for something narrower: "The registry is the only place this mapping lives,
-- and both ends read the same registry."
--
-- This is that registry. The checking side reads it from here too, so there is
-- one answer to "who may approve this property" rather than two that agree by
-- habit.
--
-- Append-only, like everything else in this database. A rotation is a NEW row
-- and a retirement stamp on the old one; nothing is ever edited or deleted.
-- That is what lets a retired identity stop authorising anything new while an
-- old receipt can still be explained (PRD 5.3).

CREATE TABLE approvers (
  id             TEXT PRIMARY KEY,
  seq            INTEGER NOT NULL UNIQUE,
  -- The property this approver covers. For a business-level row this is the
  -- business's own name, and `covers` lists the properties it may approve.
  property       TEXT NOT NULL,
  -- project: approves exactly its own property.
  -- business: approves only the properties named in `covers` — explicitly, never
  -- by walking a hierarchy. "A Business-level approver covers its own projects
  -- only when configured to, and never another Business's" (PRD 5.3), and a
  -- rule that infers reach from a tree is one configuration mistake away from
  -- being a master key.
  level          TEXT NOT NULL CHECK (level IN ('project', 'business')),
  -- JSON array of property names, for level='business'. NULL for a project row.
  covers         TEXT,
  public_key     TEXT NOT NULL,
  -- First 16 hex of sha256 over the raw key. Denormalised so a retired row can
  -- still be read back without re-deriving it.
  fingerprint    TEXT NOT NULL,
  effective_from INTEGER NOT NULL,
  -- Set when this identity is replaced or revoked. A row with a retired_at is
  -- history: it explains old receipts and authorises nothing.
  retired_at     INTEGER,
  registered_by  TEXT NOT NULL,
  reason         TEXT,
  created_at     INTEGER NOT NULL
);

-- One live approver per property at a time. The partial index is what enforces
-- "rotation takes effect immediately": a replacement cannot be registered
-- without the previous row being retired in the same transaction.
CREATE UNIQUE INDEX approvers_one_live ON approvers (property) WHERE retired_at IS NULL;
CREATE INDEX approvers_property ON approvers (property, effective_from DESC);
CREATE INDEX approvers_fingerprint ON approvers (fingerprint);

-- A registration is a statement about who could approve what, and when. Editing
-- one would rewrite history that receipts point at, so only the retirement
-- stamp moves — once, and never back.
CREATE TRIGGER approvers_retire_once BEFORE UPDATE ON approvers
WHEN OLD.retired_at IS NOT NULL
  OR NEW.id IS NOT OLD.id OR NEW.seq IS NOT OLD.seq
  OR NEW.property IS NOT OLD.property OR NEW.level IS NOT OLD.level
  OR NEW.covers IS NOT OLD.covers
  OR NEW.public_key IS NOT OLD.public_key OR NEW.fingerprint IS NOT OLD.fingerprint
  OR NEW.effective_from IS NOT OLD.effective_from
  OR NEW.registered_by IS NOT OLD.registered_by OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'an approver registration is immutable; it can only be retired, once');
END;

CREATE TRIGGER approvers_no_delete BEFORE DELETE ON approvers
BEGIN SELECT RAISE(ABORT, 'approver registrations are never deleted — they explain past approvals'); END;
