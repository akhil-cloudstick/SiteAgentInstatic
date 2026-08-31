/**
 * `doctor` — prove the conversion environment works before anything depends on it.
 *
 * This exists because both of Instatic's conversion entry points fail silently
 * or confusingly from outside the Instatic package:
 *
 *   - a missing `@modules/base` alias makes `importHtml` throw per node;
 *   - a missing `CSSStyleSheet` makes `cssToStyleRules` return `{ rules: [] }`
 *     plus a warning, which reads as success to a caller counting only rules.
 *
 * So the gate is four assertions, not one: nodes present, the module ids we
 * actually depend on present, style rules present, and zero unexpected
 * warnings. The warning check is the one that catches a partial failure.
 */

import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { installDomEnvironment } from './shim'
// Static, never a dynamic `await import()`. On this UNC checkout a dynamic
// import of the same specifier resolves to a SEPARATE module instance with its
// own empty module registry, and `importHtml` then throws "base.container is
// not registered" even though the registry Connector can see holds all 25.
import { importHtml } from '@core/htmlImport'
import { cssToStyleRules } from '@core/siteImport'

/** Module ids the emitter depends on. If the registry is half-loaded, these go missing first. */
const REQUIRED_MODULE_IDS = ['base.body', 'base.outlet', 'base.loop'] as const

/**
 * Warnings the fixture is expected to raise. The fixture references
 * `./doctor.png`, which does not exist on disk — that is deliberate, it
 * exercises the asset-reference path — so an asset warning is not a failure.
 * Everything else is.
 */
const EXPECTED_WARNING_KINDS = new Set(['asset-missing', 'asset-unresolved'])

export interface DoctorReport {
  nodeCount: number
  rootIdCount: number
  styleRuleCount: number
  moduleIds: string[]
  missingModuleIds: string[]
  unexpectedWarnings: { kind: string; message: string }[]
  ok: boolean
}

export class DoctorFailedError extends Error {
  override readonly name = 'DoctorFailedError'
  readonly report: DoctorReport
  constructor(message: string, report: DoctorReport) {
    super(message)
    this.report = report
  }
}

function warningKind(warning: unknown): string {
  if (warning && typeof warning === 'object' && 'kind' in warning) {
    return String((warning as { kind: unknown }).kind)
  }
  return 'unknown'
}

function warningMessage(warning: unknown): string {
  if (warning && typeof warning === 'object' && 'message' in warning) {
    return String((warning as { message: unknown }).message)
  }
  return JSON.stringify(warning)
}

export async function runDoctor(fixtureDir: string): Promise<DoctorReport> {
  // Order matters: the DOM must exist before the converters are imported,
  // because importing @modules/base is itself part of installing it.
  installDomEnvironment()

  const htmlPath = resolve(fixtureDir, 'index.html')
  const html = await readFile(htmlPath, 'utf8')

  const result = importHtml(html)

  // Linked stylesheet + the <style> block the importer already harvested.
  const linkedCss = await readFile(resolve(dirname(htmlPath), 'styles.css'), 'utf8')
  const css = `${linkedCss}\n${result.styleCss}`
  const styles = cssToStyleRules(css)

  const moduleIds = [...new Set(Object.values(result.nodes).map((n) => n.moduleId))].sort()
  // base.body is synthesized by us, not by the importer — check only what the
  // importer is responsible for producing.
  const missingModuleIds = REQUIRED_MODULE_IDS.filter(
    (id) => id !== 'base.body' && !moduleIds.includes(id),
  )

  const allWarnings = [...result.warnings, ...styles.warnings]
  const unexpectedWarnings = allWarnings
    .filter((w) => !EXPECTED_WARNING_KINDS.has(warningKind(w)))
    .map((w) => ({ kind: warningKind(w), message: warningMessage(w) }))

  const nodeCount = Object.keys(result.nodes).length
  const report: DoctorReport = {
    nodeCount,
    rootIdCount: result.rootIds.length,
    styleRuleCount: styles.rules.length,
    moduleIds,
    missingModuleIds,
    unexpectedWarnings,
    ok:
      nodeCount > 0 &&
      styles.rules.length > 0 &&
      missingModuleIds.length === 0 &&
      unexpectedWarnings.length === 0,
  }

  if (!report.ok) {
    const reasons: string[] = []
    if (nodeCount === 0) reasons.push('zero nodes produced — the module registry is probably empty')
    if (styles.rules.length === 0)
      reasons.push('zero style rules — CSSStyleSheet is probably missing, and this fails silently')
    if (missingModuleIds.length > 0)
      reasons.push(`missing module ids: ${missingModuleIds.join(', ')}`)
    if (unexpectedWarnings.length > 0)
      reasons.push(
        `unexpected warnings: ${unexpectedWarnings.map((w) => `${w.kind} (${w.message})`).join('; ')}`,
      )
    throw new DoctorFailedError(reasons.join(' · '), report)
  }

  return report
}
