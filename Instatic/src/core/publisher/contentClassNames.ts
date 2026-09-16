/**
 * Class names a published page uses that no node's `classIds` mentions.
 *
 * The style tree-shaker keeps a class rule only when some node references it.
 * Two kinds of class escape that:
 *
 *   - content HTML — a data row whose body cell holds
 *     `<blockquote class="article-quote">`, styled by a rule no node claims;
 *   - classes the site's own JavaScript switches on at runtime — a reveal
 *     animation's `el.classList.add('visible')`, whose `.pillar.visible` rule
 *     matches nothing until that script has run, so publishing dropped it and
 *     the text stayed in its dimmed "before" state for good.
 *
 * Both are collected here and handed to the tree-shaker as used. A superset is
 * harmless: an extra name can only keep a rule that nothing matches.
 */

const CLASS_ATTR_RE = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi

/** `el.classList.add('a', 'b')`, `.remove`, `.toggle`, `.contains`, `.replace`. */
const CLASS_LIST_CALL_RE = /\.classList\s*\.\s*(?:add|remove|toggle|contains|replace)\s*\(([^)]*)\)/g
/** `el.className = 'a b'` and `el.className += ' a'`. */
const CLASS_NAME_ASSIGN_RE = /\.className\s*\+?=\s*(['"`])([^'"`]*)\1/g
/** `el.setAttribute('class', 'a b')`. */
const SET_CLASS_ATTR_RE = /setAttribute\s*\(\s*(['"`])class\1\s*,\s*(['"`])([^'"`]*)\2/g
/** String literals inside an argument list, so only the arguments are read. */
const STRING_LITERAL_RE = /(['"`])([^'"`]*)\1/g

function addTokens(into: Set<string>, value: string): void {
  for (const token of value.split(/\s+/)) {
    if (token) into.add(token)
  }
}

/**
 * Every class token in a quoted `class` attribute inside any string found in
 * `values`, however deeply nested in arrays and objects.
 */
export function collectContentClassNames(values: Iterable<unknown>): Set<string> {
  const names = new Set<string>()
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (!value.includes('class')) return
      for (const match of value.matchAll(CLASS_ATTR_RE)) {
        addTokens(names, match[1] ?? match[2] ?? '')
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item)
    }
  }
  for (const value of values) visit(value)
  return names
}

/**
 * Class names the site's own scripts add, remove or test at runtime.
 *
 * Only the arguments of `classList` calls and `class`-attribute assignments are
 * read, so an unrelated string in the file contributes nothing.
 */
export function collectScriptClassNames(
  files: Iterable<{ type?: string; content?: string }>,
): Set<string> {
  const names = new Set<string>()
  for (const file of files) {
    if (file?.type !== 'script' && file?.type !== 'component') continue
    const source = file.content
    if (typeof source !== 'string' || !source.includes('class')) continue

    for (const call of source.matchAll(CLASS_LIST_CALL_RE)) {
      for (const literal of (call[1] ?? '').matchAll(STRING_LITERAL_RE)) {
        addTokens(names, literal[2] ?? '')
      }
    }
    for (const assignment of source.matchAll(CLASS_NAME_ASSIGN_RE)) {
      addTokens(names, assignment[2] ?? '')
    }
    for (const attr of source.matchAll(SET_CLASS_ATTR_RE)) {
      addTokens(names, attr[3] ?? '')
    }
  }
  return names
}
