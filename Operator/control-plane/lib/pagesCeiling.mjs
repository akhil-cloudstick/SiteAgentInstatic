/**
 * The Cloudflare Pages ceiling.
 *
 * A Cloudflare account allows roughly 100 Pages projects
 * (docs/architecture/PLAN.md). Until now that limit arrived at the worst possible
 * moment: `initTenantSite` failed deep inside the provisioning saga, the failure
 * was swallowed as non-fatal, and the project went `active` with NO LIVE SITE and
 * a "CF: ..." string buried in a details modal. A ceiling that presents as a
 * half-created project is worse than one that refuses.
 *
 * The arithmetic lives here, apart from the provisioner, for one reason: it is
 * needed in two places with different shapes. The provisioner REFUSES on it; the
 * console has to WARN on it, and cannot use the same path to do so, because a
 * create that succeeds redirects immediately and a warning in that response body
 * would never be seen. So the console reads the count on page load and asks this
 * module the same question.
 */

/** The account limit. Refuse at this many. */
export const PAGES_PROJECT_CEILING = 100;

/** Start warning here, so the wall is seen coming rather than hit. */
export const PAGES_PROJECT_WARN_AT = 80;

/**
 * What to say about a given count, or null when there is nothing to say.
 *
 * `level: 'full'` is a refusal; `level: 'warn'` is not. The caller decides which
 * of those it acts on — the provisioner throws on 'full' and ignores 'warn', the
 * console renders either.
 */
export function pagesCeilingNotice(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0) return null;

  if (n >= PAGES_PROJECT_CEILING) {
    return {
      level: 'full',
      count: n,
      message:
        `This Cloudflare account already holds ${n} Pages projects, which is its limit of `
        + `${PAGES_PROJECT_CEILING}. A new project would be created here but would never get a live `
        + `site. Remove a project that is no longer needed, or add a second Cloudflare account, `
        + `before creating another.`,
    };
  }
  if (n >= PAGES_PROJECT_WARN_AT) {
    return {
      level: 'warn',
      count: n,
      message:
        `${n} of ${PAGES_PROJECT_CEILING} Cloudflare Pages projects are in use. New projects will be `
        + `refused at ${PAGES_PROJECT_CEILING}.`,
    };
  }
  return null;
}

/**
 * Whether a tier consumes a Pages slot.
 *
 * Normalised the way the provisioner normalises it: an ABSENT tier means
 * advanced, so testing the raw value would let the common case through
 * unchecked. Lite projects get no Pages project and must never be refused by a
 * limit they do not consume.
 */
export function tierUsesPagesSlot(tier) {
  return (tier === 'lite' ? 'lite' : 'advanced') === 'advanced';
}
