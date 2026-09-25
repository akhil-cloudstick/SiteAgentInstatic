-- Test properties — which properties the validator may submit a GO for.
--
-- The owner's decision, and deliberately a narrow one. Until now a GO could be
-- POSTed only by the owner, which meant the owner was in the loop for every
-- acceptance run: the validator can hold a test key and sign with it, but
-- somebody had to paste the result. That is a person standing in for a control,
-- which is the thing this whole relay exists to stop needing.
--
-- So a property may be DESIGNATED a test property, and on a designated property
-- the validator may submit. Four things this does NOT do, each of them on
-- purpose:
--
--   * It does not weaken the signature. A GO still has to verify against the
--     property's registered approver, checked in exactly the same place as
--     before. A designation widens WHO MAY SUBMIT and nothing else.
--   * It does not let anyone but the owner designate. Otherwise the validator
--     could mark a live site a test property and then approve it — which is the
--     whole control, handed over in one step.
--   * It gives the builder nothing. The builder submits no GO anywhere, on any
--     property, designated or not.
--   * It does not decide the general rule. "Any valid signature, any submitter"
--     is what client approvers will eventually need, and it is deliberately not
--     being settled here.
--
-- Append-only, and more strictly than the approver registry next door: a
-- designation and its removal are BOTH rows, and the highest seq for a property
-- wins. Nothing is ever updated, so unlike `approvers` this table needs no
-- retirement stamp and no partial unique index — and the full history of who
-- designated what, and when, stays readable. That history is the point: the
-- designation is published, so it has to be auditable from outside.
--
-- Note `at` and `created_at` are TEXT. `0002_approvers.sql` declared its
-- timestamps INTEGER and then stored ISO-8601 strings in them; SQLite's dynamic
-- typing let it pass, but it is wrong and is not copied here.

CREATE TABLE test_properties (
  id          TEXT PRIMARY KEY,
  seq         INTEGER NOT NULL UNIQUE,
  property    TEXT NOT NULL,
  -- 1 designates, 0 removes the designation. Both are rows; the highest seq for
  -- a property is the one in force.
  designated  INTEGER NOT NULL CHECK (designated IN (0, 1)),
  at          TEXT NOT NULL,
  -- The owner who made the call. There is no other permitted value in practice,
  -- but it is recorded rather than assumed.
  by_subject  TEXT NOT NULL,
  reason      TEXT,
  created_at  TEXT NOT NULL
);

-- The read is "the newest row per property", so seq descending within a
-- property is the access path.
CREATE INDEX test_properties_property ON test_properties (property, seq DESC);

-- A designation is a statement about who could submit what, and when. Editing
-- one would rewrite history that a granted GO points at.
CREATE TRIGGER test_properties_no_update BEFORE UPDATE ON test_properties
BEGIN
  SELECT RAISE(ABORT, 'a test-property designation is immutable; designate or undesignate by adding a row');
END;

CREATE TRIGGER test_properties_no_delete BEFORE DELETE ON test_properties
BEGIN
  SELECT RAISE(ABORT, 'test-property designations are never deleted — they explain who was allowed to submit');
END;
