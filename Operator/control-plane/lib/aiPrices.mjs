/**
 * What each model costs, from OpenRouter's own catalogue.
 *
 * The catalogue was already being fetched — `listOpenrouterModels` in server.mjs
 * calls it to populate the console's model picker — and the per-model `pricing`
 * block was being dropped on the floor. So the price table for every cap in this
 * system already existed and was already authenticated; it just was not kept.
 *
 * Cached for an hour, because this is consulted after every proxied model call
 * and prices move on the scale of provider announcements, not minutes. A fetch
 * that fails leaves the cache alone and yields no price, which is recorded as an
 * unknown cost rather than as zero — see the note in aiSpend.mjs on why that
 * distinction is load-bearing.
 *
 * Deliberately NOT on the request's critical path: the price is looked up when
 * the ledger row is written, after the tenant's response has already streamed.
 */
import { pricesOf } from './aiSpend.mjs';

const CATALOGUE_URL = 'https://openrouter.ai/api/v1/models';
const TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

let cache = { at: 0, prices: new Map() };
let inFlight = null;

async function loadCatalogue(apiKey) {
  const res = await fetch(CATALOGUE_URL, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`catalogue answered ${res.status}`);
  const body = await res.json();
  const prices = new Map();
  for (const model of body?.data ?? []) {
    const p = pricesOf(model);
    if (p && model.id) prices.set(String(model.id), p);
  }
  if (prices.size === 0) throw new Error('catalogue carried no usable prices');
  return prices;
}

/**
 * Per-token prices for one model id, or null.
 *
 * Null covers every "we do not know": the catalogue could not be fetched, the
 * model is not in it, or it is listed without usable prices. The caller records
 * an unknown cost in each case, which is the truthful answer and keeps a month
 * of unpriced calls from reading as a month of spending nothing.
 */
export async function pricesForModel(modelId, apiKey) {
  if (!modelId) return null;

  const fresh = Date.now() - cache.at < TTL_MS;
  if (!fresh) {
    // One fetch at a time, however many calls arrive while it is in flight.
    inFlight =
      inFlight ??
      loadCatalogue(apiKey)
        .then((prices) => {
          cache = { at: Date.now(), prices };
        })
        .catch((e) => {
          console.warn('[ai-prices] could not refresh the catalogue:', e.message);
          // The stale cache is kept. An old price is a far better estimate than
          // no price, and the alternative — dropping to null on every call after
          // one failed fetch — would silently stop the ledger costing anything.
        })
        .finally(() => {
          inFlight = null;
        });
    await inFlight;
  }

  return cache.prices.get(String(modelId)) ?? null;
}

/** Testing seam: drop the cache so a test is not served a previous one. */
export function resetPriceCache() {
  cache = { at: 0, prices: new Map() };
  inFlight = null;
}
