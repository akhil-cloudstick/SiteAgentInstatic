/**
 * Server-side refusal for prompt injection (security class E3).
 *
 * WHAT THIS IS FOR, AND WHAT IT REPLACES.
 *
 * `Instatic/server/ai/tools/untrusted.ts` says it plainly: fencing untrusted
 * text "is a mitigation, not a refusal … The SERVER-side refusal that security
 * class E3 actually requires lives in `promptInjectionGuard`". That docstring
 * named a module that did not exist. This is it.
 *
 * The difference matters. A fence asks the model to behave; a refusal does not
 * ask anyone. Fencing plus a system-prompt rule is what we had, and both are
 * requests directed at the thing being attacked. The PRD lists E3 among the
 * classes with no existing control (line 468) for exactly that reason.
 *
 * WHY THE MARKER LIST IS SHORT, AND WHY IT IS THIS LIST.
 *
 * The phrases come from `prompts/core-slim.ts` — the ones we already tell the
 * model to distrust. Refusing on them asserts nothing new about what is
 * dangerous; it moves an existing judgement from the model to the server, which
 * is the whole of this class.
 *
 * Restraint is copied from `role-marker-guard.ts`, the one real detector in this
 * repo, and for its stated reason: "false positives abort the whole run". That
 * guard deliberately excludes `User:` / `Human:` because they collide with
 * ordinary content. The same test is applied here — a marker earns its place
 * only if it has no innocent reading in a website's own content. So:
 *
 *   IN   "ignore previous instructions", "you are now a different agent",
 *        "your system prompt is", a `<system-reminder>` block — an imperative
 *        addressed at a model, sitting in a page of marketing copy.
 *   OUT  "prompt", "injection", "instructions", "system", "agent", "override",
 *        and every other single word. A page ABOUT prompt injection — a security
 *        company's blog, our own docs — must pass, and the tests say so.
 *
 * The PRD names the class and defines no threshold, exactly as it did for E4
 * where the owner supplied the numbers. What it does bind is P2: nothing fails
 * open. So this refuses on high-confidence markers, and the choice is recorded
 * here so it can be widened later without archaeology.
 */

export interface InjectionFinding {
  /** Which marker fired, by name — never the surrounding text. */
  marker: string;
  /** Where it was found, for the operator's message. */
  where: string;
  /**
   * The matched span, truncated and fenced. Present so an operator can see what
   * was caught; see `excerptFor` for why it is never the surrounding paragraph.
   */
  excerpt: string;
}

export type InjectionVerdict =
  | { verdict: 'allow' }
  | { verdict: 'refuse'; findings: InjectionFinding[] };

interface Marker {
  name: string;
  pattern: RegExp;
}

/**
 * The markers.
 *
 * Case-INsensitive here, unlike `role-marker-guard.ts`. That guard is
 * case-sensitive because its tokens double as legitimate Markdown headings
 * (`## User Guide`), so casing is the signal that separates them. These are
 * whole imperative clauses with no legitimate heading form, so casing carries no
 * information and an attacker would only have to capitalise.
 *
 * `\s+` between words rather than a literal space: newline, tab and
 * double-space variants are the same sentence, and an attacker gets a bypass for
 * free otherwise.
 */
const MARKERS: readonly Marker[] = [
  {
    name: 'ignore-previous-instructions',
    pattern:
      /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)*(?:previous|prior|above|earlier|preceding|foregoing)\s+(?:\w+\s+){0,2}?(?:instruction|instructions|prompt|prompts|direction|directions|rule|rules)\b/i,
  },
  {
    name: 'you-are-now',
    pattern: /\byou\s+are\s+now\s+(?:a|an|the)\s+\w+/i,
  },
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
    // A `<system-reminder>` block inside untrusted content is never real: the
    // host emits those, a web page does not. Called out in our own prompt.
    pattern: /<\s*system-reminder\s*>/i,
  },
  {
    name: 'untrusted-fence-forgery',
    // The fence token from Instatic's `untrusted.ts`. Content carrying it is
    // trying to close its own fence and continue as instructions.
    pattern: /«\s*\/?\s*untrusted-data\s*»/i,
  },
  {
    name: 'respond-only-with',
    pattern: /\brespond\s+only\s+with\b/i,
  },
];

/**
 * Judge a piece of untrusted text.
 *
 * Pure, synchronous, and returns a verdict rather than throwing. The throwing
 * version does not work at the seat that matters — see the note in `server.ts`
 * where this is called inside the compliance correction loop.
 */
export function promptInjectionGuard(value: unknown, where: string): InjectionVerdict {
  const text = typeof value === 'string' ? value : '';
  if (!text) return { verdict: 'allow' };

  const findings: InjectionFinding[] = [];
  for (const marker of MARKERS) {
    const match = marker.pattern.exec(text);
    if (!match) continue;
    findings.push({ marker: marker.name, where, excerpt: excerptFor(match) });
  }

  return findings.length > 0 ? { verdict: 'refuse', findings } : { verdict: 'allow' };
}

/** Judge several named fields at once, returning every marker that fired. */
export function promptInjectionGuardAll(
  fields: ReadonlyArray<{ where: string; value: unknown }>,
): InjectionVerdict {
  const findings: InjectionFinding[] = [];
  for (const field of fields) {
    const verdict = promptInjectionGuard(field.value, field.where);
    if (verdict.verdict === 'refuse') findings.push(...verdict.findings);
  }
  return findings.length > 0 ? { verdict: 'refuse', findings } : { verdict: 'allow' };
}

// ---------------------------------------------------------------------------
// Reporting, which is where a careless refusal reopens the hole it closes
// ---------------------------------------------------------------------------

const FENCE_OPEN = '«untrusted-data»';
const FENCE_CLOSE = '«/untrusted-data»';
const MAX_EXCERPT = 120;

/**
 * The matched span only, truncated, with the fence tokens neutralised inside it.
 *
 * NOT the surrounding paragraph, and this is the constraint that shapes the whole
 * module. The share gate's existing 422 already carries raw page text back to the
 * browser, and `apps/web/src/components/studio/share-to-cms.ts` feeds that string
 * into an agent instruction over the hidden `context.agentInstruction` channel.
 * So an error message is not an inert log line on this path — it is a second
 * injection vector, and a refusal that quoted its input generously would hand the
 * payload to the next agent with our own error message as the wrapper.
 */
function excerptFor(match: RegExpExecArray): string {
  return neutraliseFence(match[0].slice(0, MAX_EXCERPT));
}

/**
 * Strip the fence tokens to a fixpoint.
 *
 * Duplicated from `Instatic/server/ai/tools/untrusted.ts` on purpose: there is
 * no shared package between the daemon and the CMS, and this module must not grow
 * a cross-repo import to get it. Each copy names the other. If the tokens change
 * in one they must change in both — `untrusted-fence-forgery` above is the marker
 * that would start missing.
 *
 * To a fixpoint because removing one occurrence can reveal another that was split
 * across it: `«unt«untrusted-data»rusted-data»`.
 */
function neutraliseFence(value: string): string {
  let current = value;
  let previous: string;
  do {
    previous = current;
    current = current.split(FENCE_OPEN).join('[fence]').split(FENCE_CLOSE).join('[fence]');
  } while (current !== previous);
  return current;
}

/**
 * The sentence an operator reads. Names the marker and where, and quotes the
 * matched span inside a fence so whatever reads this next — a log, a browser, or
 * another agent — meets it as data.
 */
export function describeForOperator(findings: readonly InjectionFinding[]): string {
  const list = findings
    .map((f) => `${f.marker} (in ${f.where}): ${FENCE_OPEN}${f.excerpt}${FENCE_CLOSE}`)
    .join('; ');
  return (
    'Refused: this content instructs the agent rather than describing a website. ' +
    `Matched ${findings.length === 1 ? 'marker' : 'markers'} — ${list}. ` +
    'Nothing was staged, signed or handed to an agent. ' +
    'If this is a page ABOUT prompt injection rather than an attempt at one, the ' +
    'wording has to be quoted or rephrased so it does not read as a direct instruction.'
  );
}
