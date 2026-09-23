/**
 * The reasoning-egress policy is the SERVER's, and a caller may only narrow it.
 *
 * Until this landed the policy arrived entirely in the request body — `chat.ts`
 * and `import-export-routes.ts` both pass `body.reasoningExecution` — and an
 * omitted field resolved to `'enabled'`. So a caller that simply left the field
 * out was unrestricted, which means the restriction was the caller's to choose.
 * The PRD is explicit that "refused" means the *server* refuses (:583), so a
 * self-imposed limit could never satisfy security class E2.
 *
 * These are pure-function cases on purpose: the sibling suite
 * (`reasoning-egress-policy.test.ts`) boots a real server and covers the HTTP
 * shape, and the rule being pinned here is the resolution itself.
 */
import { describe, expect, it } from 'vitest';
import {
  authorizeReasoningEgress,
  serverReasoningEgressPolicy,
  REASONING_EGRESS_POLICY_ENV,
  type ReasoningEgressRequest,
} from '../src/reasoning-egress.js';

const ALLOWED = 'https://api.openai.com';
const OTHER = 'https://evil.example';

/**
 * A proxy-route request. `policy: undefined` is the case under test: a caller
 * that never sends the field at all, which used to resolve to 'enabled'.
 */
function request(baseUrl: string, policy: unknown = undefined): ReasoningEgressRequest {
  return {
    routeKind: 'proxy',
    provider: 'openai',
    resolvedBaseUrl: baseUrl,
    policy,
  };
}

describe('serverReasoningEgressPolicy', () => {
  it('reads a policy from the environment', () => {
    const env = { [REASONING_EGRESS_POLICY_ENV]: JSON.stringify({ mode: 'disabled' }) };
    expect(serverReasoningEgressPolicy(env)).toEqual({ mode: 'disabled' });
  });

  it('is null when unset, so existing installs are unchanged', () => {
    expect(serverReasoningEgressPolicy({})).toBeNull();
  });

  it('reports malformed configuration as invalid rather than as unset', () => {
    // P2: a policy nobody can parse is not permission to proceed. Reading this
    // as "no policy" would turn a typo into an open door.
    expect(serverReasoningEgressPolicy({ [REASONING_EGRESS_POLICY_ENV]: '{not json' })).toBe('invalid');
    expect(serverReasoningEgressPolicy({ [REASONING_EGRESS_POLICY_ENV]: '"a string"' })).toBe('invalid');
  });
});

describe('authorizeReasoningEgress — the server policy governs', () => {
  it('THE BUG: an omitted caller policy no longer means unrestricted', () => {
    // Before: policy === undefined -> 'enabled' -> null (allowed).
    const denial = authorizeReasoningEgress(request(OTHER), { mode: 'disabled' });
    expect(denial).not.toBeNull();
    expect(denial?.code).toBe('reasoning_execution_disabled');
  });

  it('with no server policy configured, the caller still decides as before', () => {
    expect(authorizeReasoningEgress(request(OTHER), null)).toBeNull();
  });

  it('a caller cannot widen the server allowlist', () => {
    const server = { mode: 'allowlist' as const, allowedBaseUrls: [ALLOWED] };
    // The caller asks for a host the server never permitted.
    const denial = authorizeReasoningEgress(
      request(OTHER, { mode: 'allowlist', allowedBaseUrls: [OTHER] }),
      server,
    );
    expect(denial).not.toBeNull();
  });

  it('a caller CAN narrow the server allowlist', () => {
    const server = { mode: 'allowlist' as const, allowedBaseUrls: [ALLOWED, OTHER] };
    const denial = authorizeReasoningEgress(
      request(OTHER, { mode: 'allowlist', allowedBaseUrls: [ALLOWED] }),
      server,
    );
    expect(denial).not.toBeNull();
  });

  it('a host both sides permit is allowed', () => {
    const server = { mode: 'allowlist' as const, allowedBaseUrls: [ALLOWED] };
    expect(
      authorizeReasoningEgress(
        request(ALLOWED, { mode: 'allowlist', allowedBaseUrls: [ALLOWED] }),
        server,
      ),
    ).toBeNull();
  });

  it('the stricter mode wins whichever side asked for it', () => {
    // Caller says "enabled", server says "disabled" -> disabled.
    expect(
      authorizeReasoningEgress(request(ALLOWED, { mode: 'enabled' }), { mode: 'disabled' }),
    ).not.toBeNull();
    // Caller says "disabled", server has none -> disabled.
    expect(
      authorizeReasoningEgress(request(ALLOWED, { mode: 'disabled' }), null),
    ).not.toBeNull();
  });

  it('an unparseable server policy refuses (P2)', () => {
    const denial = authorizeReasoningEgress(request(ALLOWED), 'invalid');
    expect(denial).not.toBeNull();
  });

  it('the server allowlist applies when the caller supplies none', () => {
    const denial = authorizeReasoningEgress(request(OTHER), {
      mode: 'allowlist',
      allowedBaseUrls: [ALLOWED],
    });
    expect(denial).not.toBeNull();
  });

  it('either side may deny a route kind', () => {
    // `routeIsDeniedByFlag` covers provider_models / connection_test / finalize
    // — there is no per-kind flag for `chat`, so this uses a kind that has one.
    const denial = authorizeReasoningEgress(
      {
        routeKind: 'connection_test',
        provider: 'openai',
        resolvedBaseUrl: ALLOWED,
        policy: { mode: 'allowlist', allowedBaseUrls: [ALLOWED] },
      },
      { mode: 'allowlist', allowedBaseUrls: [ALLOWED], denyConnectionTests: true },
    );
    expect(denial).not.toBeNull();
  });
});
