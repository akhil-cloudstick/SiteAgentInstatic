/**
 * Every inline script on every rendered page must parse.
 *
 * This exists because it did not, and the cost was the whole Approvers page.
 *
 * `APPROVER_SCRIPT` is a template literal, so a `\n` written inside it is
 * interpreted by TypeScript and emitted as a REAL newline into the browser's
 * JavaScript — inside a single-quoted string. That is a SyntaxError, and a
 * SyntaxError anywhere in an inline script kills the ENTIRE script: Register,
 * Designate and Retire all stopped working together, on a page that looked
 * completely normal.
 *
 * The suite was green throughout. Seventy-three tests asserted what the routes
 * answer and what the HTML contains, and not one of them asked whether the
 * script the page ships can run. Asserting that a page contains a button is not
 * the same as asserting the button works, and the gap between those two is
 * exactly the size of this bug.
 *
 * `new Function(text)` parses without executing, which is what is wanted: the
 * scripts reference `document` and `fetch`, and none of that has to exist for
 * the question "is this valid JavaScript" to be answered.
 */
import { expect, test } from 'bun:test'
import { OWNER, VALIDATOR, openDeployRequest, relay } from './helpers'

/** Every `<script>` body in a document, ignoring those with a `src`. */
function inlineScripts(html: string): string[] {
  const found: string[] = []
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const attrs = match[1] ?? ''
    if (/\bsrc\s*=/i.test(attrs)) continue
    const body = (match[2] ?? '').trim()
    if (body) found.push(body)
  }
  return found
}

/** Parse, do not run. A SyntaxError throws here; a missing `document` does not. */
function parses(script: string): { ok: true } | { ok: false; error: string } {
  try {
    new Function(script)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

test('every inline script on every page is valid JavaScript', async () => {
  // A page with an approver registered AND a test property designated, because
  // both write values into the script, and a row is one of the ways a page can
  // be made to emit something unparseable.
  const r = relay({ testProperties: ['acceptance-scratch'] })
  const dr = await openDeployRequest(r, { target: 'acceptance-scratch' })

  const pages: { path: string; actor: typeof OWNER }[] = [
    { path: '/', actor: OWNER },
    { path: '/approvers', actor: OWNER },
    { path: `/t/${dr.id}`, actor: OWNER },
    // The same pages as the validator, whose view differs — the GO screen and
    // the registry's write form are drawn conditionally, so a fault could live
    // in a branch only one role ever sees.
    { path: '/', actor: VALIDATOR },
    { path: '/approvers', actor: VALIDATOR },
    { path: `/t/${dr.id}`, actor: VALIDATOR },
  ]

  let checked = 0
  for (const { path, actor } of pages) {
    const res = await r.call(actor, 'GET', path)
    expect({ path, role: actor.role, status: res.status }).toEqual({ path, role: actor.role, status: 200 })

    for (const [index, script] of inlineScripts(res.text).entries()) {
      const verdict = parses(script)
      // The failure names the page, the role and the script, because "a script
      // somewhere does not parse" is not a fault anyone can act on.
      expect({
        path,
        role: actor.role,
        script: index,
        error: verdict.ok ? null : verdict.error,
      }).toEqual({ path, role: actor.role, script: index, error: null })
      checked++
    }
  }

  // A test that found no scripts would pass while proving nothing, and this one
  // is guarding against a whole page failing silently — so it has to be able to
  // tell "all fine" from "I looked at nothing".
  expect(checked).toBeGreaterThan(0)
})

test('the parser this test relies on would actually catch the bug it was written for', async () => {
  // Guarding the guard. If `new Function` did not reject the shape that broke
  // the page, the test above would be decorative — and a decorative test in
  // this position is worse than none, because it reads as coverage.
  //
  // This is the exact fault: a real newline inside a single-quoted string,
  // which is what a `\n` in the source template literal became.
  const broken = "const q = 'Designate a property?\n\nThe validator may submit.';"
  const verdict = parses(broken)
  expect(verdict.ok).toBe(false)

  // And the correct form — an escape sequence rather than a line break — passes.
  const fixed = "const q = 'Designate a property?\\n\\nThe validator may submit.';"
  expect(parses(fixed).ok).toBe(true)
})
