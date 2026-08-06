/**
 * renderModuleTabContent — derive the JSX shown inside StyleSurface's Module
 * section.
 *
 * Three branches:
 *   1. `base.loop` — substitute the schema-driven control list with the
 *      dedicated `LoopPropertiesView` (source picker + dynamic filter UI).
 *      The loop's empty `schema` would otherwise leave the section blank.
 *      Crucially, we still render this *inside* the standard StyleSurface
 *      flow, which means the ClassPicker + style sections (display, layout,
 *      etc.) keep working — the user can assign classes to the loop wrapper
 *      to lay out iterations as a grid, flex row, columns, etc.
 *   2. Visual-component-mode — wrap each control in `ParamPromotableRow` so
 *      the user can lift the prop to the VC's param surface in one click.
 *   3. Default — render each control via `PropertyControlRenderer` with
 *      optional dynamic-binding wiring when the node sits inside an entry-
 *      template page or a `base.loop` ancestor subtree.
 *
 * Lives in its own file because it owns the schema → control dispatch — one
 * of the two highest-churn surfaces of the Properties panel — and benefits
 * from being editable without touching the panel shell.
 *
 * Returns the rows SPLIT around the semantic-tag control (`ModuleTabContent`)
 * so the inspector can slot its promoted Typography section between a module's
 * content fields and its structural ones — "Text, Typography, Tag".
 */
import { PropertyControlRenderer } from '@site/property-controls/PropertyControlRenderer'
import { evaluateCondition } from '@core/page-tree'
import type {
  AnyModuleDefinition,
  PropertyControl,
} from '@core/module-engine'
import type {
  DynamicPropBinding,
  Page,
  PageNode,
} from '@core/page-tree'
import type { LoopEntitySource } from '@core/loops/types'
import type { ActiveDocument } from '../../store/slices/uiSlice'
import { LoopPropertiesView } from './LoopPropertiesView'
import { ParamPromotableRow } from './ParamPromotableRow'
import { FormSettingsPanel } from './FormSettingsPanel'
import { isFormSettingsModule } from './formSettingsAnalysis'

const PROMOTED_FORM_PROPERTY_KEYS = new Set(['mode', 'formId', 'targetTableId'])

/**
 * The semantic-element controls. Everything before the first of these is the
 * module's content (a Text's copy, an Image's source); this one and everything
 * after it is structural.
 *
 * The split exists so the inspector can place the promoted Typography section
 * BETWEEN the two — "Text, Typography, Tag" — rather than above the whole
 * block. A module with no tag control puts everything in `beforeTag`, so
 * Typography simply follows its fields.
 */
const TAG_CONTROL_KEYS = new Set(['tag', 'customTag'])

/**
 * Module rows split around the semantic-tag control so a caller can inject a
 * section between them. Render `beforeTag`, then the injected content, then
 * `fromTag`.
 */
export interface ModuleTabContent {
  beforeTag: React.ReactNode
  fromTag: React.ReactNode
}

interface ModuleTabContentArgs {
  selectedNode: PageNode | null
  selectedNodeId: string | null
  definition: AnyModuleDefinition | null | undefined
  resolvedPropsForBreakpoint: Record<string, unknown> | null
  overrideKeys: Set<string>
  activeDocument: ActiveDocument | null
  activePage: Page | null
  dynamicBindingsEnabled: boolean
  enclosingLoopSource: LoopEntitySource | undefined
  enclosingLoopTableId: string | null
  handleChange: (propKey: string, value: unknown) => void
  handlePatch: (patch: Record<string, unknown>) => void
  onSetDynamicBinding: (propKey: string, binding: DynamicPropBinding) => void
  onClearDynamicBinding: (propKey: string) => void
}

export function renderModuleTabContent(args: ModuleTabContentArgs): ModuleTabContent {
  const {
    selectedNode,
    selectedNodeId,
    definition,
    resolvedPropsForBreakpoint,
    overrideKeys,
    activeDocument,
    activePage,
    dynamicBindingsEnabled,
    enclosingLoopSource,
    enclosingLoopTableId,
    handleChange: updateModuleProp,
    handlePatch: patchModuleProps,
    onSetDynamicBinding,
    onClearDynamicBinding,
  } = args

  // Branch 1: `base.loop` gets the dedicated loop UI.
  if (selectedNode?.moduleId === 'base.loop' && selectedNodeId) {
    return {
      beforeTag: (
        <LoopPropertiesView
          nodeId={selectedNodeId}
          props={selectedNode.props as Record<string, unknown>}
          activePage={activePage}
        />
      ),
      fromTag: null,
    }
  }

  // Branches 2 & 3 share the schema iteration; bail when there's nothing
  // to render against.
  if (!definition || !selectedNode || !resolvedPropsForBreakpoint) {
    return { beforeTag: null, fromTag: null }
  }

  const inVisualComponent =
    activeDocument?.kind === 'visualComponent' && selectedNodeId !== null
  const showFormSettings =
    activePage !== null &&
    selectedNodeId !== null &&
    isFormSettingsModule(selectedNode.moduleId)

  const entries = Object.entries(definition.schema) as Array<[string, PropertyControl]>
  // Index of the first semantic-tag control; -1 (→ everything is "before")
  // when the module has none.
  const tagIndex = entries.findIndex(([key]) => TAG_CONTROL_KEYS.has(key))
  const splitAt = tagIndex === -1 ? entries.length : tagIndex

  const renderRow = ([key, control]: [string, PropertyControl]) => {
    // Hidden controls carry a type for the engine (escaping dispatch) but
    // render no editor surface — e.g. base.outlet.html, a publisher-filled
    // binding target the author never edits.
    if (control.hidden) return null
    if (isPromotedFormProperty(selectedNode, key)) return null
    if (control.condition && !evaluateCondition(control.condition, resolvedPropsForBreakpoint)) {
      return null
    }

    if (inVisualComponent && activeDocument?.kind === 'visualComponent' && selectedNodeId) {
      return (
        <ParamPromotableRow
          key={key}
          vcId={activeDocument.vcId}
          nodeId={selectedNodeId}
          propKey={key}
          control={control}
          value={resolvedPropsForBreakpoint[key]}
          isOverride={overrideKeys.has(key)}
          onChange={updateModuleProp}
        />
      )
    }

    return (
      <PropertyControlRenderer
        key={key}
        propKey={key}
        control={control}
        value={resolvedPropsForBreakpoint[key]}
        onChange={updateModuleProp}
        isOverride={overrideKeys.has(key)}
        dynamicBinding={dynamicBindingsEnabled && selectedNodeId ? {
          binding: selectedNode.dynamicBindings?.[key],
          onSet: (binding) => onSetDynamicBinding(key, binding),
          onClear: () => onClearDynamicBinding(key),
          availableFields: enclosingLoopSource?.fields,
          sourceLabel: enclosingLoopSource?.label,
          loopTableId: enclosingLoopTableId,
        } : undefined}
      />
    )
  }

  return {
    beforeTag: (
      <>
        {showFormSettings && (
          <FormSettingsPanel
            page={activePage}
            nodeId={selectedNodeId}
            onPatchProps={patchModuleProps}
          />
        )}
        {entries.slice(0, splitAt).map(renderRow)}
      </>
    ),
    fromTag: <>{entries.slice(splitAt).map(renderRow)}</>,
  }
}

function isPromotedFormProperty(selectedNode: PageNode, key: string): boolean {
  return selectedNode.moduleId === 'base.form' && PROMOTED_FORM_PROPERTY_KEYS.has(key)
}
