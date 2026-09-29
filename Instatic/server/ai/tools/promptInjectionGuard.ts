/**
 * The server-side refusal `untrusted.ts` promised (security class E3).
 *
 * That file's docstring says fencing "is a mitigation, not a refusal … The
 * SERVER-side refusal that security class E3 actually requires lives in
 * `promptInjectionGuard`", and named a module that did not exist. This is it, at
 * the path the docstring pointed to.
 *
 * The difference matters. A fence asks the model to behave; a refusal does not
 * ask anyone. Fencing plus a system-prompt rule is what we had, and both are
 * requests addressed to the thing being attacked. The PRD lists E3 among the
 * classes with no existing control (line 468) for that reason.
 *
 * THERE IS A SECOND COPY, in `OpenDesign/apps/daemon/src/prompt-injection-guard.ts`.
 * Deliberate: there is no shared package between the CMS and the daemon, and
 * neither may grow a cross-repo import. The MARKER LIST is the duplicated thing
 * that matters — a marker added here must be added there. Each copy names the
 * other. The one real difference is that this copy imports the actual
 * `fenceUntrusted`, while the daemon carries its own fence tokens.
 *
 * WHY THE LIST IS SHORT. The phrases come from the wording we already tell the
 * model to distrust (`OpenDesign/apps/daemon/src/prompts/core-slim.ts`), so
 * refusing on them asserts nothing new about what is dangerous — it moves an
 * existing judgement from the model to the server, which is the whole of this
 * class.
 *
 * Restraint is copied from `role-marker-guard.ts` in the daemon, the one real
 * detector in either repo, for its stated reason: "false positives abort the
 * whole run". A marker earns its place only if it has no innocent reading in a
 * website's own content. Single words — "prompt", "injection", "instructions",
 * "system", "agent" — are therefore out, and a page ABOUT prompt injection must
 * pass. The tests say so.
 */
import { fenceUntrusted } from './untrusted'

export interface InjectionFinding {
  /** Which marker fired, by name — never the surrounding text. */
  marker: string
  /** Where it was found, for the operator's message. */
  where: string
  /** The matched span only, fenced. See `excerptFor`. */
  excerpt: string
}

export type InjectionVerdict =
  | { verdict: 'allow' }
  | { verdict: 'refuse'; findings: InjectionFinding[] }

interface Marker {
  name: string
  pattern: RegExp
}

/**
 * The markers. Keep in step with the daemon's copy.
 *
 * Case-INsensitive, unlike `role-marker-guard.ts`. That guard is case-sensitive
 * because its tokens double as legitimate Markdown headings (`## User Guide`), so
 * casing is the signal that separates them. These are whole imperative clauses
 * with no legitimate heading form, so casing carries no information and an
 * attacker would only have to capitalise.
 *
 * `\s+` between words rather than a literal space: newline, tab and double-space
 * variants are the same sentence, and an attacker gets a bypass for free
 * otherwise.
 */
const MARKERS: readonly Marker[] = [
  {
    name: 'ignore-previous-instructions',
    pattern:
      /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)*(?:previous|prior|above|earlier|preceding|foregoing)\s+(?:\w+\s+){0,2}?(?:instruction|instructions|prompt|prompts|direction|directions|rule|rules)\b/i,
  },
  { name: 'you-are-now', pattern: /\byou\s+are\s+now\s+(?:a|an|the)\s+\w+/i },
  {
    name: 'new-instructions-follow',
    pattern:
      /\b(?:new|updated|revised)\s+(?:system\s+)?(?:instruction|instructions|prompt|directive|directives)\s*(?::|follow\b|below\b|are\s+as\s+follows)/i,
  },
  {
    name: 'system-prompt-override',
    pattern: /\b(?:your\s+)?(?:system|initial)\s+prompt\s+(?:is|becomes|should\s+be)\b/i,
  },
  {
    name: 'stop-using-tools',
    pattern:
      /\b(?:do\s+not|don't|never|stop)\s+(?:use|using|call|calling)\s+(?:any|your)\s+(?:tool|tools|function|functions)\b|\b(?:do\s+not|don't|never|stop)\s+(?:make|making|use|using|issue|issuing)\s+(?:any\s+|further\s+)?(?:tool|function)\s+calls?\b/i,
  },
  {
    name: 'reveal-the-prompt',
    pattern:
      /\b(?:reveal|repeat|print|output|show|disclose)\s+(?:me\s+)?(?:your|the)\s+(?:system\s+prompt|instructions|initial\s+prompt|prompt\s+above)\b/i,
  },
  {
    name: 'fabricated-system-reminder',
    // A `<system-reminder>` block inside stored content is never real: the host
    // emits those, a web page does not.
    pattern: /<\s*system-reminder\s*>/i,
  },
  {
    name: 'untrusted-fence-forgery',
    // Content carrying our own fence token is trying to close its fence and
    // continue as instructions.
    pattern: /«\s*\/?\s*untrusted-data\s*»/i,
  },
  { name: 'respond-only-with', pattern: /\brespond\s+only\s+with\b/i },
]

const MAX_EXCERPT = 120

/**
 * The matched span only, truncated, and fenced.
 *
 * NOT the surrounding paragraph, and this constraint shapes the module. The share
 * gate's 422 already carries raw page text back to the browser, and the studio's
 * `share-to-cms.ts` feeds that string into an agent instruction over the hidden
 * `context.agentInstruction` channel. An error message on this path is not an
 * inert log line — it is a second injection vector, and a refusal that quoted its
 * input generously would hand the payload to the next agent wrapped in our own
 * error message. `fenceUntrusted` also strips control characters and the fence
 * tokens themselves, to a fixpoint.
 */
function excerptFor(match: RegExpExecArray): string {
  return fenceUntrusted(match[0], MAX_EXCERPT)
}

/**
 * Judge a piece of untrusted text.
 *
 * Returns a verdict rather than throwing. At the daemon's correction-loop seat a
 * thrown error is swallowed by two outer catches and laundered into a generic
 * failure code, so a refusal has to be a value the caller reports, not an
 * exception. Keeping both copies the same shape is worth more than the small
 * convenience of throwing here.
 */
export function promptInjectionGuard(value: unknown, where: string): InjectionVerdict {
  const text = typeof value === 'string' ? value : ''
  if (!text) return { verdict: 'allow' }

  const findings: InjectionFinding[] = []
  for (const marker of MARKERS) {
    const match = marker.pattern.exec(text)
    if (!match) continue
    findings.push({ marker: marker.name, where, excerpt: excerptFor(match) })
  }
  return findings.length > 0 ? { verdict: 'refuse', findings } : { verdict: 'allow' }
}

/** Judge several named fields at once, returning every marker that fired. */
export function promptInjectionGuardAll(
  fields: ReadonlyArray<{ where: string; value: unknown }>,
): InjectionVerdict {
  const findings: InjectionFinding[] = []
  for (const field of fields) {
    const verdict = promptInjectionGuard(field.value, field.where)
    if (verdict.verdict === 'refuse') findings.push(...verdict.findings)
  }
  return findings.length > 0 ? { verdict: 'refuse', findings } : { verdict: 'allow' }
}

/**
 * The sentence an operator reads. Names the marker and where, and quotes the
 * matched span already fenced by `excerptFor`, so whatever reads this next — a
 * log, a browser, or another agent — meets it as data.
 */
export function describeForOperator(findings: readonly InjectionFinding[]): string {
  const list = findings.map((f) => `${f.marker} (in ${f.where}): ${f.excerpt}`).join('; ')
  return (
    'Refused: this content instructs the agent rather than describing a website. ' +
    `Matched ${findings.length === 1 ? 'marker' : 'markers'} — ${list}. ` +
    'Nothing was staged or handed to an agent. ' +
    'If this is a page ABOUT prompt injection rather than an attempt at one, the ' +
    'wording has to be quoted or rephrased so it does not read as a direct instruction.'
  )
}
