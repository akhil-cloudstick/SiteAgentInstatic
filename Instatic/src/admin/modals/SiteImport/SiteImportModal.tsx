/**
 * SiteImportModal — the Super Import wizard.
 *
 * A canonical import dialog for both static-site imports and CMS-native site
 * bundles. Static-site inputs (folder, .zip, loose files) import into the
 * visual editor in one undo-able operation. CMS-exported ZIP bundles use the
 * server-side transfer endpoints for full import/export parity.
 *
 * Steps:
 *   drop      → user drops/picks files
 *   analyze    → review static plan or CMS bundle categories
 *   conflicts  → resolve slug / class-name conflicts (skipped if none)
 *   run        → upload assets + commit static plan to store
 *
 * Mount pattern: the authenticated admin shell renders
 * `{siteImportOpen && <SiteImportModal />}` so the component is always freshly
 * mounted on open — no reset logic needed.
 *
 * Undo guarantee: `mutateAllPagesAndSite` wraps the full commit in one Immer
 * history snapshot, so Cmd+Z reverts the entire import in one press.
 */

// Static-site analysis maps HTML onto base modules (`importHtml` resolves
// every element through the module registry). The modal is a global surface —
// openable from Spotlight or any workspace — so it must register the base
// modules itself rather than rely on the site editor's chunk having loaded.
// This rides the modal's own lazy chunk; it adds nothing to the shell bundle.
import '@modules/base'
import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { Dialog } from '@ui/components/Dialog'
import { pushToast } from '@ui/components/Toast'
import {
  ingestInput,
  buildImportPlan,
  commitImportPlan,
  forceOverwriteResolutions,
  type FileMap,
  type ImportPlan,
  type ImportResult,
  type ConflictResolution,
  type StylesheetImportMode,
} from '@core/siteImport'
import { useAdminUi } from '@admin/state/adminUi'
import { useEditorStore } from '@site/store/store'
import { DropStep } from './steps/DropStep'
import { AnalyzeStep } from './steps/AnalyzeStep'
import { CmsBundleAnalyzeStep } from './steps/CmsBundleAnalyzeStep'
import { CmsBundleConflictsStep } from './steps/CmsBundleConflictsStep'
import { ImportStep } from './steps/ImportStep'
import { SiteImportFooter } from './SiteImportFooter'
import { makeInitialRunProgress, type RunProgress } from './shared/importProgress'
import { createSiteImportAdapter } from './shared/createSiteImportAdapter'
import { describeCmsBundleLoadError, useCmsBundleImport } from './shared/useCmsBundleImport'
import {
  selectedCmsConflicts,
  selectedCmsMediaCount,
  selectedCmsMediaFolderCount,
  selectedCmsRedirectCount,
  selectedCmsRowCount,
  withCmsConflictResolutions,
} from './shared/cmsBundleFlow'
import {
  type ImportSelection,
  tokenConflictKey,
  crossSheetConflictKey,
  makeDefaultSelection,
  filterPlanBySelection,
  buildResolvedPlan,
  describeIngestError,
  ensureCurrentSiteForStaticImport,
  blankImportedDesign,
  saveImportedDraftSite,
} from './shared/importPlanning'
import styles from './SiteImportModal.module.css'
import { getErrorMessage } from '@core/utils/errorMessage'
import { BRAND_NAME } from '@core/brand'
import type {
  BundleImportSelection,
  ImportResult as CmsImportResult,
} from '@core/data/bundleSchema'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Step = 'drop' | 'analyze' | 'conflicts' | 'run'

export type { ImportSelection }

interface SiteImportModalProps {
  onCmsBundleImportComplete?: () => void
}

/** Browser-safe base64 -> bytes (no Buffer polyfill assumed). */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ---------------------------------------------------------------------------
// Modal component
// ---------------------------------------------------------------------------

export function SiteImportModal({ onCmsBundleImportComplete }: SiteImportModalProps = {}) {
  const closeAdminSiteImportModal = useAdminUi((s) => s.closeSiteImport)
  function closeModal() {
    closeAdminSiteImportModal()
  }

  const {
    cmsBundleState,
    cmsCanImport,
    cmsImportButtonLabel,
    clearCmsBundle,
    importCmsBundle,
    loadCmsBundleArchiveFile,
    loadCmsBundleFile,
    setCmsSelection,
    setCmsStrategy,
  } = useCmsBundleImport({
    onImportComplete: onCmsBundleImportComplete,
  })

  // ── Wizard state ──────────────────────────────────────────────────────────

  const [step, setStep] = useState<Step>('drop')
  const [fileMap, setFileMap] = useState<FileMap | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [selection, setSelection] = useState<ImportSelection | null>(null)
  const [cmsRowResolutions, setCmsRowResolutions] = useState<Map<string, ConflictResolution>>(new Map())
  const [stylesheetModes, setStylesheetModes] = useState<Record<string, StylesheetImportMode>>({})
  const [pageSlugOverrides, setPageSlugOverrides] = useState<Map<string, string>>(new Map())
  const [runProgress, setRunProgress] = useState<RunProgress>(makeInitialRunProgress)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [cmsResult, setCmsResult] = useState<CmsImportResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

  const siteName = useEditorStore((s) => s.site?.name) ?? 'this site'

  // ── Ingest + plan-build (triggered from DropStep callbacks) ───────────────

  async function handleFilesReady(files: File[]) {
    setBusy(true)
    setErrorMsg(null)
    try {
      if (files.length === 1 && await loadCmsBundleFile(files[0])) {
        setFileMap(null)
        setPlan(null)
        setSelection(null)
        setCmsRowResolutions(new Map())
        setCmsResult(null)
        setBusy(false)
        setStep('analyze')
        return
      }

      const map = await ingestInput(files)
      await finalizePlan(map)
    } catch (err) {
      console.error('[SiteImportModal] ingest failed:', err)
      const singleJson = files.length === 1 && files[0].name.toLowerCase().endsWith('.json')
      setErrorMsg(singleJson ? describeCmsBundleLoadError(err) : describeIngestError(err))
      setBusy(false)
    }
  }

  async function handleZipReady(file: File) {
    setBusy(true)
    setErrorMsg(null)
    try {
      if (await loadCmsBundleArchiveFile(file)) {
        setFileMap(null)
        setPlan(null)
        setSelection(null)
        setCmsRowResolutions(new Map())
        setCmsResult(null)
        setBusy(false)
        setStep('analyze')
        return
      }

      const zipBytes = new Uint8Array(await file.arrayBuffer())
      const map = await ingestInput({ zipBytes })
      await finalizePlan(map)
    } catch (err) {
      console.error('[SiteImportModal] ingest failed:', err)
      setErrorMsg(err instanceof Error && err.name === 'SiteBundleParseError'
        ? describeCmsBundleLoadError(err)
        : describeIngestError(err))
      setBusy(false)
    }
  }

  // Merge additional dropped/picked files into the existing FileMap and rebuild
  // the plan. The Review step accepts more files at any time (drag-over overlay
  // + "Add more files" button), so the import isn't one-shot.
  async function handleAddFiles(files: File[]) {
    if (!fileMap) {
      await handleFilesReady(files)
      return
    }
    setBusy(true)
    try {
      const added = await ingestInput(files)
      const merged: FileMap = {
        ...fileMap,
        files: { ...fileMap.files, ...added.files },
      }
      await finalizePlan(merged)
    } catch (err) {
      console.error('[SiteImportModal] add files failed:', err)
      setBusy(false)
      pushToast({ kind: 'error', title: 'Could not add files', body: describeIngestError(err) })
    }
  }

  async function finalizePlan(map: FileMap, modes: Record<string, StylesheetImportMode> = stylesheetModes) {
    const currentSite = await ensureCurrentSiteForStaticImport()
    const importPlan = buildImportPlan({
      fileMap: map,
      currentSite,
      options: { mediaTolerance: 10, stylesheetModes: modes },
    })
    setFileMap(map)
    setPlan(importPlan)
    setSelection(makeDefaultSelection(importPlan))
    // Conflict resolutions are computed fresh (forced to Overwrite) in
    // handleAnalyzeNext right before the run — no need to seed per-conflict
    // state here since the conflicts step never renders for this track.
    setPageSlugOverrides(new Map())
    setBusy(false)
    setStep('analyze')
  }

  // ── Staged Share-to-CMS hand-off ────────────────────────────────────────────
  // A FileMap staged by an external caller (see useStagedSiteImportHandoff)
  // waiting to be picked up. Skips the drop step entirely — runs the exact
  // same finalizePlan a manual drag-drop uses, landing on Review import. The
  // modal is always freshly mounted on open (see the header comment), so a
  // one-shot ref guard (mirroring useSiteEditorUrlSync's pattern) is enough.
  const pendingFileMap = useAdminUi((s) => s.pendingSiteImportFileMap)
  const setPendingSiteImportFileMap = useAdminUi((s) => s.setPendingSiteImportFileMap)
  const consumedPendingImportRef = useRef(false)
  useEffect(() => {
    if (consumedPendingImportRef.current) return
    if (!pendingFileMap) return
    consumedPendingImportRef.current = true
    setPendingSiteImportFileMap(null)
    const files: FileMap['files'] = {}
    for (const [path, entry] of Object.entries(pendingFileMap.files)) {
      files[path] = { bytes: base64ToBytes(entry.base64), mimeType: entry.mimeType }
    }
    setBusy(true)
    setErrorMsg(null)
    void (async () => {
      try {
        // Share to CMS = REPLACE the design: blank the current site's design
        // BEFORE planning so a re-share is an exact match to the OD project (no
        // accumulated stale fonts/rules) and the import sees no conflicts. A
        // manual drag-drop import does NOT do this — it merges. Done here (not
        // inside the commit) so the class-name index is rebuilt from the empty
        // registry. loadSite only touches the store; the DB is untouched until
        // the import actually commits + saves, so a failed import loses nothing.
        const current = await ensureCurrentSiteForStaticImport()
        useEditorStore.getState().loadSite(blankImportedDesign(current))
        await finalizePlan({ files })
      } catch (err) {
        console.error('[SiteImportModal] staged import failed:', err)
        setErrorMsg(describeIngestError(err))
        setBusy(false)
      }
    })()
  }, [pendingFileMap, setPendingSiteImportFileMap])

  // Re-analyse with a changed per-stylesheet import mode. The plan rebuild is
  // synchronous and pure, so flipping a sheet between "editable rules" and
  // "keep as stylesheet" instantly refreshes rules, conflicts, and selection.
  function handleStylesheetModeChange(path: string, mode: StylesheetImportMode) {
    if (!fileMap) return
    const modes = { ...stylesheetModes, [path]: mode }
    setStylesheetModes(modes)
    setBusy(true)
    void finalizePlan(fileMap, modes)
  }

  // ── Step navigation ───────────────────────────────────────────────────────

  function handleAnalyzeNext() {
    if (!plan || !selection) return

    // Apply user slug overrides to the plan's pages
    const planWithSlugs: ImportPlan = {
      ...plan,
      pages: plan.pages.map((p) => ({
        ...p,
        slug: pageSlugOverrides.get(p.source) ?? p.slug,
      })),
    }

    const filtered = filterPlanBySelection(planWithSlugs, selection)

    // Conflicts always resolve as Overwrite, internally — a tenant never sees
    // Rename/Skip/Overwrite/Custom, so the `conflicts` step is unreachable for
    // this (static-file) import track. The CMS-bundle track's own conflicts
    // screen (`handleCmsAnalyzeNext` / `CmsBundleConflictsStep`) is a separate
    // import mode and is unaffected.
    const forced = forceOverwriteResolutions(filtered.conflicts)
    const pageResMap = new Map(forced.pages.map((c) => [c.source, c.defaultResolution]))
    const ruleResMap = new Map(forced.rules.map((c) => [c.desiredName, c.defaultResolution]))
    const tokenResMap = new Map(forced.tokens.map((c) => [tokenConflictKey(c), c.defaultResolution]))
    const crossSheetResMap = new Map(forced.crossSheetClasses.map((c) => [crossSheetConflictKey(c), c.defaultResolution]))

    setPlan(filtered)
    void kickOffRun(filtered, pageResMap, ruleResMap, tokenResMap, crossSheetResMap)
  }

  function handleCmsAnalyzeNext() {
    if (!cmsBundleState?.preview) return
    const conflicts = cmsBundleState.strategy === 'replace'
      ? []
      : selectedCmsConflicts(
          cmsBundleState.selection,
          cmsBundleState.bundle,
          cmsBundleState.preview.rowConflicts ?? [],
        )

    if (conflicts.length > 0) {
      setStep('conflicts')
      return
    }

    void kickOffCmsRun(cmsBundleState.selection)
  }

  // Only the CMS-bundle track still reaches the `conflicts` step — the
  // static-file track's own conflicts always resolve automatically in
  // `handleAnalyzeNext` (forceOverwriteResolutions) and never render it.
  function handleConflictsImport() {
    if (!cmsBundleState?.preview) return
    const finalSelection = withCmsConflictResolutions(
      cmsBundleState.selection,
      cmsBundleState.bundle,
      cmsBundleState.preview.rowConflicts ?? [],
      cmsRowResolutions,
    )
    setCmsSelection(finalSelection)
    void kickOffCmsRun(finalSelection)
  }

  function handleCmsChooseDifferentFile() {
    clearCmsBundle()
    setCmsRowResolutions(new Map())
    setCmsResult(null)
    setErrorMsg(null)
    setBusy(false)
    setStep('drop')
  }

  function handleBack() {
    if (step === 'conflicts') setStep('analyze')
    else if (step === 'analyze' && cmsBundleState) handleCmsChooseDifferentFile()
    else if (step === 'analyze') setStep('drop')
  }

  // ── Run ───────────────────────────────────────────────────────────────────

  async function kickOffRun(
    planToRun: ImportPlan,
    pageResMap: Map<string, ConflictResolution>,
    ruleResMap: Map<string, ConflictResolution>,
    tokenResMap: Map<string, ConflictResolution>,
    crossSheetResMap: Map<string, ConflictResolution>,
  ) {
    const resolvedPlan = buildResolvedPlan(planToRun, pageResMap, ruleResMap, tokenResMap, crossSheetResMap)

    // Totals come from the plan being committed. Media is the only genuinely
    // incremental phase (per-asset uploads); everything else lands in one atomic
    // commit, so those rows flip pending → done together once it completes.
    const initial = makeInitialRunProgress()
    initial.phase = 'uploading'
    initial.categories = {
      pages: { done: 0, total: resolvedPlan.pages.length },
      // Kept stylesheet files count alongside converted rules — one "styles" row.
      styles: { done: 0, total: resolvedPlan.styleRules.length + resolvedPlan.stylesheets.length },
      media: { done: 0, total: resolvedPlan.assets.length },
      colors: { done: 0, total: resolvedPlan.colors.length },
      fonts: {
        done: 0,
        total: resolvedPlan.fonts.length + resolvedPlan.googleFonts.length + resolvedPlan.fontTokens.length,
      },
      scripts: { done: 0, total: resolvedPlan.scripts.length },
      site: { done: 0, total: 0 },
      rows: { done: 0, total: 0 },
      mediaFolders: { done: 0, total: 0 },
      redirects: { done: 0, total: 0 },
    }
    setLogOpen(false)
    setResult(null)
    setRunProgress(initial)
    setStep('run')

    const adapter = createSiteImportAdapter({
      sessionId: nanoid(),
      onUploadStart: ({ path }) => {
        setRunProgress((prev) => ({ ...prev, phase: 'uploading', currentItem: path }))
      },
      onUploadComplete: ({ path }) => {
        setRunProgress((prev) => ({
          ...prev,
          currentItem: path,
          categories: {
            ...prev.categories,
            media: { ...prev.categories.media, done: prev.categories.media.done + 1 },
          },
        }))
      },
      onCommitStart: () => {
        setRunProgress((prev) => ({
          ...prev,
          phase: 'applying',
          currentItem: 'Applying changes to your site…',
        }))
      },
      onCommitComplete: () => {
        setRunProgress((prev) => ({ ...prev, phase: 'applying' }))
      },
    })

    try {
      const importResult = await commitImportPlan(resolvedPlan, adapter)
      setRunProgress((prev) => ({
        ...prev,
        phase: 'applying',
        currentItem: 'Saving imported draft…',
      }))
      await saveImportedDraftSite()
      // Reconcile every category to what was actually committed — skipped pages
      // or rules (conflict resolutions) leave fewer than the planned totals.
      setRunProgress((prev) => ({
        ...prev,
        phase: 'done',
        currentItem: '',
        categories: {
          pages: { done: importResult.pages.length, total: importResult.pages.length },
          styles: {
            done: importResult.styleRules.length + importResult.stylesheets.length,
            total: importResult.styleRules.length + importResult.stylesheets.length,
          },
          media: { done: importResult.assets.length, total: importResult.assets.length },
          colors: { done: importResult.colors.length, total: importResult.colors.length },
          fonts: {
            done: importResult.fonts.length + importResult.fontTokens.length,
            total: importResult.fonts.length + importResult.fontTokens.length,
          },
          scripts: { done: importResult.scripts.length, total: importResult.scripts.length },
          site: { done: 0, total: 0 },
          rows: { done: 0, total: 0 },
          mediaFolders: { done: 0, total: 0 },
          redirects: { done: 0, total: 0 },
        },
      }))
      setResult(importResult)
      pushToast({
        kind: 'success',
        title: 'Site imported',
        body: `${importResult.pages.length} pages · ${importResult.styleRules.length} style rules · ${importResult.assets.length} assets`,
        location: 'site-workspace',
      })
    } catch (err) {
      console.error('[SiteImportModal] commit failed:', err)
      const msg = getErrorMessage(err, 'Unknown import error')
      setRunProgress((prev) => ({ ...prev, phase: 'failed', currentItem: '', errorMessage: msg }))
      pushToast({ kind: 'error', title: 'Import failed', body: msg })
    }
  }

  async function kickOffCmsRun(selectionToImport: BundleImportSelection) {
    if (!cmsBundleState) return

    const rowCount = selectedCmsRowCount(selectionToImport, cmsBundleState.bundle)
    const mediaCount = selectedCmsMediaCount(selectionToImport, cmsBundleState.bundle.media?.length ?? 0)
    const mediaFolderCount = selectedCmsMediaFolderCount(selectionToImport, cmsBundleState.bundle)
    const redirectCount = selectedCmsRedirectCount(selectionToImport, cmsBundleState.bundle)
    const siteCount = selectionToImport.includeSite && cmsBundleState.bundle.site ? 1 : 0

    setLogOpen(false)
    setResult(null)
    setCmsResult(null)
    setRunProgress({
      phase: 'applying',
      currentItem: 'Importing site bundle…',
      categories: {
        pages: { done: 0, total: 0 },
        styles: { done: 0, total: 0 },
        colors: { done: 0, total: 0 },
        fonts: { done: 0, total: 0 },
        scripts: { done: 0, total: 0 },
        site: { done: 0, total: siteCount },
        rows: { done: 0, total: rowCount },
        media: { done: 0, total: mediaCount },
        mediaFolders: { done: 0, total: mediaFolderCount },
        redirects: { done: 0, total: redirectCount },
      },
    })
    setStep('run')

    try {
      const importResult = await importCmsBundle(selectionToImport)
      if (!importResult) {
        setStep('analyze')
        return
      }
      setRunProgress({
        phase: 'done',
        currentItem: '',
        categories: {
          pages: { done: 0, total: 0 },
          styles: { done: 0, total: 0 },
          colors: { done: 0, total: 0 },
          fonts: { done: 0, total: 0 },
          scripts: { done: 0, total: 0 },
          site: { done: siteCount, total: siteCount },
          rows: { done: importResult.rowsInserted + importResult.rowsReplaced + importResult.rowsSkipped, total: rowCount },
          media: { done: importResult.mediaImported, total: mediaCount },
          mediaFolders: { done: importResult.mediaFoldersImported, total: mediaFolderCount },
          redirects: { done: importResult.redirectsImported, total: redirectCount },
        },
      })
      setCmsResult(importResult)
    } catch (err) {
      const msg = getErrorMessage(err, 'Unknown import error')
      setRunProgress((prev) => ({ ...prev, phase: 'failed', currentItem: '', errorMessage: msg }))
    }
  }

  // ── Close ─────────────────────────────────────────────────────────────────

  function handleClose() {
    if (runProgress.phase === 'applying') return // uncancellable during commit
    if (cmsBundleState?.importing) return
    closeModal()
  }

  function handleRunCancel() {
    // During upload phase we can close (orphaned assets are harmless per spec).
    closeModal()
  }

  // Open the freshly-imported site: jump to the first imported page in the
  // canvas, then close the wizard. Falls back to a plain close when nothing
  // imported (e.g. a styles-only import).
  function handleOpenSite() {
    const firstPage = result?.pages[0]
    if (firstPage) useEditorStore.getState().openPageInCanvas(firstPage.id)
    closeModal()
  }

  // ── Step titles ───────────────────────────────────────────────────────────

  const titleByStep: Record<Step, string> = {
    drop: 'Import site',
    analyze: 'Review import',
    conflicts: 'Resolve conflicts',
    // The Import step title tracks its phase: "Importing" while running,
    // "Import complete" once committed.
    run: runProgress.phase === 'done' ? 'Import complete' : 'Importing',
  }
  const isCmsReplace = step === 'analyze' && cmsBundleState?.strategy === 'replace'
  const isCmsImporting = step === 'analyze' && cmsBundleState?.importing === true

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog
      open={true}
      onClose={handleClose}
      title={titleByStep[step]}
      eyebrow={BRAND_NAME}
      size={step === 'analyze' ? '2xl' : 'xl'}
      tone={isCmsReplace ? 'danger' : 'neutral'}
      footer={step === 'drop' ? undefined : (
        <SiteImportFooter
          step={step}
          cmsBundleState={cmsBundleState}
          selection={selection}
          runProgress={runProgress}
          cmsResult={cmsResult}
          logOpen={logOpen}
          siteName={siteName}
          cmsCanImport={cmsCanImport}
          cmsImportButtonLabel={cmsImportButtonLabel}
          onBack={handleBack}
          onClose={handleClose}
          onAnalyzeNext={handleAnalyzeNext}
          onCmsAnalyzeNext={handleCmsAnalyzeNext}
          onConflictsImport={handleConflictsImport}
          onRunCancel={handleRunCancel}
          onToggleLog={() => setLogOpen((o) => !o)}
          onOpenSite={handleOpenSite}
        />
      )}
      bodyClassName={step === 'analyze' ? styles.analyzeBody : step === 'run' ? styles.importBody : undefined}
      closeOnEscape={runProgress.phase !== 'applying' && !isCmsImporting}
      closeOnBackdrop={runProgress.phase !== 'applying' && !isCmsImporting}
    >
      <div className={styles.body}>
        {step === 'drop' && (
          <DropStep
            busy={busy}
            errorMessage={errorMsg}
            onFilesReady={(files) => { void handleFilesReady(files) }}
            onZipReady={(file) => { void handleZipReady(file) }}
          />
        )}

        {step === 'analyze' && cmsBundleState && (
          <CmsBundleAnalyzeStep
            state={cmsBundleState}
            siteName={siteName}
            onSelectionChange={setCmsSelection}
            onStrategyChange={setCmsStrategy}
            onChooseDifferentFile={handleCmsChooseDifferentFile}
          />
        )}

        {step === 'analyze' && !cmsBundleState && plan && fileMap && selection && (
          <AnalyzeStep
            plan={plan}
            siteName={siteName}
            selection={selection}
            pageSlugOverrides={pageSlugOverrides}
            busy={busy}
            onSelectionChange={setSelection}
            onStylesheetModeChange={handleStylesheetModeChange}
            onAddFiles={(files) => { void handleAddFiles(files) }}
            onSlugOverride={(source, slug) => {
              setPageSlugOverrides((prev) => {
                const next = new Map(prev)
                next.set(source, slug)
                return next
              })
            }}
          />
        )}

        {step === 'conflicts' && cmsBundleState?.preview && (
          <CmsBundleConflictsStep
            conflicts={selectedCmsConflicts(
              cmsBundleState.selection,
              cmsBundleState.bundle,
              cmsBundleState.preview.rowConflicts ?? [],
            )}
            resolutions={cmsRowResolutions}
            onResolutionChange={(key, resolution) => {
              setCmsRowResolutions((prev) => {
                const next = new Map(prev)
                next.set(key, resolution)
                return next
              })
            }}
          />
        )}

        {step === 'run' && (
          <ImportStep
            progress={runProgress}
            siteName={siteName}
            result={result}
            cmsResult={cmsResult}
            droppedAtRules={plan?.droppedAtRules.length ?? 0}
            logOpen={logOpen}
            mode={cmsBundleState ? 'cms' : 'static'}
          />
        )}
      </div>
    </Dialog>
  )
}
