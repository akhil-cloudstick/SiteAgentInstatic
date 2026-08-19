// MCP over JSON-RPC 2.0. This is the only place the protocol lives — the
// tenant plugin speaks plain JSON and knows nothing about MCP.
//
// Transport is Streamable HTTP answering with `application/json` rather than an
// SSE stream. That is the simple half of the spec and is what Claude Code
// (`--transport http`), Codex and `mcp-remote` all accept.
//
// Error discipline mirrors the CMS's own MCP server: a TOOL failure comes back
// as a normal result with `isError: true`, not a JSON-RPC error. Protocol-level
// errors (unknown method, bad params) are the only ones that use the error
// channel, so a failing tool never tears down the agent's session.
import { findTool, describeTool, ALL_TOOLS } from './tools/index.mjs';
import { refuseToolCall, toolAllowedForProfile } from './permissions.mjs';
import { recordAgentCall, touchAgentKey } from '../registry/mcpAgents.mjs';

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
};

const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

const textResult = (text, isError) => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
});

function serializeToolOutput(value) {
  if (value === undefined || value === null) return 'OK';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolsForProfile(profile) {
  return ALL_TOOLS.filter((tool) => toolAllowedForProfile(tool, profile));
}

async function callTool(ctx, params) {
  const name = params && params.name;
  if (typeof name !== 'string' || !name) {
    return { rpc: rpcError(ctx.id, RPC_ERRORS.invalidParams, 'tools/call requires a "name"') };
  }
  const args = (params && params.arguments) || {};
  const tool = findTool(name);

  // An unknown tool, and a tool this key may not see, are both "no such tool"
  // from the caller's side — the refusal below only fires for a tool the key
  // could plausibly know about.
  if (!tool) {
    return { rpc: rpcError(ctx.id, RPC_ERRORS.methodNotFound, `Unknown tool "${name}"`) };
  }

  // Second enforcement pass. tools/list already filtered, but a client can send
  // any name it likes, so the gate runs again with the arguments in hand.
  const refusal = refuseToolCall(tool, ctx.profile, args);
  if (refusal) {
    recordAgentCall({
      tenantSlug: ctx.slug,
      keyId: ctx.profile.keyId,
      tool: name,
      target: args[tool.tableArg] || null,
      ok: false,
      error: refusal,
    });
    return { rpc: result(ctx.id, textResult(refusal, true)) };
  }

  try {
    const output = await tool.run({ slug: ctx.slug, profile: ctx.profile }, args);
    recordAgentCall({
      tenantSlug: ctx.slug,
      keyId: ctx.profile.keyId,
      tool: name,
      target: args[tool.tableArg] || args.entryId || args.assetId || null,
      ok: true,
    });
    return { rpc: result(ctx.id, textResult(serializeToolOutput(output))) };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    recordAgentCall({
      tenantSlug: ctx.slug,
      keyId: ctx.profile.keyId,
      tool: name,
      target: args[tool.tableArg] || args.entryId || args.assetId || null,
      ok: false,
      error: message,
    });
    // The tenant's own `{ error }` message is forwarded verbatim so the agent
    // can act on the real cause rather than guessing.
    return { rpc: result(ctx.id, textResult(message, true)) };
  }
}

/**
 * Handle one JSON-RPC message. Returns the response object, or null for a
 * notification (which must be answered with 202 and no body).
 */
export async function handleRpcMessage(message, { slug, profile }) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return rpcError(null, RPC_ERRORS.invalidRequest, 'Expected a JSON-RPC object');
  }
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  if (typeof method !== 'string') {
    return isNotification ? null : rpcError(id, RPC_ERRORS.invalidRequest, 'Missing "method"');
  }

  // Notifications get no response at all, per spec.
  if (method.startsWith('notifications/')) return null;

  const ctx = { id, slug, profile };

  switch (method) {
    case 'initialize': {
      const requested = params && params.protocolVersion;
      const version = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
      touchAgentKey(profile.keyId);
      return result(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: `mms-cms:${slug}`, version: '1.0.0' },
        instructions:
          `You are connected to the "${slug}" MMS-CMS site. Pages live in the \`pages\` table and blog ` +
          'posts in `posts`; call cms_list_tables to see the rest. Build page layouts with cms_mutate_tree, ' +
          'not by writing HTML into fields. Everything you write stays a DRAFT until you call ' +
          'cms_publish_entry for that entry, so finish and check your work before publishing.',
      });
    }

    case 'ping':
      return result(id, {});

    case 'tools/list':
      return result(id, { tools: toolsForProfile(profile).map(describeTool) });

    case 'tools/call': {
      touchAgentKey(profile.keyId);
      const { rpc } = await callTool(ctx, params);
      return rpc;
    }

    // Declared unsupported rather than silently 404'd, so a client that probes
    // for them gets a clean answer instead of an error it may treat as fatal.
    case 'resources/list':
      return result(id, { resources: [] });
    case 'prompts/list':
      return result(id, { prompts: [] });

    default:
      return rpcError(id, RPC_ERRORS.methodNotFound, `Unsupported method "${method}"`);
  }
}

/** Handle a single message or a JSON-RPC batch. Returns null when nothing to send. */
export async function handleRpcPayload(payload, ctx) {
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return rpcError(null, RPC_ERRORS.invalidRequest, 'Empty batch');
    }
    const responses = [];
    for (const message of payload) {
      const response = await handleRpcMessage(message, ctx);
      if (response) responses.push(response);
    }
    return responses.length ? responses : null;
  }
  return await handleRpcMessage(payload, ctx);
}

export { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS };
