/**
 * PropertiesPanelBody — selects which inspector surface to show inside the
 * scrollable content area of the Properties panel.
 *
 * Five priority branches decide whether a NODE inspector is what the user is
 * looking at:
 *   1. A class is selected via the Selectors panel → global selector inspector.
 *   2. Multiple nodes are selected → multi-select inspector.
 *   3. No node + no selector, but we're inside a Visual Component canvas →
 *      show the VC's param surface.
 *   4. No node at all (page canvas with nothing selected) → empty hint.
 *   5. Otherwise → the node inspector. The approved Site screen has TWO node
 *      inspectors, not three: Responsive review gets its own guided-CSS body,
 *      while Live edit and Focus section share one body that branches on the
 *      SELECTION (`NodeInspectorBody`). Only the panel title reads the mode.
 *
 * Those bodies replaced the old Styles/Attributes switcher. The switcher's
 * surfaces are all still reachable — the reference's own
 * "Advanced CSS, classes & attributes" disclosure is where the class picker,
 * the raw property workbench and the HTML attribute editor now live, and the
 * guided Layout/Style tabs render slices of the same workbench.
 *
 * PropertiesPanel still composes the moduleTabContent JSX once (via
 * `renderModuleTabContent`) and passes it in, keeping the schema → control
 * dispatch reusable across all three bodies.
 */
import { EmptyState } from '@ui/components/EmptyState'
import { useEditorPermissions } from '@site/editorPermissionsContext'
import { registry } from '@core/module-engine'
import type { AnyModuleDefinition } from '@core/module-engine'
import { getNodeDisplayName, type StyleRule, type PageNode } from '@core/page-tree'
import type { VisualComponent } from '@core/visualComponents'
import type { ActiveDocument } from '../../store/slices/uiSlice'
import { useEditorStore } from '@site/store/store'
import { selectSiteWorkspaceMode } from '@site/siteWorkspaceMode'
import { type ClassPickerHandle } from './ClassPicker'
import { ComponentParamsOverview } from './ComponentParamsOverview'
import { ComponentRefView } from './ComponentRefView'
import { MultiSelectionInspector } from './MultiSelectionInspector'
import { MultiSelectorInspector } from './MultiSelectorInspector'
import { SelectorInspector } from './SelectorInspector'
import { NodeInspectorBody } from './NodeInspectorBody'
import type { ModuleTabContent } from './renderModuleTabContent'
import { ReviewInspectorBody } from './ReviewInspectorBody'
import { canComponentizeNode } from '@site/componentization'

interface PropertiesPanelBodyProps {
  selectedSelectorClass: StyleRule | null
  selectedSelectorClassId: string | null
  selectedSelectorClassIds: string[]
  isSelectorMultiSelect: boolean
  activeBreakpointId: string | undefined
  isMultiSelect: boolean
  selectedNodeIds: string[]
  selectedNode: PageNode | null
  selectedNodeId: string | null
  definition: AnyModuleDefinition | null | undefined
  activeDocument: ActiveDocument | null
  activeVc: VisualComponent | null
  activeClass: StyleRule | null
  activeClassId: string | null
  moduleTabContent: ModuleTabContent
  classPickerRef: React.RefObject<ClassPickerHandle | null>
  onFocusClassPicker: () => void
  /** Prop keys carrying a breakpoint override at the active context. */
  overrideKeys: Set<string>
}

export function PropertiesPanelBody(props: PropertiesPanelBodyProps): React.ReactNode {
  const {
    selectedSelectorClass,
    selectedSelectorClassId,
    selectedSelectorClassIds,
    isSelectorMultiSelect,
    activeBreakpointId,
    isMultiSelect,
    selectedNodeIds,
    selectedNode,
    selectedNodeId,
    definition,
    activeDocument,
    activeVc,
    activeClass,
    activeClassId,
    moduleTabContent,
    classPickerRef,
    onFocusClassPicker,
    overrideKeys,
  } = props
  const permissions = useEditorPermissions()
  const siteMode = useEditorStore(selectSiteWorkspaceMode)
  const visualComponents = useEditorStore((s) => s.site?.visualComponents)

  // Selector multi-selection (Selectors panel checkboxes) takes priority — the
  // user explicitly built a bulk set and expects the bulk action surface.
  if (isSelectorMultiSelect) {
    return <MultiSelectorInspector selectedSelectorClassIds={selectedSelectorClassIds} />
  }

  if (selectedSelectorClass) {
    return (
      <SelectorInspector cls={selectedSelectorClass} activeBreakpointId={activeBreakpointId} />
    )
  }

  if (isMultiSelect) {
    return <MultiSelectionInspector selectedNodeIds={selectedNodeIds} />
  }

  if (!selectedNode || !definition) {
    const inEmptyVcCanvas =
      activeDocument?.kind === 'visualComponent' &&
      selectedNodeId === null &&
      selectedSelectorClassId === null &&
      !!activeVc
    if (inEmptyVcCanvas && activeVc) {
      return <ComponentParamsOverview vc={activeVc} />
    }
    return (
      <EmptyState
        variant="centered"
        title="Select an element on the canvas to view its properties."
      />
    )
  }

  // ConvertToComponentButton is structural (it adds a new VC to the registry
  // and replaces the selected subtree with a ref) — gate on structure.
  const showConvertToComponent =
    permissions.canEditStructure && canComponentizeNode(activeDocument, selectedNode)

  const componentId =
    selectedNode.moduleId === 'base.visual-component-ref'
      ? String(selectedNode.props.componentId ?? '')
      : null

  // "Instance parameters" content. For a component instance the ref module's
  // own schema is plumbing, so the VC's declared params are what an author
  // edits — `ComponentRefView` renders those rows with their Default /
  // Overridden pill and Reset intact.
  // A VC instance has no semantic-tag control of its own, so everything sits
  // in `beforeTag` and the promoted Typography section follows its params.
  const paramsContent: ModuleTabContent = componentId
    ? {
        beforeTag: (
          <ComponentRefView
            nodeId={selectedNodeId!}
            componentId={componentId}
            propOverrides={(selectedNode.props.propOverrides ?? {}) as Record<string, unknown>}
          />
        ),
        fromTag: null,
      }
    : moduleTabContent

  // Everything the three bodies need to read from / write to the node's style
  // target, in one bundle so the shared surfaces can be spread into.
  const styleTarget = {
    nodeId: selectedNodeId,
    definition,
    activeClass,
    activeClassId,
    activeBreakpointId,
    inlineStyles: selectedNode.inlineStyles,
  }

  if (siteMode === 'review') {
    return (
      <ReviewInspectorBody
        {...styleTarget}
        nodeName={getNodeDisplayName(
          selectedNode,
          registry.get(selectedNode.moduleId),
          visualComponents,
        )}
        isComponentInstance={componentId !== null}
        overrideKeys={overrideKeys}
        htmlAttributes={selectedNode.props.htmlAttributes}
      />
    )
  }

  // Live edit and Focus section share one body — the reference branches on the
  // selection, not the mode.
  return (
    <NodeInspectorBody
      {...styleTarget}
      selectedNode={selectedNode}
      moduleContent={paramsContent}
      componentId={componentId}
      showConvertToComponent={showConvertToComponent}
      htmlAttributes={selectedNode.props.htmlAttributes}
      overrideKeys={overrideKeys}
      classPickerRef={classPickerRef}
      onFocusClassPicker={onFocusClassPicker}
    />
  )
}
