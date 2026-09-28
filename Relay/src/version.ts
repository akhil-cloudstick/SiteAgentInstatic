/**
 * The relay build, reported by `GET /api/health`. Bump it with every deploy that
 * changes behaviour.
 *
 * It was not bumped for the approver registry, and that is how the registry came
 * to be written, committed and never deployed without anyone noticing: the live
 * relay and the repository both answered "0.4.0", so the one field that exists to
 * tell them apart said they were the same. What gave it away in the end was
 * `GET /api/approvers` answering "No such route" on a deployment whose source
 * had contained that route for weeks.
 *
 * 0.5.0 — the approver registry (R6): per-property resolution with no platform
 * fallback, and the owner-only registration door.
 *
 * 0.5.1 — the registry's public read moves to `/api/health/approvers`, under the
 * one prefix that is already bypassed. `/api/approvers` still answers a GET so
 * nothing breaks on deploy, but it must NOT be given a Bypass of its own: an
 * Access application covers everything beneath its path, so that policy would
 * also cover the POST register/rotate/retire routes and strip the assertion
 * header the owner is identified by — locking the only permitted registrar out
 * of their own door. Caught by the owner testing the live relay before deploying.
 *
 * 0.6.0 — test properties. A property the owner has designated a test property
 * may have its GO submitted by the validator, so an acceptance run no longer
 * needs the owner to paste every approval by hand. Deliberately narrow: the
 * designation is an owner-only write, it is published in the registry read so it
 * can be audited from outside, staging and live properties are unchanged, the
 * builder gains nothing anywhere, and the signature is still verified against the
 * property's registered approver — this widens who may SUBMIT and nothing else.
 * The general rule client approvers will need ("any valid signature, any
 * submitter") is not settled by this and was left open on purpose.
 *
 * 0.6.1 — the Approvers page could not run. Inside APPROVER_SCRIPT, which is a
 * template literal, the two confirm messages added for test properties were
 * written with `\n` where they needed `\\n`. TypeScript interpreted them and
 * emitted REAL newlines into the browser's JavaScript, inside single-quoted
 * strings — a SyntaxError, which kills the entire inline script. Register,
 * Designate and Retire all stopped working together, on a page that looked
 * completely normal, and 0.6.0 shipped that way.
 *
 * The suite was green throughout: it asserted what the routes answer and what
 * the HTML contains, and never once asked whether the script the page ships can
 * be parsed. `tests/inlineScripts.test.ts` now parses every inline script on
 * every page, for both roles, and is itself proved against the broken source
 * rather than assumed to work. No migration; no route or behaviour change.
 *
 * 0.6.2 — NO behaviour change. The Worker is byte-identical in what it does; a
 * deploy of this is optional and changes nothing that is serving.
 *
 * It exists because the folder gained a test and therefore a manifest line, and
 * two different SHA256SUMS under one version number is the drift that caused
 * the 0.4.0 incident: the checking side had been told 43/43 for 0.6.1, and
 * leaving the folder reading 44/44 under that same version would have them
 * chasing a mismatch that is not one. A version is cheaper than that confusion.
 *
 * The test is tests/migrationTriggers.test.ts, which runs the migrations
 * verbatim against a real SQLite engine — the same one D1 is — and exercises
 * the append-only triggers. Until now they had never been executed by anything:
 * every other test uses the in-memory store, which enforces append-only in
 * TypeScript, so the SQL that actually protects the deployed relay was
 * unverified. A store that is append-only because the code is careful is a
 * different guarantee from one the database refuses to break (security class
 * E9).
 */
export const RELAY_VERSION = '0.6.2'
