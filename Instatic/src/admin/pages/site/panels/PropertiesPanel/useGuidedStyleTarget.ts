/**
 * useGuidedStyleTarget — one read/write handle for the guided CSS controls.
 *
 * The raw workbench has two composers because it renders two different section
 * trees: `StyleRuleComposer` (a StyleRule, context-aware) and
 * `InlineStyleComposer` (a node's `style=""`, base-only). The guided controls —
 * Responsive review's named pickers, and the promoted Background image field —
 * need neither tree, just "what is this property set to, and set it".
 *
 * ── Reading: the cascade, not one layer ────────────────────────────────────
 * Those controls are asking about the element as the author sees it on canvas.
 * An imported section's background image lives in one of the node's CLASSES,
 * and no class is "active" until the author clicks a pill in the Advanced
 * disclosure — so reading only the active class (or only the inline bag) showed
 * an empty field over an element that plainly has an image. This resolves the
 * real cascade instead: every assigned class in order, its context override at
 * the active breakpoint, then the node's inline styles on top.
 *
 * ── Writing: where the value already lives ─────────────────────────────────
 * Editing follows the read. If a class already declares the property, the write
 * goes back to THAT class, so changing the image updates the design where it is
 * defined and every element using the class follows — and, crucially, the
 * canvas repaints, which a stray inline override of an unrelated layer would
 * not have done. Only when nothing declares it yet does the value land inline,
 * as a local override of this one element.
 *
 * An explicitly active class still wins over all of it: the author has said
 * which layer they are editing.
 */
import { selectActiveCanvasPage, useEditorStore } from '@site/store/store'
import type { CSSPropertyBag, StyleRule } from '@core/page-tree'
import { getActiveStyleTab } from './cssControlTypes'

/** Stable empty bag so a node with no styles doesn't churn identity per render. */
const EMPTY_STYLES: Record<string, unknown> = {}
const EMPTY_CLASS_IDS: string[] = []

export interface GuidedStyleTarget {
  /** Effective styles at the active editing context (the resolved cascade). */
  styles: Record<string, unknown>
  /** Write one declaration, into whichever layer already owns it. */
  setProperty: (key: keyof CSSPropertyBag, value: string) => void
  /** False when there is nothing to style — the caller renders a read-only note. */
  editable: boolean
}

export function useGuidedStyleTarget(
  nodeId: string | null,
  activeClassId: string | null,
  activeClass: StyleRule | null,
  inlineStyles: Record<string, unknown> | undefined,
): GuidedStyleTarget {
  const activeBreakpointId = useEditorStore((s) => s.activeBreakpointId)
  const styleRules = useEditorStore((s) => s.site?.styleRules)
  // Read through the canvas page so this works the same in a Visual Component
  // document as on a page.
  const canvasPage = useEditorStore(selectActiveCanvasPage)
  const nodeClassIds =
    (nodeId ? canvasPage?.nodes[nodeId]?.classIds : undefined) ?? EMPTY_CLASS_IDS
  const updateClassStyles = useEditorStore((s) => s.updateClassStyles)
  const setClassContextStyles = useEditorStore((s) => s.setClassContextStyles)
  const setNodeInlineStyles = useEditorStore((s) => s.setNodeInlineStyles)

  const activeTab = getActiveStyleTab(activeBreakpointId)
  const contextId = activeTab !== 'base' ? activeTab : null

  /** Base styles merged with the active context override, for one rule. */
  const layerOf = (rule: StyleRule): Record<string, unknown> => ({
    ...rule.styles,
    ...(contextId ? (rule.contextStyles[contextId] ?? {}) : {}),
  })

  const writeToClass = (classId: string) => (key: keyof CSSPropertyBag, value: string) => {
    const patch = { [key]: value } as Partial<CSSPropertyBag>
    if (contextId) {
      setClassContextStyles(classId, contextId, patch)
    } else {
      updateClassStyles(classId, patch)
    }
  }

  // An explicitly selected class is the author saying "edit this layer".
  if (activeClassId && activeClass) {
    return {
      styles: layerOf(activeClass),
      editable: true,
      setProperty: writeToClass(activeClassId),
    }
  }

  if (!nodeId) return { styles: EMPTY_STYLES, editable: false, setProperty: () => {} }

  // The cascade as the canvas resolves it: classes in assignment order, then
  // the node's own inline styles.
  const assigned = nodeClassIds
    .map((classId) => ({ classId, rule: styleRules?.[classId] }))
    .filter((entry): entry is { classId: string; rule: StyleRule } => entry.rule != null)

  const styles: Record<string, unknown> = {}
  for (const { rule } of assigned) Object.assign(styles, layerOf(rule))
  Object.assign(styles, inlineStyles ?? EMPTY_STYLES)

  return {
    styles,
    editable: true,
    setProperty: (key, value) => {
      // Inline already overrides this property — keep editing it there, or the
      // write would be shadowed by the value the author can see.
      if (inlineStyles && inlineStyles[String(key)] !== undefined) {
        setNodeInlineStyles(nodeId, { [String(key)]: value })
        return
      }
      // Otherwise update the class that declares it — last assigned wins the
      // cascade, so that is the one on screen.
      for (let i = assigned.length - 1; i >= 0; i--) {
        const entry = assigned[i]!
        if (layerOf(entry.rule)[String(key)] !== undefined) {
          writeToClass(entry.classId)(key, value)
          return
        }
      }
      // Nothing declares it yet — a local override on this element.
      setNodeInlineStyles(nodeId, { [String(key)]: value })
    },
  }
}
