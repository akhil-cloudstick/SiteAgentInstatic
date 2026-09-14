/**
 * The tool-surface revision must actually change when the surface does.
 *
 * The studio used `uploadId` successfully all day against a cached schema that
 * said it would be rejected — the parameter was published, their copy of
 * tools/list was not. An agent has no changelog, so it does not conclude "my
 * cache is old", it concludes "that parameter does not exist" and falls back to
 * inlining a 40 MB bundle.
 *
 * A revision marker that never moves would be worse than none: it would read as
 * proof of freshness. So these check the property that matters — it moves on a
 * schema change, and holds still on things that are not one.
 */

import { expect, test } from 'bun:test'
import { setToolSurface, toolSurface } from '../src/mcp/toolSurface'
import { CONNECTOR_TOOLS } from '../src/mcp/tools'
import { WRITE_TOOLS } from '../src/mcp/writeTools'
import { IMPORT_TOOLS } from '../src/mcp/importTools'

const A = { name: 'a', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } }
const B = { name: 'b', inputSchema: { type: 'object', properties: {} } }

function revisionOf(tools: { name: string; inputSchema: unknown }[]): string {
  setToolSurface(tools)
  return toolSurface().revision
}

test('the same surface yields the same revision', () => {
  expect(revisionOf([A, B])).toBe(revisionOf([A, B]))
})

test('a NEW PROPERTY on an existing tool changes the revision', () => {
  // The exact failure being guarded: same tool name, schema gained `uploadId`.
  const before = revisionOf([A, B])
  const withUploadId = {
    name: 'a',
    inputSchema: { type: 'object', properties: { x: { type: 'string' }, uploadId: { type: 'string' } } },
  }

  expect(revisionOf([withUploadId, B])).not.toBe(before)
})

test('adding or removing a tool changes the revision', () => {
  const before = revisionOf([A, B])

  expect(revisionOf([A])).not.toBe(before)
  expect(revisionOf([A, B, { name: 'c', inputSchema: {} }])).not.toBe(before)
})

test('reordering tools does NOT change the revision', () => {
  // Moving a tool between source files is not a capability change, and would
  // otherwise tell every client to refetch for nothing.
  expect(revisionOf([A, B])).toBe(revisionOf([B, A]))
})

test('the count reflects the surface', () => {
  setToolSurface([A, B])
  expect(toolSurface().count).toBe(2)
})

test('the real surface publishes uploadId and strategy where the studio needs them', () => {
  // Pinned as a contract, not an accident: these are the parameters that carry a
  // real bundle, and a schema that omits them sends a caller back to inlining
  // megabytes. Named tools, named properties.
  const byName = new Map(
    [...CONNECTOR_TOOLS, ...WRITE_TOOLS, ...IMPORT_TOOLS].map((t) => [t.name, t]),
  )
  const propsOf = (name: string): string[] => {
    const schema = byName.get(name)?.inputSchema as { properties?: Record<string, unknown> }
    return Object.keys(schema?.properties ?? {})
  }

  expect(propsOf('connector_preview_import')).toContain('uploadId')
  expect(propsOf('connector_preview_import')).toContain('strategy')
  expect(propsOf('connector_import_replace')).toContain('uploadId')
  expect(propsOf('connector_import_archive')).toContain('uploadId')

  // `bundle` must not be required, or an uploadId-only call is rejected by the
  // schema before it ever reaches the handler that supports it.
  const preview = byName.get('connector_preview_import')?.inputSchema as { required?: string[] }
  expect(preview.required ?? []).not.toContain('bundle')
})
