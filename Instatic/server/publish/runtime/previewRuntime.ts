import type { Page, SiteDocument } from '@core/page-tree'
import type { IModuleRegistry } from '@core/module-engine'
import type { TemplateRenderDataContext } from '@core/templates/dynamicBindings'
import { composeTemplateChain, resolveWrapperTemplates } from '@core/templates'
import { normalizeSiteRuntimeConfig } from '@core/site-runtime'
import { publishPage } from '@core/publisher'
import type { PublishedRuntimePackageImportmap } from '@core/publisher'
import { prefetchLoopData } from '../loopPrefetch'
import { prefetchMediaAssets } from '../mediaPrefetch'
import { collectFrontendInjections, injectFrontendAssets } from '../frontendInjections'
import type { DbClient } from '../../db/client'
import {
  buildSiteRuntimeScripts,
  type BuiltRuntimeAssetFile,
  type BuildSiteRuntimeScriptsInput,
  type SiteRuntimeBuildResult,
} from './bundleScripts'
import {
  buildRuntimePackageImportmap,
  serializeImportmapForCsp,
} from './packageImportmap'

interface RuntimePreviewDocumentInput {
  site: SiteDocument
  page: Page
  registry: IModuleRegistry
  assetBasePath: string
  // The previewer needs `hash` in addition to `nodeModulesDir` so it can
  // emit a `<script type="importmap">` whose URLs embed the lock hash —
  // those URLs are served by `tryServeRuntimePackage`. The script bundler
  // only needs `nodeModulesDir`, so we widen the type at this boundary.
  dependencyCache?: BuildSiteRuntimeScriptsInput['dependencyCache'] & { hash?: string }
  dependencyNodeModulesDir?: string
  breakpointId?: string
  templateContext?: TemplateRenderDataContext
  /**
   * Optional DB client — when supplied, every `base.loop` node on the
   * page is pre-fetched against the database, so loops render with real
   * data in the editor's runtime preview (iframe canvas). Without it,
   * loops emit a "no resolved data" comment.
   */
  db?: DbClient
  /**
   * Whether to render `page` inside the templates that wrap it at publish
   * time (the `everywhere` layout's nav / footer chrome, …). Default `true`
   * — a preview that drops the chrome is not a preview of the published page.
   *
   * Pass `false` only for documents that are not published routes: the
   * Visual-Component edit surface, which the canvas likewise never wraps.
   */
  wrapInTemplates?: boolean
}

interface RuntimePreviewDocumentResult extends SiteRuntimeBuildResult {
  html: string
  files: BuiltRuntimeAssetFile[]
}

export async function buildRuntimePreviewDocument(
  input: RuntimePreviewDocumentInput,
): Promise<RuntimePreviewDocumentResult> {
  // Wrap the document in its matching template chain, exactly as
  // `renderPublishedSnapshot` does — otherwise the preview drops the site
  // chrome (nav, footer) that the canvas renders via `CanvasComposedTree` and
  // the published page carries. With no wrappers, `composeTemplateChain`
  // returns the page untouched.
  const renderPage = input.wrapInTemplates === false
    ? input.page
    : composeTemplateChain(
        resolveWrapperTemplates(input.site, input.page),
        { kind: 'page', page: input.page },
      )
  // Script selection stays keyed on the DOCUMENT, not the composed tree:
  // `collectRuntimeScripts` scopes each script by page, and composition
  // rewrites the merged page's id/slug to the outermost template's. This
  // mirrors the publish path, which bundles per `page` and renders `merged`.
  const runtimeBuild = await buildSiteRuntimeScripts({
    site: input.site,
    page: input.page,
    target: 'canvas',
    assetBasePath: input.assetBasePath,
    dependencyCache: input.dependencyCache,
    dependencyNodeModulesDir: input.dependencyNodeModulesDir,
  })
  // Build the package importmap from the already-populated dependency cache.
  // The cache here is the same handle the caller produced by
  // `ensureRuntimeDependencyCache(lock)` before calling us, so by the time we
  // reach this point `node_modules/` is on disk and ready to be enumerated.
  let runtimePackageImportmap: PublishedRuntimePackageImportmap | undefined
  if (input.dependencyCache?.hash && input.dependencyCache.nodeModulesDir) {
    const runtime = normalizeSiteRuntimeConfig(input.site.runtime)
    const built = await buildRuntimePackageImportmap(
      runtime.dependencyLock,
      {
        hash: input.dependencyCache.hash,
        nodeModulesDir: input.dependencyCache.nodeModulesDir,
      },
    )
    if (built) {
      const serialized = await serializeImportmapForCsp(built.importmap)
      runtimePackageImportmap = { body: serialized.body, sha256: serialized.sha256 }
    }
  }
  const loopData = input.db
    ? await prefetchLoopData(renderPage, input.site, input.db)
    : undefined
  const mediaAssets = input.db
    ? await prefetchMediaAssets(renderPage, input.site, input.registry, input.db, {
        templateContext: input.templateContext,
        loopData,
      })
    : undefined
  const baseHtml = publishPage(renderPage, input.site, input.registry, {
    breakpointId: input.breakpointId,
    templateContext: input.templateContext,
    runtimeAssets: runtimeBuild.runtimeAssets,
    runtimePackageImportmap,
    loopData,
    mediaAssets,
  }).html

  // Mirror the published-page path: pull each enabled plugin's
  // `frontend.assets[]` into the document and relax the CSP the same way
  // the public renderer + dispatcher pipeline does. Without this, the
  // iframe preview would block plugin scripts (their `<script>` tags
  // wouldn't be emitted at all) and any `networkAllowedHosts` declared
  // by plugins wouldn't reach `connect-src` — visitor-side `fetch()` to
  // external hosts would fail under `default-src 'self'` even though the
  // published page would allow them.
  //
  // The preview iframe does NOT fire `publish.before / publish.html /
  // publish.after` — those mutate persisted state and aren't safe to run
  // on every keystroke. Plugins that need to rewrite the HTML in the
  // preview can hook frontend injection (which IS shared) and emit the
  // same CSP envelope; full HTML filtering is reserved for the real
  // publish path.
  const html = input.db
    ? injectFrontendAssets(baseHtml, await collectFrontendInjections(input.db))
    : baseHtml

  return {
    ...runtimeBuild,
    html,
  }
}
