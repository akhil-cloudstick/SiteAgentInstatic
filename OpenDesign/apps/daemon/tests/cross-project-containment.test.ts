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
 * WHAT THIS TEST EXISTS TO RECORD: that control is wrapped in
 * `isSandboxModeEnabled(process.env)` (projects.ts), and `OD_SANDBOX_MODE` is set
 * NOWHERE outside the test suite — not in the control plane's daemon env, not in
 * any deploy config. So in production the check is skipped entirely.
 *
 * Both states are pinned below, deliberately. The "enabled" cases prove the
 * control is correct and worth switching on; the "disabled" case states plainly
 * what production does today, so nobody reads the ten passing sandbox test files
 * and concludes the containment is live. It is implemented, tested, and inert.
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
  it('PRODUCTION TODAY: the containment is off, so a sibling project root is allowed', () => {
    const { a, b, cleanup } = twoProjects();
    try {
      // Exactly the environment the control plane builds for a tenant daemon:
      // OD_SANDBOX_MODE is absent. Confirmed by searching the whole Operator
      // tree — the variable appears in no source, env file or deploy config.
      const productionEnv: Record<string, string | undefined> = {};

      expect(isSandboxModeEnabled(productionEnv)).toBe(false);

      // With the mode off, the allow-check answers `true` for ANY path, because
      // `projects.ts` never reaches it — the guard short-circuits first. Project
      // B's root is "allowed" from project A's daemon.
      expect(isSandboxImportedProjectRootAllowed(b, productionEnv)).toBe(true);
      expect(isSandboxImportedProjectRootAllowed(a, productionEnv)).toBe(true);
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
