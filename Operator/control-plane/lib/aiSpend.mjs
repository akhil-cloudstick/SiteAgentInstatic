/**
 * AI spending caps (security class E4) — the arithmetic, with no I/O.
 *
 * The PRD records E4 as an accepted omission: "no spend cap exists today", and
 * nothing in the control plane recorded a token, a call or a cost. Per-tenant
 * spend was visible only on openrouter.ai, because the gateway tags every
 * proxied call `X-Title: SiteAgent/<slug>/<product>`. Useful, but not something
 * the platform can read, reason about, or refuse on.
 *
 * The owner's rules, and where each one lands:
 *
 *   - Per PROJECT, per CALENDAR MONTH, in the provider's own billing currency.
 *     `monthKey` fixes the window; the ledger stores what the provider charged.
 *   - Warn at 80%, stop new AI work at 100%. `capDecision` is the one place that
 *     decides, so the banner and the refusal cannot disagree.
 *   - NEVER block editing, publishing, or the live site. That is satisfied by
 *     where the check runs rather than by anything here: only AI traffic passes
 *     through the gateway, so a cap cannot reach the CMS, a publish, or a
 *     deployed page even in principle.
 *   - Finish the reply in progress. Also structural — the check runs BEFORE the
 *     upstream request, so a turn already streaming is never interrupted. See
 *     the note on `capDecision`.
 *
 * Nothing here touches the database or the network, so it is all directly
 * testable, which is the point.
 */

/** Warn here. */
export const WARN_AT_FRACTION = 0.8;

/**
 * The cap window: a calendar month in UTC, as `YYYY-MM`.
 *
 * UTC rather than local time, deliberately. A cap that rolls over at the
 * server's midnight would move when the host's timezone or DST changed, and two
 * projects billed by the same provider would disagree about which month a call
 * belonged to. The provider bills in UTC; so does this.
 */
export function monthKey(when = new Date()) {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) throw new Error('monthKey needs a valid date');
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** A finite, non-negative number, or null. Used for every money and token value. */
function amount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * What to do about one project's AI spend.
 *
 * `cap` null means no cap — which is every project until somebody sets one, and
 * the state this ships in. `spent` null means the ledger could not be read.
 *
 * The fail-closed rule, and why it is not the usual one: an existing helper in
 * this codebase (`readActiveProducts`) fails OPEN on a database error, because
 * hiding a product the operator paid for is worse than briefly showing one they
 * did not. A cap is the other way round — but only once it exists. So:
 *
 *   - no cap set, spend unreadable  -> allow. There is nothing to enforce, and
 *     refusing here would turn a database blip into an AI outage on projects
 *     nobody ever capped.
 *   - cap set, spend unreadable     -> refuse. Principle P2: a check that cannot
 *     run reports failure. Spending an unknown amount against a known limit is
 *     precisely the case the cap exists for.
 */
export function capDecision({ cap, spent } = {}) {
  const limit = amount(cap);
  const used = amount(spent);

  if (limit === null || limit === 0) {
    // No cap. `0` counts as no cap rather than "block everything": a cap of zero
    // is far more likely to be an empty form field than an intention to stop a
    // project working.
    return { allow: true, level: 'none', cap: null, spent: used, fraction: null, reason: null };
  }

  if (used === null) {
    return {
      allow: false,
      level: 'unknown',
      cap: limit,
      spent: null,
      fraction: null,
      reason: 'This project has an AI spending limit, but how much it has spent this month could not be read.',
    };
  }

  const fraction = used / limit;

  if (used >= limit) {
    return {
      allow: false,
      level: 'stopped',
      cap: limit,
      spent: used,
      fraction,
      reason: 'This project has reached its AI limit for this month. Editing, publishing and the live site are unaffected.',
    };
  }

  if (fraction >= WARN_AT_FRACTION) {
    return { allow: true, level: 'warn', cap: limit, spent: used, fraction, reason: null };
  }

  return { allow: true, level: 'ok', cap: limit, spent: used, fraction, reason: null };
}

/**
 * Per-token prices for a model, from OpenRouter's own catalogue.
 *
 * OpenRouter returns `pricing.prompt` and `pricing.completion` as strings, in
 * dollars PER TOKEN (not per thousand). They are kept as given rather than
 * rescaled, so the arithmetic below is a plain multiplication and there is no
 * unit to get wrong in two places.
 */
export function pricesOf(model) {
  const p = model?.pricing;
  if (!p) return null;
  const prompt = amount(p.prompt);
  const completion = amount(p.completion);
  if (prompt === null && completion === null) return null;
  return { prompt: prompt ?? 0, completion: completion ?? 0 };
}

/**
 * What a call cost, from its token counts and the model's prices.
 *
 * Returns null when it cannot be known — no usage reported, or no prices for
 * that model — and null is recorded as null rather than as zero. A zero would
 * be indistinguishable from a free call, and a month of unpriced calls would
 * read as a month of spending nothing, which is the most dangerous possible
 * wrong answer for a cap to hold.
 */
export function costOf(usage, prices) {
  if (!usage || !prices) return null;
  const inTokens = amount(usage.promptTokens);
  const outTokens = amount(usage.completionTokens);
  if (inTokens === null && outTokens === null) return null;
  const cost = (inTokens ?? 0) * prices.prompt + (outTokens ?? 0) * prices.completion;
  // Rounded to the precision the ledger column stores (numeric(12,6)). Binary
  // floating point makes 1000 * 0.000015 come out as 0.015000000000000001, and a
  // money value that disagrees with the number actually written to the row is a
  // discrepancy waiting to be investigated for no reason.
  return Math.round(cost * 1e6) / 1e6;
}

/**
 * Pull the token counts out of a model response.
 *
 * Handles both shapes the allowlisted endpoints return: chat completions use
 * `prompt_tokens` / `completion_tokens`, the Responses API uses `input_tokens` /
 * `output_tokens`. Either may arrive with the other absent.
 */
export function usageOf(payload) {
  const u = payload?.usage;
  if (!u || typeof u !== 'object') return null;
  const promptTokens = amount(u.prompt_tokens ?? u.input_tokens);
  const completionTokens = amount(u.completion_tokens ?? u.output_tokens);
  const totalTokens = amount(u.total_tokens);
  if (promptTokens === null && completionTokens === null && totalTokens === null) return null;
  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens: totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0),
  };
}

/**
 * Find the usage in a server-sent-event stream, without buffering the stream.
 *
 * The gateway pipes the upstream body straight to the tenant token by token,
 * because the agent loop depends on it — so the usage cannot be read by awaiting
 * the whole response. Instead every chunk is offered to this accumulator on its
 * way past, and the LAST `usage` object seen wins: an OpenAI-compatible stream
 * reports it in a final frame after the content is done.
 *
 * Deliberately tolerant. A frame split across two chunks, a `[DONE]` sentinel,
 * a keep-alive comment and a non-JSON line are all ordinary, and none of them is
 * worth failing a tenant's request over — an unreadable stream simply yields no
 * usage, which is recorded as unknown rather than as zero.
 */
export function createUsageScanner() {
  let pending = '';
  let found = null;

  return {
    /** Offer a chunk. Never throws. */
    push(chunk) {
      try {
        pending += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        // Keep only the tail if no frame boundary has arrived — a stream that
        // never produces one must not grow this buffer without limit.
        if (pending.length > 262_144) pending = pending.slice(-65_536);

        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const usage = usageOf(JSON.parse(data));
            if (usage) found = usage;
          } catch {
            // Not JSON, or a partial frame. Both are ordinary.
          }
        }
      } catch {
        // Nothing a malformed chunk can do here should affect the proxy.
      }
    },
    /** Whatever was found, after the stream ends. Null if none was. */
    result() {
      // A last unterminated frame can still carry the usage.
      if (pending.trim().startsWith('data:')) {
        const data = pending.trim().slice(5).trim();
        if (data && data !== '[DONE]') {
          try {
            const usage = usageOf(JSON.parse(data));
            if (usage) found = usage;
          } catch {
            // As above.
          }
        }
      }
      return found;
    },
  };
}

/**
 * Ask the provider to report usage on a streamed response.
 *
 * Without this an OpenAI-compatible stream reports no usage at all, so the
 * ledger would be empty and the cap would have nothing to count. Mutates and
 * returns the payload, which the gateway is already re-serialising to pin the
 * model — so this costs nothing extra.
 *
 * Only for streamed calls: a non-streamed response carries `usage` already, and
 * `stream_options` on a non-streamed request is rejected by some providers.
 */
export function askForUsage(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.stream !== true) return payload;
  const existing = payload.stream_options;
  payload.stream_options =
    existing && typeof existing === 'object' ? { ...existing, include_usage: true } : { include_usage: true };
  return payload;
}
