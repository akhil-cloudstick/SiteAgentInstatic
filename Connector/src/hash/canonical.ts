/**
 * Canonical hashing — re-exported from Instatic, never reimplemented.
 *
 * Every hash in the approval binding has to agree byte-for-byte with what the
 * server computes, so a second implementation here would be a latent
 * divergence: it would pass its own tests and fail in production the first time
 * someone changed key ordering on one side only.
 *
 * `canonicalJson` sorts object keys recursively and preserves array order —
 * array order can carry content meaning (page order, child order), so it is not
 * sorted.
 */

export {
  canonicalJson,
  siteContentHash,
  dataRowContentHash,
} from '@instatic-server/repositories/publish'
