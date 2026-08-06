/**
 * NodeInspectorBody — the approved Site screen's inspector for a selected node.
 *
 * ── Why one body for Live edit AND Focus section ───────────────────────────
 * The reference (`screens/site/src/App.jsx` → `InspectorPanel`) branches its
 * BODY on the selection, not on the mode:
 *
 *     mode === "review"        → ResponsiveInspector          (its own body)
 *     else selected === "services" → the component branch     (card + tabs + slot list)
 *     else                     → the element branch           (badge + parameters)
 *
 * Only the `<h2>` reads the mode. So Live edit and Focus section show the SAME
 * inspector for the same selection — which is what this file reproduces. An
 * earlier pass split them into two bodies keyed on the mode; that was wrong
 * against the reference and is why Focus grew a tab strip that Live lacked.
 *
 * ── One layer, one inspector ───────────────────────────────────────────────
 * The panel edits the SELECTED layer and nothing else — pick a text and you get
 * that text's parameters, pick an image and you get the image's. A container's
 * parameters are its own; its children are edited by selecting them.
 *
 * ── The two branches ───────────────────────────────────────────────────────
 * The mock's "services" is a component instance that exposes a content slot,
 * and its "hero" is one that does not. That is the real distinction, so:
 *
 *   component instance WITH slots → ComponentCard, Content/Layout/Style tabs,
 *       "Slot content · <slot>" list, and the reference's three disclosures.
 *   everything else               → the Visual-component badge (component
 *       instances only), "Instance parameters", the node's fields,
 *       "Layout & spacing", "Advanced instance styles, classes & attributes"
 *       and the closing info note.
 *
 * Section slices never overlap — see `./inspectorSections`.
 */
import { useState, type RefObject } from 'react'
import { registry } from '@core/module-engine'
import { getNodeDisplayName, type PageNode } from '@core/page-tree'
import { selectActiveCanvasPage, useEditorStore } from '@site/store/store'
import { moduleGlyph } from '@site/moduleGlyph'
import { Section } from '@ui/components/Section'
import {
  AdvancedDisclosure,
  ResponsiveOverridesDisclosure,
  StyleSlice,
  type StyleTargetProps,
} from './InspectorSurfaces'
import {
  BACKGROUND_IMAGE_PROPERTIES,
  LAYOUT_SECTION_IDS,
  STYLE_SECTION_IDS,
  VISIBILITY_SECTION_IDS,
} from './inspectorSections'
import { BackgroundImageField } from './BackgroundImageField'
import { useGuidedStyleTarget } from './useGuidedStyleTarget'
import type { ClassPickerHandle } from './ClassPicker'
import {
  ComponentCard,
  InfoNote,
  InspectorBody,
  InspectorGroupTitle,
  InspectorHelper,
  InspectorKicker,
  InspectorTabs,
  OpenInCanvasAction,
  SlotContentList,
  VisualBadge,
  type InspectorTab,
} from './inspector'
import type { ModuleTabContent } from './renderModuleTabContent'

type ComponentTab = 'content' | 'layout' | 'style'

const TABS: ReadonlyArray<InspectorTab<ComponentTab>> = [
  { id: 'content', label: 'Content' },
  { id: 'layout', label: 'Layout' },
  { id: 'style', label: 'Style' },
]

/** The module a slot's "Insert …" CTA adds. Containers keep slots composable. */
const SLOT_CHILD_MODULE_ID = 'base.container'

/**
 * Typography is promoted to a top-level section in the element branch: it is
 * the setting authors reach for most, and burying it inside "Advanced instance
 * styles" made changing a font a three-click expedition. It is REMOVED from
 * the Advanced slice below so it still has exactly one home.
 *
 * Scoped to this branch on purpose — the component branch's Style tab and
 * `ReviewInspectorBody` still use the whole `STYLE_SECTION_IDS` slice, so the
 * global partition in `inspectorSections.ts` is unchanged.
 */
const ELEMENT_TYPOGRAPHY_SECTION_IDS = ['typography'] as const
/** The element branch has no tabs, so its Advanced disclosure carries the rest. */
const ELEMENT_ADVANCED_SECTION_IDS = [
  ...STYLE_SECTION_IDS.filter(
    (id) => !(ELEMENT_TYPOGRAPHY_SECTION_IDS as readonly string[]).includes(id),
  ),
  ...VISIBILITY_SECTION_IDS,
]
/** The component branch's tabs own Layout and Style; only Visibility is left. */
const COMPONENT_ADVANCED_SECTION_IDS = [...VISIBILITY_SECTION_IDS]

interface NodeInspectorBodyProps extends StyleTargetProps {
  selectedNode: PageNode
  /** Module rows split around the semantic-tag control, so Typography can slot between them. */
  moduleContent: ModuleTabContent
  /** Set when the selected node is a `base.visual-component-ref`. */
  componentId: string | null
  showConvertToComponent: boolean
  htmlAttributes: unknown
  overrideKeys: ReadonlySet<string>
  classPickerRef?: RefObject<ClassPickerHandle | null>
  onFocusClassPicker?: () => void
}

export function NodeInspectorBody(props: NodeInspectorBodyProps) {
  const page = useEditorStore(selectActiveCanvasPage)

  // Slot instances are `base.slot-instance` children of a VC ref, one per slot
  // the component declares (`syncSlotInstances`). Their presence is what makes
  // this the mock's "services" case rather than its "hero" case.
  const slotInstances = props.componentId
    ? props.selectedNode.children
        .map((childId) => page?.nodes[childId])
        .filter((node): node is PageNode => node?.moduleId === 'base.slot-instance')
    : []

  return slotInstances.length > 0 ? (
    <ComponentBranch {...props} slotInstances={slotInstances} />
  ) : (
    <ElementBranch {...props} />
  )
}

// ---------------------------------------------------------------------------
// Component branch — the reference's "services" inspector
// ---------------------------------------------------------------------------

function ComponentBranch({
  selectedNode,
  moduleContent,
  componentId,
  showConvertToComponent,
  htmlAttributes,
  overrideKeys,
  classPickerRef,
  onFocusClassPicker,
  slotInstances,
  ...target
}: NodeInspectorBodyProps & { slotInstances: PageNode[] }) {
  const [tab, setTab] = useState<ComponentTab>('content')
  const visualComponents = useEditorStore((s) => s.site?.visualComponents)
  const breakpoints = useEditorStore((s) => s.site?.breakpoints)
  const setActiveDocument = useEditorStore((s) => s.setActiveDocument)

  const name = getNodeDisplayName(
    selectedNode,
    registry.get(selectedNode.moduleId),
    visualComponents,
  )
  const vc = componentId
    ? (visualComponents?.find((candidate) => candidate.id === componentId) ?? null)
    : null
  const paramCount = vc?.params.length ?? 0
  const summary = `${paramCount} ${paramCount === 1 ? 'parameter' : 'parameters'} · ${slotInstances.length} ${slotInstances.length === 1 ? 'content slot' : 'content slots'}`

  const contextLabel =
    breakpoints?.find((breakpoint) => breakpoint.id === target.activeBreakpointId)?.label ??
    'This viewport'

  return (
    <>
      <ComponentCard
        glyph={moduleGlyph(selectedNode.moduleId, name)}
        name={name}
        summary={summary}
        onOpenInCanvas={
          componentId
            ? () => setActiveDocument({ kind: 'visualComponent', vcId: componentId })
            : undefined
        }
      />

      <InspectorTabs tabs={TABS} value={tab} onChange={setTab} aria-label="Component settings" />

      <InspectorBody>
        {tab === 'content' && (
          <>
            <InspectorGroupTitle>Instance parameters</InspectorGroupTitle>
            {/* This branch has a Style tab that still owns Typography, so the
                two halves render back-to-back with nothing between them. */}
            {moduleContent.beforeTag}
            {moduleContent.fromTag}

            {slotInstances.map((slot) => {
              const slotName =
                typeof slot.props.slotName === 'string' ? slot.props.slotName : 'content'
              return (
                <div key={slot.id}>
                  <InspectorGroupTitle>{`Slot content · ${slotName}`}</InspectorGroupTitle>
                  <SlotContentList
                    slotInstanceId={slot.id}
                    insertModuleId={SLOT_CHILD_MODULE_ID}
                    insertLabel={`Insert ${slotName} item`}
                  />
                  <InspectorHelper>
                    Slot children remain ordinary page-tree nodes.
                  </InspectorHelper>
                </div>
              )
            })}

            {/* The reference keeps this as a pointer, not a second control set —
                its body is one line of guidance. The real spacing controls live
                on the Layout tab, which owns that slice. */}
            <Section title="Spacing &amp; alignment">
              <InspectorHelper>
                Spacing and alignment for this component are on the Layout tab.
              </InspectorHelper>
            </Section>

            <ResponsiveOverridesDisclosure
              overrideKeys={overrideKeys}
              contextLabel={contextLabel}
            />

            <AdvancedDisclosure
              {...target}
              title="Advanced CSS, classes &amp; attributes"
              sectionIds={COMPONENT_ADVANCED_SECTION_IDS}
              classPickerRef={classPickerRef}
              onFocusClassPicker={onFocusClassPicker}
              showConvertToComponent={showConvertToComponent}
              htmlAttributes={htmlAttributes}
            />
          </>
        )}

        {tab === 'layout' && <StyleSlice {...target} sectionIds={LAYOUT_SECTION_IDS} />}
        {tab === 'style' && <StyleSlice {...target} sectionIds={STYLE_SECTION_IDS} />}
      </InspectorBody>
    </>
  )
}

// ---------------------------------------------------------------------------
// Element branch — the reference's "hero" inspector
// ---------------------------------------------------------------------------

function ElementBranch({
  // Destructured away so `target` is exactly `StyleTargetProps` for the
  // surfaces below; this branch reads the node through `definition`.
  selectedNode: _selectedNode,
  overrideKeys: _overrideKeys,
  moduleContent,
  componentId,
  showConvertToComponent,
  htmlAttributes,
  classPickerRef,
  onFocusClassPicker,
  ...target
}: NodeInspectorBodyProps) {
  const setActiveDocument = useEditorStore((s) => s.setActiveDocument)
  const guided = useGuidedStyleTarget(
    target.nodeId,
    target.activeClassId,
    target.activeClass,
    target.inlineStyles,
  )

  // Each layer edits itself: pick a text and you get the text's parameters,
  // pick an image and you get the image's. A container's parameters are its
  // own — listing everything nested inside it turns the panel into a wall of
  // fields and takes the selection away from the layer the author picked.
  //
  // The one thing a container hides is its picture: a media band carries a CSS
  // `background-image`, so without this its whole inspector is "HTML tag" and
  // the image has no preview anywhere. Promoted here, excluded from the raw
  // Background section below.
  const showBackgroundImage = target.definition?.canHaveChildren === true

  return (
    <>
      {componentId && <VisualBadge />}

      <InspectorBody>
        <InspectorKicker>Instance parameters</InspectorKicker>
        {componentId && (
          <OpenInCanvasAction
            onClick={() => setActiveDocument({ kind: 'visualComponent', vcId: componentId })}
          />
        )}

        {moduleContent.beforeTag}

        {/* Typography sits between the module's content fields and its
            semantic-tag control — "Text, Typography, Tag". `StyleSlice`
            renders the collapsible "Typography" header itself, so wrapping it
            in a Section here would nest Typography inside Typography. */}
        <StyleSlice {...target} sectionIds={ELEMENT_TYPOGRAPHY_SECTION_IDS} />

        {moduleContent.fromTag}

        {showBackgroundImage && <BackgroundImageField target={guided} />}

        <AdvancedDisclosure
          {...target}
          title="Advanced instance styles, classes &amp; attributes"
          sectionIds={ELEMENT_ADVANCED_SECTION_IDS}
          excludeProperties={showBackgroundImage ? BACKGROUND_IMAGE_PROPERTIES : undefined}
          classPickerRef={classPickerRef}
          onFocusClassPicker={onFocusClassPicker}
          showConvertToComponent={showConvertToComponent}
          htmlAttributes={htmlAttributes}
        />

        <Section title="Layout &amp; spacing">
          <StyleSlice {...target} sectionIds={LAYOUT_SECTION_IDS} />
        </Section>

        <InfoNote>Changes update every preview size.</InfoNote>
      </InspectorBody>
    </>
  )
}
