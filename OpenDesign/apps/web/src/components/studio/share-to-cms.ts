/**
 * Share to CMS — the daemon call and the two prompt builders behind the
 * compliance gate.
 *
 * These used to live in `FileViewer.tsx`'s module scope, which was fine while
 * the viewer's share menu was the only entry point. The approved MMSBUILD
 * Studio puts a `Share to CMS` button in the project toolbar
 * (`prototype-reference/src/ui.jsx:259-266`), so there are now two callers and
 * the logic has to be shared rather than copied — a second copy is exactly how
 * the two buttons would drift apart.
 */

/**
 * Push a project's built site to the Instatic CMS. Opens a tab on the click
 * (popup-blocker safe), POSTs to the daemon, and redirects that tab to the
 * import wizard on success. On a block (typically the compliance gate) it
 * closes the blank tab and reports the reason through `setBlockReason` so the
 * caller can raise `ShareToCmsDialog` (Cancel / Fix it).
 */
export async function pushProjectToCms(
  projectId: string,
  setBlockReason: (reason: string | null) => void,
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
    const errMsg = typeof payload.error === 'string' ? payload.error : payload.error?.message;
    const raw = (payload.message ?? errMsg ?? '').toString().trim();
    const reason = raw.replace(/\s*\(see templateRule\.md\)/gi, '');
    console.error('[ShareToCms] Share to CMS failed:', raw || response.status);
    setBlockReason(reason || 'Your site editor couldn’t import this page.');
  } catch (err) {
    cmsTab?.close();
    console.error('[ShareToCms] Share to CMS failed:', err);
    setBlockReason('Couldn’t reach your site editor. Please try again.');
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
