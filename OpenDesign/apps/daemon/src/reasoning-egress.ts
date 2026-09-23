import type { Response } from 'express';
import type {
  ReasoningExecutionMode,
  ReasoningExecutionPolicy,
} from '@open-design/contracts/api/reasoningExecution';
import { normalizeGoogleModelId } from './integrations/google-models.js';

export type ReasoningEgressRouteKind =
  | 'proxy'
  | 'provider_models'
  | 'connection_test'
  | 'finalize';

export interface ReasoningEgressRequest {
  policy: unknown;
  routeKind: ReasoningEgressRouteKind;
  provider: string;
  resolvedBaseUrl?: string;
  model?: string;
}

export type ReasoningEgressDenial =
  | ReasoningEgressInvalidPolicyDenial
  | ReasoningEgressPolicyDenial;

export interface ReasoningEgressInvalidPolicyDenial {
  status: 400;
  code: 'reasoning_execution_invalid_policy';
  message: string;
  data: {
    routeKind: ReasoningEgressRouteKind;
    provider: string;
    resolvedBaseUrl?: string;
    model?: string;
  };
}

export interface ReasoningEgressPolicyDenial {
  status: 403;
  code: 'reasoning_execution_disabled' | 'reasoning_execution_not_allowlisted';
  message: string;
  data: {
    routeKind: ReasoningEgressRouteKind;
    provider: string;
    policyMode: Exclude<ReasoningExecutionMode, 'enabled'>;
    resolvedBaseUrl?: string;
    model?: string;
  };
}

function isReasoningPolicy(value: unknown): value is Partial<ReasoningExecutionPolicy> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export const REASONING_EGRESS_POLICY_ENV = 'OD_REASONING_EGRESS_POLICY';

/**
 * The policy the SERVER imposes, read from its own environment.
 *
 * This exists because the policy used to arrive entirely in the request body
 * (`routes/chat.ts`, `import-export-routes.ts` pass `body.reasoningExecution`),
 * and an omitted field meant `'enabled'` — so a caller that simply left it out
 * was unrestricted. A restriction the caller chooses is not a restriction; the
 * PRD is explicit that "refused" means the *server* refuses.
 *
 * Unset means no server-imposed policy, which leaves the previous behaviour
 * intact for deployments that never configured one. That is deliberate: this
 * change closes the "caller can widen" hole without silently switching egress
 * off for every existing install. A malformed value is NOT treated as unset —
 * it refuses, because a policy nobody can parse is not a policy.
 */
export function serverReasoningEgressPolicy(
  env: Record<string, string | undefined> = process.env,
): Partial<ReasoningExecutionPolicy> | 'invalid' | null {
  const raw = env[REASONING_EGRESS_POLICY_ENV];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isReasoningPolicy(parsed) ? parsed : 'invalid';
  } catch {
    return 'invalid';
  }
}

/** Rank of a mode's strictness — the stricter of two policies wins. */
const MODE_RANK: Record<ReasoningExecutionMode, number> = {
  enabled: 0,
  allowlist: 1,
  disabled: 2,
};

function rawMode(policy: unknown): ReasoningExecutionMode | 'invalid' | 'absent' {
  if (policy === undefined || policy === null) return 'absent';
  if (!isReasoningPolicy(policy)) return 'invalid';
  if (policy.mode === undefined) return 'absent';
  return policy.mode === 'enabled' || policy.mode === 'disabled' || policy.mode === 'allowlist'
    ? policy.mode
    : 'invalid';
}

/**
 * Effective mode = the STRICTER of the server's and the caller's.
 *
 * The caller may narrow its own egress and may not widen it. With no server
 * policy configured the caller's own value still applies exactly as before, and
 * an absent caller policy under a configured server policy takes the server's
 * — which is the case that used to read as `'enabled'`.
 */
function policyMode(policy: unknown, serverPolicy?: unknown): ReasoningExecutionMode | 'invalid' {
  const caller = rawMode(policy);
  if (caller === 'invalid') return 'invalid';

  const server = rawMode(serverPolicy);
  if (server === 'invalid') return 'invalid';

  if (server === 'absent') return caller === 'absent' ? 'enabled' : caller;
  if (caller === 'absent') return server;
  return MODE_RANK[caller] >= MODE_RANK[server] ? caller : server;
}

export function normalizeReasoningBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function invalidPolicyDenial(args: ReasoningEgressRequest): ReasoningEgressInvalidPolicyDenial {
  return {
    status: 400,
    code: 'reasoning_execution_invalid_policy',
    message: 'reasoningExecution.mode must be one of enabled, disabled, or allowlist.',
    data: {
      routeKind: args.routeKind,
      provider: args.provider,
      ...(args.resolvedBaseUrl ? { resolvedBaseUrl: args.resolvedBaseUrl } : {}),
      ...(args.model ? { model: args.model } : {}),
    },
  };
}

function disabledDenial(args: ReasoningEgressRequest): ReasoningEgressDenial {
  return {
    status: 403,
    code: 'reasoning_execution_disabled',
    message: 'Reasoning provider egress is disabled for this run.',
    data: {
      routeKind: args.routeKind,
      provider: args.provider,
      policyMode: 'disabled',
      ...(args.resolvedBaseUrl ? { resolvedBaseUrl: args.resolvedBaseUrl } : {}),
      ...(args.model ? { model: args.model } : {}),
    },
  };
}

function allowlistDenial(args: ReasoningEgressRequest): ReasoningEgressDenial {
  return {
    status: 403,
    code: 'reasoning_execution_not_allowlisted',
    message: 'Reasoning provider egress is not allowlisted for this run.',
    data: {
      routeKind: args.routeKind,
      provider: args.provider,
      policyMode: 'allowlist',
      ...(args.resolvedBaseUrl ? { resolvedBaseUrl: args.resolvedBaseUrl } : {}),
      ...(args.model ? { model: args.model } : {}),
    },
  };
}

function routeIsDeniedByFlag(policy: Partial<ReasoningExecutionPolicy>, routeKind: ReasoningEgressRouteKind): boolean {
  if (routeKind === 'provider_models') return policy.denyProviderDiscovery === true;
  if (routeKind === 'connection_test') return policy.denyConnectionTests === true;
  if (routeKind === 'finalize') return policy.denyFinalize === true;
  return false;
}

function allowedBaseUrlSet(policy: Partial<ReasoningExecutionPolicy>): Set<string> {
  const values: unknown[] = Array.isArray(policy.allowedBaseUrls) ? policy.allowedBaseUrls : [];
  return new Set(
    values
      .filter((value: unknown): value is string => typeof value === 'string')
      .map(normalizeReasoningBaseUrl)
      .filter((value: string | null): value is string => Boolean(value)),
  );
}

function normalizeReasoningModelId(provider: string, model: string): string {
  const trimmed = model.trim();
  if (provider === 'google') return normalizeGoogleModelId(trimmed);
  return trimmed;
}

function allowedModelSet(policy: Partial<ReasoningExecutionPolicy>, provider: string): Set<string> {
  const values: unknown[] = Array.isArray(policy.allowedModels) ? policy.allowedModels : [];
  return new Set(
    values
      .filter((value: unknown): value is string => typeof value === 'string')
      .map((value: string) => normalizeReasoningModelId(provider, value))
      .filter(Boolean),
  );
}

/** Everything in `caller` that `server` also permits. Empty server set = no server limit. */
function intersect(callerSet: Set<string>, serverSet: Set<string>): Set<string> {
  if (serverSet.size === 0) return callerSet;
  if (callerSet.size === 0) return serverSet;
  return new Set([...callerSet].filter((value) => serverSet.has(value)));
}

export function authorizeReasoningEgress(
  args: ReasoningEgressRequest,
  serverPolicyInput: Partial<ReasoningExecutionPolicy> | 'invalid' | null = serverReasoningEgressPolicy(),
): ReasoningEgressDenial | null {
  // A server policy that cannot be parsed refuses outright. A configuration
  // nobody can read is not permission to proceed (principle P2).
  if (serverPolicyInput === 'invalid') return invalidPolicyDenial(args);

  const mode = policyMode(args.policy, serverPolicyInput ?? undefined);
  if (mode === 'enabled') return null;
  if (mode === 'invalid') return invalidPolicyDenial(args);
  if (mode === 'disabled') return disabledDenial(args);

  const policy = isReasoningPolicy(args.policy) ? args.policy : {};
  const serverPolicy = serverPolicyInput ?? {};

  // Either side may deny a route kind; only both together may permit one.
  if (routeIsDeniedByFlag(policy, args.routeKind)) return allowlistDenial(args);
  if (routeIsDeniedByFlag(serverPolicy, args.routeKind)) return allowlistDenial(args);

  // The effective allowlists are the INTERSECTION, so a caller can narrow what
  // the server permits and can never add to it.
  const baseUrls = intersect(allowedBaseUrlSet(policy), allowedBaseUrlSet(serverPolicy));
  const models = intersect(
    allowedModelSet(policy, args.provider),
    allowedModelSet(serverPolicy, args.provider),
  );

  const normalizedBaseUrl = args.resolvedBaseUrl
    ? normalizeReasoningBaseUrl(args.resolvedBaseUrl)
    : null;
  if (!normalizedBaseUrl || !baseUrls.has(normalizedBaseUrl)) {
    return allowlistDenial(args);
  }

  if (
    args.model !== undefined
    && !models.has(normalizeReasoningModelId(args.provider, args.model))
  ) {
    return allowlistDenial(args);
  }

  return null;
}

export function sendReasoningEgressDenial(res: Response, denial: ReasoningEgressDenial): void {
  res.status(denial.status).json({
    error: {
      code: denial.code,
      message: denial.message,
      data: denial.data,
    },
  });
}
