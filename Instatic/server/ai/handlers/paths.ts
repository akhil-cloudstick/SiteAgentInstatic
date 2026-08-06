/**
 * The single AI HTTP prefix.
 *
 * Every AI route lives under `/cms/api/ai` so the admin session cookie — scoped
 * to `/cms` — covers it. Each matcher in this folder derives its path from this
 * constant instead of inlining the prefix: the collection routes were written as
 * `pathname === '/cms/api/ai/…'` string compares while the per-item routes were
 * regexes that still carried the pre-rename `/admin/api/ai/…` spelling, so those
 * regexes could never match and their endpoints silently fell through the
 * dispatcher (a 404 the model picker swallowed as "Loading models…" forever).
 * Deriving both forms from one constant removes that failure mode.
 */
export const AI_API_PREFIX = '/cms/api/ai'

/**
 * Anchored matcher for `<AI_API_PREFIX>/<suffix>`, where `suffix` is a regex
 * source fragment — e.g. `aiRoutePattern('credentials/([^/]+)/test')`.
 */
export function aiRoutePattern(suffix: string): RegExp {
  return new RegExp(`^${AI_API_PREFIX}/${suffix}$`)
}
