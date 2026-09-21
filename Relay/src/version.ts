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
 */
export const RELAY_VERSION = '0.5.0'
