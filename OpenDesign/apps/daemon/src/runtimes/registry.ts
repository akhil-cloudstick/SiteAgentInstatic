// Runtime agent registry.
//
// MMSBUILD ships MMS Design as a hosted product: the operator sets one provider
// key and one model in the control-plane Settings panel, and every tenant runs on
// it. Nobody installs a CLI on the server, and a tenant has no machine of their
// own in the loop — so the Local CLI agents this registry used to carry (claude,
// codex, gemini, qwen, cursor-agent, amp, aider, …) were controls that could
// never resolve to a working runtime here. They have been removed from the
// product rather than hidden.
//
// `byok-opencode` is what remains, and it is NOT a user-facing CLI choice: it is
// the engine that executes BYOK runs, and it has always been filtered out of the
// agent list the UI renders (see apps/web/src/utils/visibleAgents.ts). The daemon
// points it at the operator's AI gateway on every run (see ../managed-ai.ts).
//
// Consequence for upstream merges: a new agent definition arriving from
// nexu-io/open-design will land in defs/ but must be added here deliberately to
// take effect. That is the intended behaviour, not an oversight.
import { byokOpenCodeAgentDef } from './defs/byok-opencode.js';
import { readLocalAgentProfileDefs as readLocalAgentProfileDefsFromFile } from './local-profiles.js';
import type { RuntimeAgentDef } from './types.js';

const BASE_AGENT_DEFS: RuntimeAgentDef[] = [
  byokOpenCodeAgentDef,
];

export function readLocalAgentProfileDefs(
  baseDefs: RuntimeAgentDef[] = BASE_AGENT_DEFS,
): RuntimeAgentDef[] {
  return readLocalAgentProfileDefsFromFile(baseDefs);
}

export const AGENT_DEFS: RuntimeAgentDef[] = [
  ...BASE_AGENT_DEFS,
  ...readLocalAgentProfileDefs(BASE_AGENT_DEFS),
];

const ids = new Set();
for (const def of AGENT_DEFS) {
  if (ids.has(def.id)) {
    throw new Error(`Duplicate agent definition id: ${def.id}`);
  }
  ids.add(def.id);
}

export function getAgentDef(id: string): RuntimeAgentDef | null {
  return AGENT_DEFS.find((a) => a.id === id) || null;
}
