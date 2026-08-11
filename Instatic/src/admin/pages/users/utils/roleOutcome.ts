/**
 * roleOutcome — plain-language summary of what a role can and cannot do.
 *
 * Ported from the approved screen's `model.js`, with its mock capability ids
 * mapped onto this CMS's real `CORE_CAPABILITIES`:
 *
 *   reference id                    → real id
 *   ────────────────────────────────────────────────────────────
 *   media.upload                    → media.write
 *   site.publish | content.publish  → pages.publish | content.publish.any
 *   content.edit.any                → content.edit.any        (unchanged)
 *   site.content.edit               → site.content.edit       (unchanged)
 *   plugins.install                 → plugins.install         (unchanged)
 *   users.manage                    → users.manage            (unchanged)
 *
 * Why a summary at all: a 38-checkbox matrix answers "which capabilities" but
 * not "what will this person actually be able to do", and the latter is the
 * question an operator is really asking when they assign a role. The approved
 * screen shows this sentence pair in two places — the create-account sheet's
 * role card and the workbench's access summary — from one function.
 *
 * Pure: no React, no DOM.
 */

export interface RoleOutcomeDetail {
  allowed: boolean
  text: string
}

export interface RoleOutcome {
  /** "Can edit content, upload media and publish." */
  can: string
  /** "Cannot install plugins or manage users." */
  cannot: string
  /**
   * Present only for roles whose real behaviour the two generated sentences
   * describe too coarsely. The approved panel spells the Client role out
   * line-by-line, so that one role ships explicit copy.
   */
  details?: RoleOutcomeDetail[]
}

/**
 * Join a list the way the reference does: commas throughout, with the final
 * separator replaced. `["a","b","c"]` → `"a, b and c"` (or `"a, b or c"`).
 */
function joinWithFinal(parts: string[], finalWord: 'and' | 'or'): string {
  return parts.join(', ').replace(/, ([^,]*)$/, ` ${finalWord} $1`)
}

export function roleOutcome(role: { slug: string; capabilities: string[] }): RoleOutcome {
  const caps = new Set(role.capabilities)

  const positive: string[] = []
  if (caps.has('content.edit.any') || caps.has('site.content.edit')) positive.push('edit content')
  // Upload subsumes browse, so the stronger verb wins rather than listing both.
  if (caps.has('media.write')) positive.push('upload media')
  else if (caps.has('media.read')) positive.push('browse media')
  if (caps.has('pages.publish') || caps.has('content.publish.any')) positive.push('publish')
  if (caps.has('plugins.install')) positive.push('manage plugins')
  if (caps.has('users.manage')) positive.push('manage users')

  // Capped at three: the reference's card is two lines tall, and a role with
  // everything would otherwise wrap into the capability list below it.
  const can = positive.length > 0
    ? `Can ${joinWithFinal(positive.slice(0, 3), 'and')}.`
    : 'Read-only access to selected CMS areas.'

  const negative: string[] = []
  if (!caps.has('pages.publish') && !caps.has('content.publish.any')) negative.push('publish')
  if (!caps.has('plugins.install')) negative.push('install plugins')
  if (!caps.has('users.manage')) negative.push('manage users')

  const outcome: RoleOutcome = {
    can,
    cannot: negative.length > 0
      ? `Cannot ${joinWithFinal(negative, 'or')}.`
      : 'No standard capability restrictions.',
  }

  if (role.slug === 'client') {
    outcome.details = [
      { allowed: true, text: 'Can edit existing page copy, images and links.' },
      { allowed: true, text: 'Can browse the media library and custom data.' },
      {
        allowed: false,
        text: 'Cannot change layout or styles, publish, install plugins, or manage users.',
      },
    ]
  }

  return outcome
}
