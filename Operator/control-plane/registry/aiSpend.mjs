/**
 * The AI spend ledger and the per-project cap (security class E4).
 *
 * Reads and writes only. Every decision about what a number MEANS lives in
 * lib/aiSpend.mjs, so the thresholds are testable without a database and the
 * gateway, the console and the audit trail cannot disagree about them.
 *
 * Two shapes of caller, with different tolerances:
 *
 *   - the gateway, on the hot path of every model call. It needs the cap and the
 *     month's total, cheaply, and it must never be the reason a request fails
 *     for a project that has no cap.
 *   - the console, which sets caps and reads history, where a failure is
 *     ordinary and should surface.
 */
import { query } from './db.mjs';
import { monthKey } from '../lib/aiSpend.mjs';

/**
 * The cap and the month's spend for one project, in one round trip.
 *
 * Returns `{ cap, spent }` where either may be null, and null means different
 * things for each: a null cap is "no cap set", a null spend is "could not be
 * read". `capDecision` treats those differently on purpose — see its note on
 * failing closed only where a cap exists.
 *
 * `coalesce(sum(...), 0)` would be wrong here: a project with no rows this month
 * has spent nothing, which is 0, but a query that THREW must not come back as 0
 * either. So the sum is coalesced (no rows really is zero) and the error is
 * caught by the caller, which passes `spent: null`.
 */
export async function capAndSpend(slug, when = new Date()) {
  const month = monthKey(when);
  const { rows } = await query(
    `select t.ai_month_cap_usd as cap,
            coalesce((select sum(s.cost_usd) from siteagent_control.ai_spend s
                       where s.tenant_slug = t.slug and s.month = $2), 0) as spent
       from siteagent_control.tenants t
      where t.slug = $1`,
    [slug, month],
  );
  const row = rows[0];
  if (!row) return { cap: null, spent: null, month, known: false };
  return {
    cap: row.cap === null ? null : Number(row.cap),
    spent: Number(row.spent),
    month,
    known: true,
  };
}

/**
 * Record one proxied call.
 *
 * Fire-and-forget by design, like `recordAdminAction`: a ledger write must never
 * be the reason a tenant's AI request fails, and a failure is loud in the log.
 * The cost of that choice is stated plainly — a lost row understates the month,
 * so the cap errs towards allowing rather than refusing. That is the right way
 * for a metering failure to fall, because the alternative is refusing work on
 * the strength of a number we know is wrong.
 */
export function recordSpend({ slug, product, model, usage, costUsd, when = new Date() }) {
  query(
    `insert into siteagent_control.ai_spend
       (month, tenant_slug, product, model, prompt_tokens, completion_tokens, total_tokens, cost_usd)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      monthKey(when),
      slug,
      product,
      model ?? null,
      usage?.promptTokens ?? 0,
      usage?.completionTokens ?? 0,
      usage?.totalTokens ?? 0,
      // Explicitly null when unknown. See the schema note: a zero would be
      // indistinguishable from a free call.
      costUsd === null || costUsd === undefined ? null : costUsd,
    ],
  ).catch((e) => console.error('[ai-spend] write failed:', e.message));
}

/** One project's cap, or null. */
export async function getCap(slug) {
  const { rows } = await query(
    'select ai_month_cap_usd as cap from siteagent_control.tenants where slug = $1',
    [slug],
  );
  if (!rows[0]) return null;
  return rows[0].cap === null ? null : Number(rows[0].cap);
}

/**
 * Set or clear one project's cap. Returns the previous value.
 *
 * Returning the previous value is what lets the caller audit the CHANGE rather
 * than the new state — "raised from 20 to 50" is the record the owner asked for,
 * and it cannot be reconstructed after the write.
 */
export async function setCap(slug, capUsd) {
  const before = await getCap(slug);
  const value = capUsd === null || capUsd === undefined || capUsd === '' ? null : Number(capUsd);
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw Object.assign(new Error('A spending limit must be a positive amount, or empty for no limit.'), {
      status: 400,
    });
  }
  const { rowCount } = await query(
    'update siteagent_control.tenants set ai_month_cap_usd = $2, updated_at = now() where slug = $1',
    [slug, value],
  );
  if (rowCount === 0) throw Object.assign(new Error('No such project.'), { status: 404 });
  return { before, after: value };
}

/**
 * What every project spent in a month, for the console and for answering "what
 * has a full site build actually cost".
 *
 * Scope-filtered by the caller, not here — this returns the platform's view and
 * the API narrows it, matching how `listReceipts` is used.
 */
export async function spendByProject(when = new Date()) {
  const { rows } = await query(
    `select tenant_slug, product,
            sum(cost_usd)                                as cost_usd,
            sum(total_tokens)::bigint                    as total_tokens,
            count(*)::int                                as calls,
            count(*) filter (where cost_usd is null)::int as unpriced_calls
       from siteagent_control.ai_spend
      where month = $1
      group by tenant_slug, product
      order by tenant_slug, product`,
    [monthKey(when)],
  );
  return rows.map((r) => ({
    tenantSlug: r.tenant_slug,
    product: r.product,
    costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
    totalTokens: Number(r.total_tokens),
    calls: r.calls,
    // Surfaced rather than hidden: a month with unpriced calls has a total that
    // is a floor, not a figure, and anyone setting a cap from it should know.
    unpricedCalls: r.unpriced_calls,
  }));
}
