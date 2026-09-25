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
 */
export const RELAY_VERSION = '0.6.0'
