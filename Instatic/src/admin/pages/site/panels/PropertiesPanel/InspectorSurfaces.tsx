/**
 * InspectorSurfaces — the pieces every mode body of the approved Site
 * inspector shares, and the rule that keeps them from overlapping.
 *
 * ── The one-home rule ──────────────────────────────────────────────────────
 * Every CSS section has exactly ONE home — see `./inspectorSections` for the
 * partition itself. Each mode body renders each slice at most once.
 *
 * Where a named guided control edits a property directly (Responsive review's
 * "Content width", "Section height", …), that property is passed as
 * `excludeProperties` so its raw row disappears from whichever section owns it.
 * A setting is never on screen twice.
 *
 * `AdvancedDisclosure` is the reference's collapsed home for the raw tooling —
 * the class picker, whatever style slice the body did not show, the custom
 * property escape hatch and the HTML attribute editor. Nothing was dropped in
 * the re-skin; it moved behind the disclosure the approved screen puts it
 * behind.
 */
import type { RefObject } from 'react'
import type { AnyModuleDefinition } from '@core/module-engine'
import type { CSSPropertyBag, StyleRule } from '@core/page-tree'
import { Section } from '@ui/components/Section'
import { useEditorPermissions } from '@site/editorPermissionsContext'
import { useEditorStore } from '@site/store/store'
import { ClassPicker, type ClassPickerHandle } from './ClassPicker'
import { ConvertToComponentButton } from './ConvertToComponentButton'
import { HtmlAttributesPanel } from './HtmlAttributesPanel'
import { StyleSurface } from './StyleSurface'
import { InspectorHelper, inspectorStyles } from './inspector'

export interface StyleTargetProps {
  nodeId: string | null
  definition: AnyModuleDefinition | null | undefined
  activeClass: StyleRule | null
  activeClassId: string | null
  activeBreakpointId: string | undefined
  inlineStyles: Record<string, unknown> | undefined
}

interface StyleSliceProps extends StyleTargetProps {
  sectionIds: ReadonlyArray<string>
  excludeProperties?: ReadonlyArray<keyof CSSPropertyBag>
  onFocusClassPicker?: () => void
}

/**
 * One slice of the CSS workbench, drawn without the search bar or the category
 * rail — the approved screen navigates guided styling by tab and disclosure,
 * not by scroll anchor.
 */
export function StyleSlice({
  nodeId,
  definition,
  activeClass,
  activeClassId,
  activeBreakpointId,
  inlineStyles,
  sectionIds,
  excludeProperties,
  onFocusClassPicker,
}: StyleSliceProps) {
  return (
    <StyleSurface
      chromeless
      collapsedByDefault
      hideCustomProperties
      sectionIds={sectionIds}
      excludeProperties={excludeProperties}
      // The module's own parameters belong to the Content surface, so the style
      // slices render the CSS sections alone.
      definition={definition}
      moduleContent={null}
      activeClass={activeClass}
      activeClassId={activeClassId}
      activeBreakpointId={activeBreakpointId}
      nodeId={nodeId}
      inlineStyles={inlineStyles}
      onFocusClassPicker={onFocusClassPicker}
    />
  )
}

interface AdvancedDisclosureProps extends StyleTargetProps {
  /** Reference copy — differs per mode; see each body. */
  title: string
  /**
   * Style slices no tab or disclosure in this body has shown. Pass `[]` when
   * the body's tabs already cover all nine sections.
   */
  sectionIds: ReadonlyArray<string>
  excludeProperties?: ReadonlyArray<keyof CSSPropertyBag>
  classPickerRef?: RefObject<ClassPickerHandle | null>
  onFocusClassPicker?: () => void
  showConvertToComponent?: boolean
  htmlAttributes?: unknown
  /**
   * The reference gates this disclosure on the agency/developer role in Live
   * and Focus, but shows it unconditionally in Responsive review. Pass `false`
   * to reproduce the review behaviour.
   */
  permissionGated?: boolean
}

/**
 * `Advanced CSS, classes & attributes` — the reference's collapsed home for
 * everything the guided surfaces don't show.
 */
export function AdvancedDisclosure({
  title,
  sectionIds,
  excludeProperties,
  classPickerRef,
  onFocusClassPicker,
  showConvertToComponent = false,
  htmlAttributes,
  permissionGated = true,
  ...target
}: AdvancedDisclosureProps) {
  const permissions = useEditorPermissions()
  // The canvas "Componentize" command opens a name input that lives inside this
  // disclosure and expects focus. Force the disclosure open for that node so
  // the command doesn't focus a control nobody can see.
  const componentizeRequest = useEditorStore((s) => s.componentizeEditorRequest)
  if (permissionGated && !permissions.canEditStyle && !showConvertToComponent) return null

  const nodeId = target.nodeId
  const forceOpen = nodeId !== null && componentizeRequest?.nodeId === nodeId

  return (
    <Section title={title} forceOpen={forceOpen}>
      {/* Three named groups, one column, one rhythm.
          Classes · Styles · Attributes each came from a surface that used to
          own a whole panel and brought its own spacing and its own idea of
          where a heading goes — which is why they read as a pile when stacked.
          The stack sets the gaps; the labels say where one ends and the next
          begins. */}
      <div className={inspectorStyles.advancedStack}>
        {(permissions.canEditStyle || showConvertToComponent) && nodeId && (
          <section className={inspectorStyles.advancedGroup}>
            <h4 className={inspectorStyles.advancedGroupTitle}>Classes</h4>
            <div className={inspectorStyles.advancedClassPicker}>
              {permissions.canEditStyle ? (
                <ClassPicker
                  ref={classPickerRef}
                  nodeId={nodeId}
                  trailingAction={
                    showConvertToComponent ? <ConvertToComponentButton nodeId={nodeId} /> : undefined
                  }
                />
              ) : (
                <ConvertToComponentButton nodeId={nodeId} />
              )}
            </div>
          </section>
        )}

        {/* Whatever the body's own surfaces did not show, plus the custom
            property escape hatch. Never the full nine — the tabs and the
            "Layout & spacing" disclosure already own their slices.
            This is the RAW workbench, so it keeps its property search; the
            category rail is a scroll-anchor shortcut for a full-height panel
            and has nothing to anchor to inside a disclosure. */}
        <section className={inspectorStyles.advancedGroup}>
          <h4 className={inspectorStyles.advancedGroupTitle}>Styles</h4>
          <StyleSurface
            hideRail
            collapsedByDefault
            sectionIds={sectionIds}
            excludeProperties={excludeProperties}
            definition={target.definition}
            moduleContent={null}
            activeClass={target.activeClass}
            activeClassId={target.activeClassId}
            activeBreakpointId={target.activeBreakpointId}
            nodeId={nodeId}
            inlineStyles={target.inlineStyles}
            onFocusClassPicker={onFocusClassPicker}
          />
        </section>

        {nodeId && (
          <section className={inspectorStyles.advancedGroup}>
            <h4 className={inspectorStyles.advancedGroupTitle}>Attributes</h4>
            <HtmlAttributesPanel
              nodeId={nodeId}
              htmlAttributes={htmlAttributes}
              readOnly={!permissions.canEditStructure}
            />
          </section>
        )}
      </div>
    </Section>
  )
}

/**
 * `Responsive overrides` — the reference's disclosure reporting what the
 * selected layer stores away from the base viewport. It lists the overridden
 * property names rather than re-rendering their controls, which is what keeps
 * it from being a second copy of the sections that own them.
 */
export function ResponsiveOverridesDisclosure({
  overrideKeys,
  contextLabel,
}: {
  overrideKeys: ReadonlySet<string>
  contextLabel: string
}) {
  const keys = [...overrideKeys]

  return (
    <Section title="Responsive overrides">
      {keys.length === 0 ? (
        <InspectorHelper>No overrides for this selected layer.</InspectorHelper>
      ) : (
        <InspectorHelper>
          {`${contextLabel} stores ${keys.length} override${keys.length === 1 ? '' : 's'}: ${keys.join(', ')}.`}
        </InspectorHelper>
      )}
    </Section>
  )
}
