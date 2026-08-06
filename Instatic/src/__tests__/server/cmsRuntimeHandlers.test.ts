import { describe, expect, it } from 'bun:test'
import { SESSION_COOKIE_NAME } from '../../../server/auth/tokens'
import type { DbClient, DbResult } from '../../../server/db'
import { handleCmsRequest } from '../../../server/handlers/cms'
import type { SiteDocument } from '@core/page-tree'
import '@core/loops/sources'
import '@modules/base'

function makeFakeDb(): DbClient {
  const handle = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => {
    const sql = strings.reduce<string>((acc, str, i) => (i === 0 ? str : `${acc}$${i}${str}`), '')
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (normalized.includes('from sessions') && normalized.includes('join users')) {
      return {
        rows: [{
          id: 'admin_1',
          email: 'owner@example.com',
          email_normalized: 'owner@example.com',
          display_name: 'Owner',
          password_hash: 'hash',
          status: 'active',
          role_id: 'owner',
          last_login_at: null,
          created_at: new Date('2026-01-01').toISOString(),
          updated_at: new Date('2026-01-01').toISOString(),
          deleted_at: null,
          role_slug: 'owner',
          role_name: 'Owner',
          role_description: '',
          role_is_system: true,
          role_capabilities_json: ['runtime.dependencies', 'site.read', 'pages.edit'],
        } as Row],
        rowCount: 1,
      }
    }
    if (normalized.includes('update sessions') && normalized.includes('last_seen_at')) {
      return { rows: [], rowCount: 1 }
    }
    // `buildRuntimePreviewDocument` now mirrors the published-page path
    // and queries enabled plugins so frontend script tags + CSP relaxations
    // match what visitors will see. The preview tests don't install any
    // plugin, so an empty result is the right answer.
    if (normalized.includes('from installed_plugins')) {
      return { rows: [], rowCount: 0 }
    }
    // `collectFrontendInjections` reads elected media storage adapters so
    // their declared CSP origins can extend `img-src` / `media-src` in
    // the preview iframe's CSP. No adapter is elected in these tests, so
    // an empty result lands the preview on the local-disk defaults.
    if (normalized.includes('from active_media_storage_adapter')) {
      return { rows: [], rowCount: 0 }
    }
    throw new Error(`Unhandled SQL: ${sql}`)
  }

  handle.unsafe = async <Row = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<DbResult<Row>> =>
    handle<Row>(sql.split(/\$\d+|\?/) as unknown as TemplateStringsArray, ...params)

  handle.transaction = async <T>(cb: (tx: DbClient) => Promise<T>): Promise<T> =>
    cb(handle as unknown as DbClient)

  return handle as DbClient
}

function runtimeRequest(url: string, body: unknown): Request {
  return {
    method: 'POST',
    url,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'cookie') return `${SESSION_COOKIE_NAME}=session-token`
        if (name.toLowerCase() === 'content-type') return 'application/json'
        return null
      },
    },
    json: async () => body,
  } as unknown as Request
}

function site(): SiteDocument {
  return {
    id: 'site_1',
    name: 'Runtime Preview',
    pages: [
      {
        id: 'page_1',
        title: 'Home',
        slug: 'index',
        rootNodeId: 'root',
        nodes: {
          root: {
            id: 'root',
            moduleId: 'base.body',
            props: {},
            breakpointOverrides: {},
            children: [],
          },
        },
      },
    ],
    files: [],
    visualComponents: [],
    packageJson: { dependencies: {}, devDependencies: {} },
    breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
    settings: {
      colorTokens: {},
      shortcuts: {},
    },
    styleRules: {},
    createdAt: 1,
    updatedAt: 1,
  }
}

function siteWithVC(): SiteDocument {
  const base = site()
  return {
    ...base,
    visualComponents: [
      {
        id: 'vc_hero',
        name: 'Hero',
        tree: {
          rootNodeId: 'vc_root',
          nodes: {
            vc_root: {
              id: 'vc_root',
              moduleId: 'base.body',
              props: {},
              breakpointOverrides: {},
              children: [],
            },
          },
        },
        params: [],
        breakpoints: [],
        createdAt: 1,
      },
    ],
  }
}

/**
 * A page plus an `everywhere` layout holding the shared chrome (nav + footer)
 * around a `base.outlet`. The draft preview must render the page INSIDE that
 * chrome, exactly as the canvas and the published page do.
 */
function siteWithEverywhereTemplate(): SiteDocument {
  const base = site()
  return {
    ...base,
    pages: [
      {
        ...base.pages[0],
        nodes: {
          root: {
            id: 'root',
            moduleId: 'base.body',
            props: {},
            breakpointOverrides: {},
            children: ['page_text'],
          },
          page_text: {
            id: 'page_text',
            moduleId: 'base.text',
            props: { text: 'PAGE BODY' },
            breakpointOverrides: {},
            children: [],
          },
        },
      },
      {
        id: 'tpl_everywhere',
        title: 'Site chrome',
        slug: 'site-chrome',
        template: { enabled: true, target: { kind: 'everywhere' }, priority: 0 },
        rootNodeId: 'tpl_root',
        nodes: {
          tpl_root: {
            id: 'tpl_root',
            moduleId: 'base.body',
            props: {},
            breakpointOverrides: {},
            children: ['tpl_nav', 'tpl_outlet', 'tpl_footer'],
          },
          tpl_nav: {
            id: 'tpl_nav',
            moduleId: 'base.text',
            props: { text: 'SHARED NAVBAR' },
            breakpointOverrides: {},
            children: [],
          },
          tpl_outlet: {
            id: 'tpl_outlet',
            moduleId: 'base.outlet',
            props: {},
            breakpointOverrides: {},
            children: [],
          },
          tpl_footer: {
            id: 'tpl_footer',
            moduleId: 'base.text',
            props: { text: 'SHARED FOOTER' },
            breakpointOverrides: {},
            children: [],
          },
        },
      },
    ],
  }
}

/**
 * The real-world shape: the `everywhere` layout holds NO chrome markup itself —
 * its body is [VC-ref → "Shared Header", base.outlet, VC-ref → "Shared Footer"].
 * This is how the site importer builds site chrome, so the preview has to
 * survive both hops: compose the template chain AND expand the VC refs inside
 * it. Composition alone would still render an empty header/footer.
 */
function siteWithSharedComponentChrome(): SiteDocument {
  const base = site()
  const chromeVc = (id: string, name: string, text: string) => ({
    id,
    name,
    tree: {
      rootNodeId: `${id}_root`,
      nodes: {
        [`${id}_root`]: {
          id: `${id}_root`,
          moduleId: 'base.container',
          props: { tag: 'div', customTag: '', htmlAttributes: {} },
          breakpointOverrides: {},
          children: [`${id}_text`],
        },
        [`${id}_text`]: {
          id: `${id}_text`,
          moduleId: 'base.text',
          props: { text },
          breakpointOverrides: {},
          children: [],
        },
      },
    },
    params: [],
    breakpoints: [],
    createdAt: 1,
  })

  return {
    ...base,
    visualComponents: [
      chromeVc('vc_header', 'Shared Header', 'SHARED NAVBAR'),
      chromeVc('vc_footer', 'Shared Footer', 'SHARED FOOTER'),
    ],
    pages: [
      {
        ...base.pages[0],
        nodes: {
          root: {
            id: 'root',
            moduleId: 'base.body',
            props: {},
            breakpointOverrides: {},
            children: ['page_text'],
          },
          page_text: {
            id: 'page_text',
            moduleId: 'base.text',
            props: { text: 'PAGE BODY' },
            breakpointOverrides: {},
            children: [],
          },
        },
      },
      {
        id: 'tpl_site_layout',
        title: 'Site Layout',
        slug: 'site-layout',
        template: { enabled: true, target: { kind: 'everywhere' }, priority: 0 },
        rootNodeId: 'tpl_root',
        nodes: {
          tpl_root: {
            id: 'tpl_root',
            moduleId: 'base.body',
            props: {},
            breakpointOverrides: {},
            children: ['ref_header', 'tpl_outlet', 'ref_footer'],
          },
          ref_header: {
            id: 'ref_header',
            moduleId: 'base.visual-component-ref',
            props: { componentId: 'vc_header' },
            breakpointOverrides: {},
            children: [],
          },
          tpl_outlet: {
            id: 'tpl_outlet',
            moduleId: 'base.outlet',
            props: {},
            breakpointOverrides: {},
            children: [],
          },
          ref_footer: {
            id: 'ref_footer',
            moduleId: 'base.visual-component-ref',
            props: { componentId: 'vc_footer' },
            breakpointOverrides: {},
            children: [],
          },
        },
      },
    ],
  }
}

function siteWithVCAndEverywhereTemplate(): SiteDocument {
  return {
    ...siteWithEverywhereTemplate(),
    visualComponents: siteWithVC().visualComponents,
  }
}

function siteWithLoop(): SiteDocument {
  const base = site()
  return {
    ...base,
    pages: [
      {
        ...base.pages[0],
        nodes: {
          root: {
            id: 'root',
            moduleId: 'base.body',
            props: {},
            breakpointOverrides: {},
            children: ['loop'],
          },
          loop: {
            id: 'loop',
            moduleId: 'base.loop',
            props: {
              sourceId: 'site.pages',
              filters: {},
              orderBy: 'definition',
              direction: 'asc',
              limit: 10,
              offset: 0,
              pagination: 'none',
              pageSize: 10,
              tag: 'div',
              customTag: '',
            },
            breakpointOverrides: {},
            children: ['loop_text'],
          },
          loop_text: {
            id: 'loop_text',
            moduleId: 'base.text',
            props: { text: 'Fallback' },
            dynamicBindings: {
              text: { source: 'currentEntry', field: 'title' },
            },
            breakpointOverrides: {},
            children: [],
          },
        },
      },
      {
        id: 'page_loop_item',
        title: 'ISS-234 SERVER LOOP ROW',
        slug: 'loop-row',
        rootNodeId: 'loop_item_root',
        nodes: {
          loop_item_root: {
            id: 'loop_item_root',
            moduleId: 'base.body',
            props: {},
            breakpointOverrides: {},
            children: [],
          },
        },
      },
    ],
  }
}

describe('CMS runtime handlers', () => {
  it('resolves an empty runtime dependency manifest', async () => {
    const res = await handleCmsRequest(runtimeRequest(
      'http://localhost/cms/api/cms/runtime/dependencies/resolve',
      { packageJson: { dependencies: {}, devDependencies: {} } },
    ), makeFakeDb())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      dependencyLock: { version: 1, packages: {} },
    })
  })

  it('normalizes unsafe and non-runtime dependency manifest entries before resolving', async () => {
    const res = await handleCmsRequest(runtimeRequest(
      'http://localhost/cms/api/cms/runtime/dependencies/resolve',
      {
        packageJson: {
          dependencies: {
            'bad;pkg': '^1.0.0',
            '': '^1.0.0',
            'canvas-confetti': '',
            motion: 12,
          },
          devDependencies: {
            vite: '^7.0.0',
          },
        },
      },
    ), makeFakeDb())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      dependencyLock: {
        version: 1,
        packages: {},
        updatedAt: expect.any(Number),
      },
    })
  })

  it('builds a runtime preview document for a provided site and page', async () => {
    const res = await handleCmsRequest(runtimeRequest(
      'http://localhost/cms/api/cms/runtime/preview',
      { site: site(), pageId: 'page_1' },
    ), makeFakeDb())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      html: expect.stringContaining('<!DOCTYPE html>'),
      assets: [],
      runtimeAssets: { scripts: [] },
      diagnostics: [],
    })
  })

  it('prefetches and renders loop rows in the runtime preview (ISS-234)', async () => {
    const res = await handleCmsRequest(runtimeRequest(
      'http://localhost/cms/api/cms/runtime/preview',
      { site: siteWithLoop(), pageId: 'page_1' },
    ), makeFakeDb())

    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('ISS-234 SERVER LOOP ROW')
    expect(body).not.toContain('instatic: loop data missing')
  })

  it('builds a runtime preview from a VC virtual page id when the editor is in VC canvas mode', async () => {
    const res = await handleCmsRequest(runtimeRequest(
      'http://localhost/cms/api/cms/runtime/preview',
      { site: siteWithVC(), pageId: 'vc-virtual:vc_hero' },
    ), makeFakeDb())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      html: expect.stringContaining('<!DOCTYPE html>'),
      diagnostics: [],
    })
  })

  it('renders the draft preview inside the everywhere template chrome', async () => {
    const res = await handleCmsRequest(runtimeRequest(
      'http://localhost/cms/api/cms/runtime/preview',
      { site: siteWithEverywhereTemplate(), pageId: 'page_1' },
    ), makeFakeDb())

    expect(res.status).toBe(200)
    const body = await res.text()
    // Shared components the canvas shows must also reach the preview…
    expect(body).toContain('SHARED NAVBAR')
    expect(body).toContain('SHARED FOOTER')
    // …with the page spliced into the outlet, and no outlet placeholder left.
    expect(body).toContain('PAGE BODY')
    expect(body).not.toContain('base.outlet')
  })

  it('renders shared header/footer components carried by the everywhere template', async () => {
    const res = await handleCmsRequest(runtimeRequest(
      'http://localhost/cms/api/cms/runtime/preview',
      { site: siteWithSharedComponentChrome(), pageId: 'page_1' },
    ), makeFakeDb())

    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('SHARED NAVBAR')
    expect(body).toContain('SHARED FOOTER')
    expect(body).toContain('PAGE BODY')
  })

  it('does not wrap a VC virtual page in the template chrome', async () => {
    const res = await handleCmsRequest(runtimeRequest(
      'http://localhost/cms/api/cms/runtime/preview',
      { site: siteWithVCAndEverywhereTemplate(), pageId: 'vc-virtual:vc_hero' },
    ), makeFakeDb())

    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).not.toContain('SHARED NAVBAR')
    expect(body).not.toContain('SHARED FOOTER')
  })

  it('returns 404 for an unknown VC virtual page id', async () => {
    const res = await handleCmsRequest(runtimeRequest(
      'http://localhost/cms/api/cms/runtime/preview',
      { site: siteWithVC(), pageId: 'vc-virtual:unknown_vc' },
    ), makeFakeDb())

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'Page not found' })
  })
})
