/**
 * Connector MCP tool catalogue.
 *
 * Only tools whose implementation actually exists are registered. A tool that
 * advertises itself and then returns "not implemented" is worse than an absent
 * one: an agent will plan a whole migration around it and fail halfway.
 *
 * As the emitter, HTTP client and release path land, their tools join this list.
 * Every write-side tool will carry its approval bindings as required inputs, so
 * the gate cannot be skipped by calling the tool directly.
 */

import { resolve } from 'node:path'
import { runDoctor, DoctorFailedError } from '../env/doctor'
import { registeredModuleIds } from '../env/shim'
import { rowsDigest, type HashableRow } from '../hash/row'
import { verifyApproval, parseApproval, parseReleaseManifest } from '../approval/verify'

export interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

export interface ConnectorTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<ToolResult>
}

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})

const fail = (message: string, detail?: unknown): ToolResult => ({
  content: [
    { type: 'text', text: JSON.stringify({ error: message, detail }, null, 2) },
  ],
  isError: true,
})

export const CONNECTOR_TOOLS: ConnectorTool[] = [
  {
    name: 'connector_doctor',
    description:
      'Verify the conversion environment: DOM globals, the base module registry, and a ' +
      'fixture conversion through Instatic’s own importHtml/cssToStyleRules. Run this ' +
      'before anything else — a silent CSS failure here loses every style on the site.',
    inputSchema: {
      type: 'object',
      properties: {
        fixtureDir: {
          type: 'string',
          description: 'Optional fixture directory. Defaults to the bundled doctor fixture.',
        },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const dir =
        typeof args.fixtureDir === 'string'
          ? resolve(args.fixtureDir)
          : resolve(import.meta.dir, '../../fixtures/doctor')
      try {
        return ok(await runDoctor(dir))
      } catch (err) {
        if (err instanceof DoctorFailedError) return fail(err.message, err.report)
        throw err
      }
    },
  },

  {
    name: 'connector_environment',
    description:
      'Report the Connector runtime environment: Bun version, registered Instatic module ids, ' +
      'and whether the DOM globals are installed. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () =>
      ok({
        bunVersion: typeof Bun !== 'undefined' ? Bun.version : 'unknown',
        moduleIds: registeredModuleIds(),
        domParser: typeof globalThis.DOMParser !== 'undefined',
        cssStyleSheet: typeof globalThis.CSSStyleSheet !== 'undefined',
      }),
  },

  {
    name: 'connector_hash_rows',
    description:
      'Compute the canonical per-row hashes and the aggregate rows digest for a set of rows. ' +
      'The digest is what an approval binds; each per-row hash is what the release sends as ' +
      'If-Match. Order-independent. Read-only — computes, never writes.',
    inputSchema: {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          description: 'Rows to hash.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              tableId: { type: 'string' },
              slug: { type: 'string' },
              cells: { type: 'object' },
              authorUserId: { type: ['string', 'null'] },
            },
            required: ['id', 'tableId', 'slug', 'cells'],
          },
        },
      },
      required: ['rows'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const rows = args.rows as HashableRow[]
      if (!Array.isArray(rows)) return fail('rows must be an array')
      return ok(rowsDigest(rows))
    },
  },

  {
    name: 'connector_verify_approval',
    description:
      'Check an approval record against observed state and a release manifest. Returns every ' +
      'failing binding at once rather than the first, so a broken release is diagnosed in one ' +
      'pass. Read-only — this is the gate, it does not perform a release.',
    inputSchema: {
      type: 'object',
      properties: {
        approval: { type: 'object', description: 'The approval record.' },
        observed: { type: 'object', description: 'Observed state to compare against.' },
        releaseManifest: { type: 'object', description: 'The release manifest it binds.' },
      },
      required: ['approval', 'observed', 'releaseManifest'],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        const approval = parseApproval(args.approval)
        const manifest = parseReleaseManifest(args.releaseManifest)
        verifyApproval(approval, args.observed as never, manifest)
        return ok({ verified: true, approvalId: approval.approvalId })
      } catch (err) {
        const failures = (err as { failures?: unknown }).failures
        return fail(err instanceof Error ? err.message : String(err), failures)
      }
    },
  },
]
