// The single gate deciding whether an agent key may use a tool.
//
// Modelled on the CMS's own `toolAllowedForCapabilities` (two independent axes,
// both must pass) so the two systems reason about permission the same way:
//
//   1. Verb  — the tool's `permission` must be in the key's granted set.
//   2. Table — a table-scoped tool's target must be inside the key's `tables`
//              narrowing.
//
// This gate is the ONLY ceiling on an agent. The gateway signs into a tenant as
// the owner over hub SSO, so the CMS itself imposes none — see docs/connector/mms-mcp.md.
// It therefore runs twice: filtering `tools/list`, and again inside
// `tools/call` so a client that hard-codes a tool name it never saw listed is
// still refused.

export const AGENT_PERMISSIONS = [
  'read',
  'create',
  'edit',
  'delete',
  'publish',
  'tables.manage',
  'media.read',
  'media.write',
  'media.delete',
  'design.edit',
];

// Presets the console offers so an operator does not have to reason about ten
// checkboxes for the common cases.
export const PERMISSION_PRESETS = {
  'read-only': ['read', 'media.read'],
  author: ['read', 'create', 'edit', 'media.read', 'media.write'],
  publisher: ['read', 'create', 'edit', 'publish', 'media.read', 'media.write'],
  full: [...AGENT_PERMISSIONS],
};

export function normalizePermissions(input) {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(AGENT_PERMISSIONS);
  return [...new Set(input.filter((p) => allowed.has(p)))];
}

export function normalizeTables(input) {
  if (!Array.isArray(input) || input.length === 0) return ['*'];
  if (input.includes('*')) return ['*'];
  return [...new Set(input.filter((t) => typeof t === 'string' && t.length > 0))];
}

export function tableAllowed(profile, tableSlug) {
  const tables = profile.tables || ['*'];
  if (tables.includes('*')) return true;
  return tables.includes(tableSlug);
}

/**
 * Verb axis only — used to filter `tools/list`, where no arguments exist yet.
 */
export function toolAllowedForProfile(tool, profile) {
  const granted = profile.permissions || [];
  return granted.includes(tool.permission);
}

/**
 * Both axes — used inside `tools/call`, where the target table is known.
 * Returns null when allowed, or a human-readable refusal for the tool result.
 */
export function refuseToolCall(tool, profile, args) {
  if (!toolAllowedForProfile(tool, profile)) {
    return `This key does not hold the "${tool.permission}" permission, which "${tool.name}" requires.`;
  }
  if (tool.tableArg) {
    const slug = args ? args[tool.tableArg] : undefined;
    if (typeof slug === 'string' && slug && !tableAllowed(profile, slug)) {
      return `This key is scoped to ${(profile.tables || []).join(', ')} and may not touch "${slug}".`;
    }
  }
  return null;
}
