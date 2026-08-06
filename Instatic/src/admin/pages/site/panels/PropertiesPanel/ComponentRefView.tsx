/**
 * ComponentRefView — the parameter rows for a selected
 * `base.visual-component-ref` instance.
 *
 * Architecture source: Contribution #619 §8.5
 *
 * One row per VCParam, in `vc.params` declaration order, each a
 * `<ParamRow mode='override-edit'>` (Default / Overridden pill + Reset).
 *
 * These ARE the "Instance parameters" of the approved Site screen's inspector:
 * the ref module's own schema is plumbing (`componentId`, `propOverrides`), so
 * the VC's declared params are what an author actually edits. The three mode
 * bodies render this in place of `moduleTabContent` whenever the selected node
 * is a component instance. The screen supplies its own identity block (the
 * "Visual component" badge and the "Open component in canvas ↗" action), so
 * this renders parameters only.
 *
 * Achromatic palette (Guideline #376). CSS Modules only (Constraint #402/#403).
 */

import { useEditorStore } from '@site/store/store'
import { WarningDiamondSolidIcon } from 'pixel-art-icons/icons/warning-diamond-solid'
import { ParamRow } from './ParamRow'
import styles from './ComponentRefView.module.css'

interface ComponentRefViewProps {
  /** ID of the selected base.visual-component-ref node */
  nodeId: string
  /** componentId prop from the node — identifies which VC this references */
  componentId: string
  /** propOverrides prop from the node — per-instance value overrides */
  propOverrides: Record<string, unknown>
}

export function ComponentRefView({ nodeId, componentId, propOverrides }: ComponentRefViewProps) {
  const updateNodeProps = useEditorStore((s) => s.updateNodeProps)

  const vc = useEditorStore(
    (s) => s.site?.visualComponents?.find((v) => v.id === componentId) ?? null,
  )

  function handleParamChange(paramId: string, value: unknown) {
    const next = { ...propOverrides, [paramId]: value }
    updateNodeProps(nodeId, { propOverrides: next })
  }

  function handleParamReset(paramId: string) {
    const next = { ...propOverrides }
    delete next[paramId]
    updateNodeProps(nodeId, { propOverrides: next })
  }

  if (!vc) {
    return (
      <div className={styles.unknownVC}>
        <WarningDiamondSolidIcon size={14} color="currentColor" aria-hidden="true" />
        <p>Unknown component: {componentId}</p>
      </div>
    )
  }

  return (
    <>
      {/* ── Param rows ──────────────────────────────────────────────────── */}
      {vc.params.length === 0 ? (
        <div className={styles.noParams}>
          This component has no exposed parameters.
          <br />
          Open it in canvas to add parameters.
        </div>
      ) : (
        <div className={styles.paramsList} role="list" aria-label="Component parameters">
          {vc.params.map((param) => {
            const isOverridden = Object.prototype.hasOwnProperty.call(propOverrides, param.id)
            const effectiveValue = isOverridden ? propOverrides[param.id] : param.defaultValue

            return (
              <div key={param.id} role="listitem" data-testid={`vc-param-row-${param.name}`}>
                <ParamRow
                  mode="override-edit"
                  paramName={param.name}
                  paramType={param.type}
                  paramId={param.id}
                  value={effectiveValue}
                  isOverridden={isOverridden}
                  enumOptions={param.enumOptions}
                  onValueChange={(val) => handleParamChange(param.id, val)}
                  onReset={() => handleParamReset(param.id)}
                />
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
