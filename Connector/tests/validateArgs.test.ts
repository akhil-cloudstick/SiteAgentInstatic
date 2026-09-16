/**
 * Arguments a tool never declared are refused, not ignored.
 *
 * The defects this prevents were all silent accepts: a `strategy` argument sent
 * to connector_import_replace that the tool ignored, a misspelled key that left
 * a default in place, a number where a string belonged. Each looked like a
 * successful run and failed later, on the site.
 */

import { expect, test } from 'bun:test'
import { describeArgIssues, validateToolArguments } from '../src/mcp/validateArgs'
import { CONNECTOR_TOOLS } from '../src/mcp/tools'
import { IMPORT_TOOLS } from '../src/mcp/importTools'
import { CRUD_TOOLS } from '../src/mcp/crudTools'
import { ADMIN_TOOLS } from '../src/mcp/adminTools'

const ALL = [...CONNECTOR_TOOLS, ...IMPORT_TOOLS, ...CRUD_TOOLS, ...ADMIN_TOOLS]
const schemaOf = (name: string) => ALL.find((t) => t.name === name)!.inputSchema as Record<string, unknown>

test('an argument the tool does not declare is refused, and the accepted set is named', () => {
  const issues = validateToolArguments(schemaOf('connector_import_replace'), {
    target: 'alpha',
    confirm: 'REPLACE alpha',
    uploadId: 'upload-0000000000000000.json',
    strategy: 'merge-add',
  })
  expect(issues).toHaveLength(1)
  expect(issues[0]!.path).toBe('strategy')
  expect(issues[0]!.problem).toContain('unknown argument')
  expect(issues[0]!.problem).toContain('uploadId')
})

test('a required argument that is missing is named', () => {
  const issues = validateToolArguments(schemaOf('connector_import_replace'), { target: 'alpha' })
  expect(issues.map((i) => i.path)).toContain('confirm')
  expect(issues.find((i) => i.path === 'confirm')!.problem).toBe('required, but missing')
})

test('a declared type that does not match is named, with both types', () => {
  const issues = validateToolArguments(schemaOf('connector_list_rows'), { tableId: 'news', limit: '25' })
  expect(issues).toEqual([{ path: 'limit', problem: 'expected number, received string' }])
})

test('a value outside a declared enum is refused, listing what is accepted', () => {
  const issues = validateToolArguments(schemaOf('connector_list_rows'), { tableId: 'news', fields: 'everything' })
  expect(issues).toHaveLength(1)
  expect(issues[0]!.problem).toContain('"summary"')
  expect(issues[0]!.problem).toContain('"full"')
})

test('array items are checked one level down, with their index in the path', () => {
  const issues = validateToolArguments(schemaOf('connector_install_google_fonts'), {
    target: 'alpha',
    fonts: [{ family: 'Space Grotesk', variants: ['400'] }, { variants: ['400'] }],
  })
  expect(issues.map((i) => i.path)).toEqual(['fonts[1].family'])
  expect(issues[0]!.problem).toBe('required, but missing')
})

test('arguments a tool does declare pass, including the optional ones left out', () => {
  expect(validateToolArguments(schemaOf('connector_import_replace'), {
    target: 'alpha',
    confirm: 'REPLACE alpha',
    relaySha256: 'a'.repeat(64),
  })).toEqual([])
  expect(validateToolArguments(schemaOf('connector_publish_rows'), { target: 'alpha', rowIds: ['news-1'] })).toEqual([])
})

test('every issue is reported in one refusal rather than one per call', () => {
  const issues = validateToolArguments(schemaOf('connector_list_rows'), { limit: '25', nope: 1 })
  expect(issues).toHaveLength(3)
  const message = describeArgIssues('connector_list_rows', issues)
  expect(message).toContain('connector_list_rows was called with arguments it does not accept')
  expect(message).toContain('tableId: required, but missing')
  expect(message).toContain('Nothing was written.')
})

test('every registered tool declares a closed argument set, so unknown arguments cannot slip through', () => {
  const open = ALL.filter((t) => (t.inputSchema as { additionalProperties?: unknown }).additionalProperties !== false)
  expect(open.map((t) => t.name)).toEqual([])
})
