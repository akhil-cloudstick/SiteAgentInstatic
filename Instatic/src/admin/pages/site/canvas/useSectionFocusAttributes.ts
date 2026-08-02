/**
 * useSectionFocusAttributes — the entire imperative half of Section Focus.
 *
 * Stamps two attributes into a canvas iframe:
 *   - `data-section-focus` on `<body>`      → "focus is on"
 *   - `data-section-focused` on one child   → "this is the lit section"
 *
 * `EditorChromeInjector`'s stylesheet does the rest. Nothing here touches the
 * page tree, the store's document, history, or React's tree — which is exactly
 * why entering and leaving Focus costs nothing and preserves scroll position,
 * selection, undo history and the unsaved draft.
 *
 * Attributes rather than a React prop on the section node: the node tree is
 * rendered by `NodeRenderer`, whose per-node subscriptions are deliberately
 * minimal (see its docblock — two rows re-render per selection event, not a
 * thousand). Threading a `focused` prop down would re-render every section on
 * every focus change for a purely presentational effect.
 */
import { useEffect } from 'react'

const BODY_ATTRIBUTE = 'data-section-focus'
const SECTION_ATTRIBUTE = 'data-section-focused'

export function useSectionFocusAttributes(
  doc: Document | null,
  focusedSectionId: string | null,
  /**
   * Changes whenever the set of top-level sections changes. React replaces the
   * focused section's element when the tree around it is edited, which would
   * drop the marker and leave every section dimmed — re-running on this
   * signature re-stamps it.
   */
  sectionSignature: string,
): void {
  useEffect(() => {
    const body = doc?.body
    if (!body) return

    // Clear any previous target first: the focused section can change without
    // focus turning off, and a stale marker would light two sections at once.
    for (const previous of body.querySelectorAll(`[${SECTION_ATTRIBUTE}]`)) {
      previous.removeAttribute(SECTION_ATTRIBUTE)
    }

    if (!focusedSectionId) {
      body.removeAttribute(BODY_ATTRIBUTE)
      return
    }

    body.setAttribute(BODY_ATTRIBUTE, '')
    // Scope to direct children: only a top-level section can be focused, and
    // an unscoped lookup could match a same-id node nested deeper in a
    // composed tree.
    const target = body.querySelector(`:scope > [data-node-id="${CSS.escape(focusedSectionId)}"]`)
    target?.setAttribute(SECTION_ATTRIBUTE, '')

    return () => {
      body.removeAttribute(BODY_ATTRIBUTE)
      target?.removeAttribute(SECTION_ATTRIBUTE)
    }
  }, [doc, focusedSectionId, sectionSignature])
}
