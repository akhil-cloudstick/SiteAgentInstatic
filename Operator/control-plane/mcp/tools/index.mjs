// The ONE tool catalog an agent sees.
//
// Content tools reach the tenant plugin, media and design tools reach the
// tenant admin API — the agent cannot tell which, and should not have to. Keep
// this list flat and the names uniform for that reason.
import { contentTools } from './content.mjs';
import { mediaTools } from './media.mjs';
import { designTools } from './design.mjs';

export const ALL_TOOLS = [...contentTools, ...mediaTools, ...designTools];

const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function findTool(name) {
  return byName.get(name) || null;
}

// The MCP wire shape. `run`, `permission` and `tableArg` are gateway-internal
// and deliberately not advertised.
export function describeTool(tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}
