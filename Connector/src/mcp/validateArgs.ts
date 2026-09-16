/**
 * Arguments a tool did not ask for are an error, not a shrug.
 *
 * Every tool already declares its accepted arguments in `inputSchema`, but
 * nothing enforced the declaration: a caller who sent `strategy` to
 * `connector_import_replace` had it silently ignored and got a run that did
 * something other than what was asked, with no signal until a screenshot.
 * This turns each of those into an immediate refusal that names the offending
 * argument and lists the accepted set.
 *
 * It validates what the schemas actually say — unknown keys where
 * `additionalProperties` is false, missing `required` keys, declared `type`,
 * `enum` membership, and the same rules one level down through object
 * properties and array items. It is deliberately not a full JSON Schema
 * implementation: the schemas here use that subset, and a validator that
 * quietly ignores the keywords it does not implement would reintroduce exactly
 * the silence it exists to remove.
 */

export interface ArgIssue {
  /** Dotted path to the offending argument, e.g. `fonts[0].family`. */
  path: string
  problem: string
}

type Schema = Record<string, unknown>

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function typeMatches(expected: string, value: unknown): boolean {
  if (expected === 'integer') return Number.isInteger(value)
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value)
  return expected === typeOf(value)
}

function checkValue(schema: Schema, value: unknown, path: string, issues: ArgIssue[]): void {
  const expected = schema.type
  if (typeof expected === 'string' && !typeMatches(expected, value)) {
    issues.push({ path, problem: `expected ${expected}, received ${typeOf(value)}` })
    return
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    issues.push({
      path,
      problem: `must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}, received ${JSON.stringify(value)}`,
    })
    return
  }
  if (expected === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    checkObject(schema, value as Record<string, unknown>, path, issues)
    return
  }
  if (expected === 'array' && Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    value.forEach((item, index) => checkValue(schema.items as Schema, item, `${path}[${index}]`, issues))
  }
}

function checkObject(schema: Schema, value: Record<string, unknown>, path: string, issues: ArgIssue[]): void {
  const properties = (schema.properties ?? {}) as Record<string, Schema>
  const accepted = Object.keys(properties)
  const at = (key: string) => (path ? `${path}.${key}` : key)

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (accepted.includes(key)) continue
      issues.push({
        path: at(key),
        problem: `unknown argument. This call accepts: ${accepted.length > 0 ? accepted.slice().sort().join(', ') : '(no arguments)'}`,
      })
    }
  }
  for (const key of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
    if (value[key] === undefined) issues.push({ path: at(key), problem: 'required, but missing' })
  }
  for (const [key, sub] of Object.entries(properties)) {
    const held = value[key]
    if (held === undefined) continue
    checkValue(sub, held, at(key), issues)
  }
}

/** Every way `args` disagrees with the tool's declared input schema. Empty means it agrees. */
export function validateToolArguments(inputSchema: Schema, args: Record<string, unknown>): ArgIssue[] {
  const issues: ArgIssue[] = []
  checkObject(inputSchema, args, '', issues)
  return issues
}

/** One refusal message naming every disagreement, so a caller fixes them in one pass. */
export function describeArgIssues(toolName: string, issues: readonly ArgIssue[]): string {
  const lines = issues.map((issue) => `  - ${issue.path || '(root)'}: ${issue.problem}`)
  return `Refused: ${toolName} was called with arguments it does not accept.\n${lines.join('\n')}\nNothing was written.`
}
