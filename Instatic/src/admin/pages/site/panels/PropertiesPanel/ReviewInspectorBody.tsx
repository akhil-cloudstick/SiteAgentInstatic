/**
 * ReviewInspectorBody — the approved Site screen's Responsive-review inspector.
 *
 * The reference's `ResponsiveInspector` (`screens/site/src/App.jsx`), verbatim
 * in order:
 *
 *   <node name>                       [Visual component]
 *   [ Layout | Style | Visibility ]
 *   Guided CSS controls
 *     Content width      Full / Contained
 *     Text alignment     ≡L ≡C ≡R
 *     Image position     4 crops
 *     Section height     Tall (700 px) / Medium (560 px) / Content height
 *     Editing context    Base / Tablet / Mobile
 *   ⓘ / ✓ override note
 *   ▸ Spacing  ▸ Responsive overrides  ▸ Advanced CSS & classes
 *   [ Review mobile ] [ Done ]
 *
 * The guided controls write real declarations (see `guidedCssControls`), the
 * editing context is the real breakpoint switcher, and the note reads the
 * selected node's real overrides. "Advanced CSS & classes" is NOT permission
 * gated here — the reference shows it in review for every role, unlike the
 * Live and Focus bodies.
 */
import { useState } from 'react'
import { useEditorStore } from '@site/store/store'
import { Select } from '@ui/components/Select'
import { Section } from '@ui/components/Section'
import { Button } from '@ui/components/Button'
import { ControlRow } from '@ui/components/ControlRow'
import {
  AdvancedDisclosure,
  ResponsiveOverridesDisclosure,
  StyleSlice,
  type StyleTargetProps,
} from './InspectorSurfaces'
import {
  LAYOUT_SECTION_IDS,
  STYLE_SECTION_IDS,
  VISIBILITY_SECTION_IDS,
} from './inspectorSections'
import {
  GUIDED_LAYOUT_CONTROLS,
  GUIDED_PROPERTIES,
  activeGuidedOption,
  type GuidedCssControl,
} from './guidedCssControls'
import { useGuidedStyleTarget } from './useGuidedStyleTarget'
import {
  InspectorBody,
  InspectorGroupTitle,
  InspectorTabs,
  OverrideNote,
  ResponsiveTitle,
  SegmentField,
  inspectorStyles,
  type InspectorTab,
} from './inspector'

type ReviewTab = 'layout' | 'style' | 'visibility'

const TABS: ReadonlyArray<InspectorTab<ReviewTab>> = [
  { id: 'layout', label: 'Layout' },
  { id: 'style', label: 'Style' },
  { id: 'visibility', label: 'Visibility' },
]

/** The reference prints the desktop context as "Base", not the viewport name. */
const BASE_CONTEXT_LABEL = 'Base'

interface ReviewInspectorBodyProps extends StyleTargetProps {
  nodeName: string
  /** Set when the selected node is a `base.visual-component-ref`. */
  isComponentInstance: boolean
  /** Prop keys with a breakpoint override at the active context. */
  overrideKeys: ReadonlySet<string>
  htmlAttributes: unknown
}

export function ReviewInspectorBody({
  nodeName,
  isComponentInstance,
  overrideKeys,
  htmlAttributes,
  ...target
}: ReviewInspectorBodyProps) {
  const [tab, setTab] = useState<ReviewTab>('layout')
  const breakpoints = useEditorStore((s) => s.site?.breakpoints)
  const activeBreakpointId = useEditorStore((s) => s.activeBreakpointId)
  const setActiveBreakpoint = useEditorStore((s) => s.setActiveBreakpoint)
  const setCanvasView = useEditorStore((s) => s.setCanvasView)

  const guided = useGuidedStyleTarget(
    target.nodeId,
    target.activeClassId,
    target.activeClass,
    target.inlineStyles,
  )

  const contextOptions = (breakpoints ?? []).map((breakpoint, index) => ({
    value: breakpoint.id,
    // The widest viewport IS the base layer — everything else stores overrides.
    label: index === 0 ? BASE_CONTEXT_LABEL : breakpoint.label,
  }))
  const activeLabel =
    breakpoints?.find((breakpoint) => breakpoint.id === activeBreakpointId)?.label ?? 'This viewport'
  const isBaseContext = breakpoints?.[0]?.id === activeBreakpointId
  const hasOverrides = overrideKeys.size > 0

  // The reference promotes Mobile to the active review context; resolve the
  // narrowest configured viewport rather than hardcoding an id.
  const narrowestBreakpointId = breakpoints?.at(-1)?.id ?? null

  return (
    <>
      <ResponsiveTitle name={nodeName} pill={isComponentInstance ? 'Visual component' : undefined} />

      <InspectorTabs tabs={TABS} value={tab} onChange={setTab} aria-label="Responsive settings" />

      <InspectorBody>
        {tab === 'layout' && (
          <>
            <InspectorGroupTitle>Guided CSS controls</InspectorGroupTitle>

            {GUIDED_LAYOUT_CONTROLS.map((control) => (
              <GuidedControlField
                key={control.id}
                control={control}
                value={activeGuidedOption(control, guided.styles)}
                disabled={!guided.editable}
                onChange={(optionId) =>
                  guided.setProperty(control.property, control.values[optionId])
                }
              />
            ))}

            <SegmentField
              propKey="editing-context"
              label="Editing context"
              value={activeBreakpointId}
              options={contextOptions}
              onChange={setActiveBreakpoint}
            />

            <OverrideNote active={hasOverrides}>
              {hasOverrides
                ? `${activeLabel} overrides are active in context.`
                : isBaseContext
                  ? 'No Tablet or Mobile overrides on this selected layer.'
                  : `No ${activeLabel} overrides on this selected layer.`}
            </OverrideNote>

            {/* The reference's "Spacing" bar. Its category accordions live
                INSIDE it, so a fully-collapsed panel shows the same three bars
                the approved screen does — Spacing, Responsive overrides,
                Advanced CSS & classes — rather than a mixed stack. Guided
                properties are excluded: "Content width" above already edits
                `maxWidth`. */}
            <Section title="Spacing">
              <StyleSlice
                {...target}
                sectionIds={LAYOUT_SECTION_IDS}
                excludeProperties={GUIDED_PROPERTIES}
              />
            </Section>

            <ResponsiveOverridesDisclosure
              overrideKeys={overrideKeys}
              contextLabel={activeLabel}
            />

            <AdvancedDisclosure
              {...target}
              permissionGated={false}
              title="Advanced CSS &amp; classes"
              sectionIds={[]}
              htmlAttributes={htmlAttributes}
            />

            <div className={inspectorStyles.reviewActions}>
              <Button
                variant="secondary"
                className={inspectorStyles.button}
                disabled={narrowestBreakpointId === null}
                onClick={() => {
                  if (narrowestBreakpointId) setActiveBreakpoint(narrowestBreakpointId)
                }}
              >
                Review mobile
              </Button>
              <Button
                variant="secondary"
                className={`${inspectorStyles.button} ${inspectorStyles.success}`}
                onClick={() => setCanvasView('live')}
              >
                Done
              </Button>
            </div>
          </>
        )}

        {tab === 'style' && (
          <StyleSlice
            {...target}
            sectionIds={STYLE_SECTION_IDS}
            excludeProperties={GUIDED_PROPERTIES}
          />
        )}
        {tab === 'visibility' && <StyleSlice {...target} sectionIds={VISIBILITY_SECTION_IDS} />}
      </InspectorBody>
    </>
  )
}

/**
 * One guided control. The reference draws Section height as a native select and
 * the other three as segmented pickers.
 */
function GuidedControlField({
  control,
  value,
  disabled,
  onChange,
}: {
  control: GuidedCssControl
  value: string | undefined
  disabled: boolean
  onChange: (optionId: string) => void
}) {
  if (control.asSelect) {
    return (
      <ControlRow propKey={control.id} label={control.label} layout="stacked">
        <Select
          id={`ctrl-${control.id}`}
          value={value ?? ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {control.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label ?? option.value}
            </option>
          ))}
        </Select>
      </ControlRow>
    )
  }

  return (
    <SegmentField
      propKey={control.id}
      label={control.label}
      value={value}
      options={control.options}
      onChange={onChange}
    />
  )
}
