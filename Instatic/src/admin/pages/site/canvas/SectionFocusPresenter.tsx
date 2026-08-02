/**
 * SectionFocusPresenter — mounts inside a live canvas iframe and keeps its
 * Section Focus attributes in sync. Renders nothing.
 *
 * Mounted only by `CanvasLiveSurface` (`interaction="live"`), because Focus is
 * a live-canvas state by construction — `setCanvasView('design')` clears it —
 * and because the agent's offscreen snapshot frame must never come out dimmed.
 */
import { use } from 'react'
import { useEditorStore } from '@site/store/store'
import { selectActiveCanvasPage } from '@site/store/store'
import { topLevelSectionIds } from '@site/siteWorkspaceMode'
import { CanvasDocumentContext } from './CanvasContexts'
import { useSectionFocusAttributes } from './useSectionFocusAttributes'

export function SectionFocusPresenter() {
  // Mounted inside the portal, so the iframe document is already in context —
  // no need to thread it down from the surface.
  const targetDocument = use(CanvasDocumentContext)
  const sectionFocusNodeId = useEditorStore((s) => s.sectionFocusNodeId)
  const page = useEditorStore(selectActiveCanvasPage)

  // Re-stamp whenever the set of top-level sections changes. The focused
  // section's DOM element is replaced when the tree around it changes, which
  // would otherwise silently drop the marker and leave everything dimmed.
  const sectionSignature = topLevelSectionIds(page).join(',')

  useSectionFocusAttributes(targetDocument, sectionFocusNodeId, sectionSignature)
  return null
}
