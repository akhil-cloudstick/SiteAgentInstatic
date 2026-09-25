/**
 * Can one project's workspace reach another project's files? (security class E2)
 *
 * The platform runs one daemon per project, each with its own data directory and
 * port, and the project is resolved from a signed session — the control plane's
 * own tests already cover that a session for one project cannot route to
 * another's daemon. That is the ROUTING half of isolation and it holds.
 *
 * This is the other half, and it had never been tested: the agent the daemon
 * runs is an `opencode` child with shell access, started with
 * `--dangerously-skip-permissions`. Routing does not constrain a process that
 * can open a path. What would constrain it is `isSandboxImportedProjectRootAllowed`,
 * which refuses a project root outside the roots the operator named.
 *
 * WHAT THIS TEST USED TO RECORD, and no longer does: that the control was
 * wrapped in `isSandboxModeEnabled(process.env)` (projects.ts) while
 * `OD_SANDBOX_MODE` was set NOWHERE outside the test suite — not in the control
 * plane's daemon env, not in any deploy config — so in production the check was
 * skipped entirely. A lock installed, tested, and never locked, which anybody
 * auditing the ten passing sandbox test files would have read as locked.
 *
 * It is now switched on. `Operator/control-plane/runtime/odRuntime.mjs` sets
 * `OD_SANDBOX_MODE=1` and `OD_SANDBOX_IMPORT_ALLOWED_ROOTS` to
 * `<this tenant's data dir>/projects` for every daemon it starts. Per tenant,
 * deliberately: one shared root would re-open the very reach this closes, and an
 * empty list would allow nothing at all.
 *
 * So the first case below now pins the CONTAINED behaviour as production's, and
 * the old behaviour is kept at the foot of the file as the contrast — what the
 * absence of that variable used to mean, so the cost of removing it again is
 * written down rather than remembered.
 *
 * What this still does NOT cover, and must not be read as covering: the agent is
 * an `opencode` child with shell access, and this control governs which project
 * roots OD will SERVE, not what a process holding a shell can open. That gap is
 * recorded in docs/known-gaps.md and needs OS-level separation.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  isSandboxImportedProjectRootAllowed,
  isSandboxModeEnabled,
  SANDBOX_MODE_ENV,
  SANDBOX_IMPORT_ALLOWED_ROOTS_ENV,
} from '../src/sandbox-mode.js';

/** Two project roots side by side, as the platform lays tenants out on disk. */
function twoProjects() {
  const root = mkdtempSync(join(tmpdir(), 'cross-project-'));
  const a = resolve(root, 'tenant-users', 'project-a');
  const b = resolve(root, 'tenant-users', 'project-b');
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
  return { root, a, b, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('one project reaching another project’s files', () => {
  it('PRODUCTION TODAY: the containment is on, and a sibling project root is refused', () => {
    const { a, b, cleanup } = twoProjects();
    try {
      // Exactly the environment the control plane now builds for a tenant
      // daemon: the mode on, and the allowed root derived from THIS tenant's own
      // data dir. See odRuntime.mjs, where both are set together.
      const productionEnv: Record<string, string | undefined> = {
        [SANDBOX_MODE_ENV]: '1',
        [SANDBOX_IMPORT_ALLOWED_ROOTS_ENV]: a,
      };

      expect(isSandboxModeEnabled(productionEnv)).toBe(true);
      expect(isSandboxImportedProjectRootAllowed(a, productionEnv)).toBe(true);

      // The assertion the whole class is about — and it is now production's
      // behaviour rather than an aspiration.
      expect(isSandboxImportedProjectRootAllowed(b, productionEnv)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('THE CONTRAST: with the mode unset, every path is allowed — what this used to be', () => {
    const { a, b, cleanup } = twoProjects();
    try {
      // Kept so the cost of removing OD_SANDBOX_MODE from the daemon env is
      // written down. With the mode off the allow-check answers `true` for ANY
      // path, because projects.ts short-circuits before reaching it: project B's
      // root is "allowed" from project A's daemon, silently.
      const unset: Record<string, string | undefined> = {};
      expect(isSandboxModeEnabled(unset)).toBe(false);
      expect(isSandboxImportedProjectRootAllowed(b, unset)).toBe(true);
      expect(isSandboxImportedProjectRootAllowed(a, unset)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('WITH CONTAINMENT ON: a project confined to its own root cannot reach its sibling', () => {
    const { a, b, cleanup } = twoProjects();
    try {
      const confined = {
        [SANDBOX_MODE_ENV]: '1',
        [SANDBOX_IMPORT_ALLOWED_ROOTS_ENV]: a,
      };

      expect(isSandboxModeEnabled(confined)).toBe(true);
      expect(isSandboxImportedProjectRootAllowed(a, confined)).toBe(true);

      // The assertion the whole class is about.
      expect(isSandboxImportedProjectRootAllowed(b, confined)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('a path that cannot be resolved is not judged contained', () => {
    const { a, cleanup } = twoProjects();
    try {
      const confined = {
        [SANDBOX_MODE_ENV]: '1',
        [SANDBOX_IMPORT_ALLOWED_ROOTS_ENV]: a,
      };
      // Escaping by spelling: a traversal out of the allowed root and back into
      // the sibling must not pass on string comparison alone.
      const sibling = resolve(a, '..', 'project-b');
      expect(isSandboxImportedProjectRootAllowed(sibling, confined)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('an unparseable allowed-roots setting confines rather than opens', () => {
    const { a, b, cleanup } = twoProjects();
    try {
      // A relative root is rejected outright by the parser, and the effect must
      // be that NOTHING is allowed — not that everything is.
      const broken = { [SANDBOX_MODE_ENV]: '1', [SANDBOX_IMPORT_ALLOWED_ROOTS_ENV]: 'not-absolute' };
      expect(() => isSandboxImportedProjectRootAllowed(b, broken)).toThrow();

      // An empty list is the same shape of question, and answers it safely.
      const empty = { [SANDBOX_MODE_ENV]: '1', [SANDBOX_IMPORT_ALLOWED_ROOTS_ENV]: '' };
      expect(isSandboxImportedProjectRootAllowed(a, empty)).toBe(false);
      expect(isSandboxImportedProjectRootAllowed(b, empty)).toBe(false);
    } finally {
      cleanup();
    }
  });
});
