/**
 * Share to CMS — the daemon call and the two prompt builders behind the
 * compliance gate.
 *
 * Restored after the 0.20.0 upgrade deleted this module together with the rest
 * of `components/studio/`. The daemon half of the feature was never touched:
 * `POST /api/projects/:id/push/instatic` still normalizes the site, runs the
 * templateRule compliance gate, opens an Owner SSO session on the tenant's
 * Instatic and stages the import. Only the caller went missing, which is why
 * `studio.shareToCms` and friends were left as orphan i18n keys.
 */

/** Why a share attempt did not reach the CMS. */
export type ShareBlockKind =
  /** The templateRule compliance gate rejected the page — the AI can fix this. */
  | 'compliance'
  /** No CMS is attached to this workspace (lite tenant, no `OD_INSTATIC_URL`). */
  | 'not-connected'
  /** Transport / sign-in / staging failure — retrying is the only remedy. */
  | 'unavailable';

export interface ShareBlock {
  kind: ShareBlockKind;
  /** Human-readable reason, already stripped of internal rule-file references. */
  reason: string;
}

/**
 * Push a project's built site to the Instatic CMS. Opens a tab on the click
 * (popup-blocker safe), POSTs to the daemon, and redirects that tab to the
 * import wizard on success. On a block it closes the blank tab and reports the
 * reason through `setBlock` so the caller can raise `ShareToCmsDialog`.
 *
 * Only `kind: 'compliance'` offers "Fix it" — the other two describe states no
 * amount of editing the page will change, and a Fix-it button there would be a
 * control that decides nothing.
 */
export async function pushProjectToCms(
  projectId: string,
  setBlock: (block: ShareBlock | null) => void,
): Promise<void> {
  const cmsTab = window.open('about:blank', '_blank');
  try {
    const response = await fetch(`/api/projects/${projectId}/push/instatic`, { method: 'POST' });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      redirectUrl?: string;
      message?: string;
      error?: string | { code?: string; message?: string };
    };
    if (response.ok && payload.ok && payload.redirectUrl) {
      if (cmsTab) cmsTab.location.href = payload.redirectUrl;
      else window.open(payload.redirectUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    cmsTab?.close();
    const errObj = typeof payload.error === 'object' && payload.error ? payload.error : null;
    const code = errObj?.code ?? '';
    const errMsg = typeof payload.error === 'string' ? payload.error : errObj?.message;
    const raw = (payload.message ?? errMsg ?? '').toString().trim();
    const reason = raw.replace(/\s*\(see templateRule\.md\)/gi, '');
    console.error('[ShareToCms] Share to CMS failed:', code || response.status, raw);
    // The daemon answers 422 `CMS_COMPLIANCE_FAILED` for a gate rejection and
    // 400 `CMS_NOT_CONNECTED` when the workspace has no CMS at all.
    const kind: ShareBlockKind =
      code === 'CMS_NOT_CONNECTED'
        ? 'not-connected'
        : code === 'CMS_COMPLIANCE_FAILED' || response.status === 422
          ? 'compliance'
          : 'unavailable';
    setBlock({
      kind,
      reason: reason || 'Your site editor couldn’t import this page.',
    });
  } catch (err) {
    cmsTab?.close();
    console.error('[ShareToCms] Share to CMS failed:', err);
    setBlock({
      kind: 'unavailable',
      reason: 'Couldn’t reach your site editor. Please try again.',
    });
  }
}

/** The message the tenant SEES in chat when they click "Fix it" (short, reassuring, no jargon). */
export function buildFixVisibleMessage(): string {
  return (
    'Fix the technical parts of this page so it imports into my site editor. ' +
    'Keep the design, layout, and content exactly as they look now — don’t change the look.'
  );
}

/**
 * The detailed instruction the AGENT receives (tenant never sees it — sent via
 * the hidden `context.agentInstruction` channel). Leads with hard directives so
 * the fix is SURGICAL (no rebuild/redesign), then the specific compliance
 * failures reformatted into clean per-page bullets. The AI already carries
 * templateRule in its system prompt.
 */
export function buildFixInstruction(reason: string | null): string {
  const directives =
    'You are fixing this page ONLY so it imports into the site editor (Instatic CMS). ' +
    'Do NOT rebuild, redesign, or regenerate it — keep it visually identical (same design, layout, text, ' +
    'colours, spacing, images); change only the technique. After your fix these must hold: ' +
    '(1) all content is visible with CSS alone — nothing hidden until JavaScript runs (no JS-dismissed ' +
    'loading overlay, no opacity:0 content revealed only by a JS-added class); ' +
    '(2) every image is a real <img> with a working local /images/… path; ' +
    '(3) the page still looks exactly the same. Follow the website build rule.';
  const detail = (reason ?? '')
    .replace(/\s*\(see templateRule\.md\)/gi, '')
    .replace(/^\s*This project violates[^:]*:\s*/i, '')
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `• ${s}`)
    .join('\n');
  return detail ? `${directives}\n\nThe site editor reported these issues to fix:\n${detail}` : directives;
}
