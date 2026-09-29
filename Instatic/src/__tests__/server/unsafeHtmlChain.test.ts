/**
 * Unsafe HTML, from an anonymous stranger to the bytes a visitor is served
 * (security class E8).
 *
 * WHY THIS FILE EXISTS, given that the sanitiser is already well tested.
 *
 * It is. `sanitize.test.ts` proves DOMPurify strips what it should, and
 * `escapeProps` has its own tests. Every one of them calls the function
 * directly. Not one starts where an attacker starts — an unauthenticated HTTP
 * request — and not one ends where the attack lands: the response body a browser
 * parses. A chain of individually-correct links is not a proven chain, and three
 * facts about this particular chain make the untested joins worth closing:
 *
 *  1. THE STORE IS RAW. `forms/handler.ts` hands `validation.cells` straight to
 *     `createDataRow` with no sanitisation on that path at all. Whatever a
 *     stranger types is what sits in the database. That is a deliberate design —
 *     clean at render, not at write, so the original submission survives for a
 *     human to read — but it means the render-time pass is not defence in depth.
 *     It is the defence.
 *
 *  2. THE CSP ON A PUBLISHED PAGE IS A META TAG, NOT A HEADER. `securityHeaders.ts`
 *     sends a CSP *header* on `/admin` only, so looking at response headers makes
 *     a public page appear unprotected. It is not: the publisher emits
 *     `<meta http-equiv="Content-Security-Policy" … script-src 'none'>` into every
 *     page. That is a real second layer and it is asserted below, because the day
 *     it changes this file's stakes change with it.
 *
 *  3. THE ONE FAIL-OPEN HERE WAS REAL. `sanitizeRichtext` once returned its
 *     input unchanged in a runtime with no DOMPurify installed. Given 1, that was
 *     the whole write-time defence returning the payload verbatim.
 *
 * AND IT FOUND A SECOND ONE. Writing this file turned up a live defect rather
 * than confirming the existing controls: one pass of DOMPurify on this stack
 * removed only the FIRST disallowed element among a run of siblings, so
 * `<img onerror><img onerror><img onerror>` came back with two of the three
 * intact, handlers and all. Both `sanitizeRichtext` and `sanitizeSvg` now loop to
 * a fixpoint — see `sanitizeToFixpoint` in `src/core/sanitize.ts` for the
 * measurement. The `script-src 'none'` in point 2 is what kept that from being
 * exploitable, which is the argument for having had it.
 *
 * WHAT IS ACTUALLY END TO END, AND WHAT IS NOT — stated so nobody reads more
 * into it than it proves. The first test really does run the chain: one fake
 * database serves both the anonymous submit and the page render, so the row the
 * form handler wrote is the row the loop source reads back, and the assertions
 * are on `await response.text()`. Where a test instead hands a crafted cell to
 * the renderer, it says so on the line that does it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DbResult } from '../../../server/db'
import { handlePublicFormRequest } from '../../../server/forms/handler'
import { handleServerRequest } from '../../../server/router'
import { resetForTests } from '../../../server/publish/renderCache'
import {
  issuePublicFormPageToken,
  resetPublicFormChallenges,
} from '../../../server/forms/challenge'
import { publicFormPerFormRateLimit, publicFormPerIpRateLimit } from '../../../server/forms/rateLimit'
import { resetPublicOrigins } from '../../../server/auth/security'
import { createFakeDb } from './dbTestFake'
import { prepareInactiveSlot, writeArtefact } from '../../../server/publish/staticArtefact'
import type { PublishedPageSnapshot } from '../../../server/repositories/publish'
import { makePage, makeSite } from '../publisher/helpers'

// ---------------------------------------------------------------------------
// The payloads. Four vectors, chosen because they defeat four different
// defences: tag stripping, attribute stripping, scheme filtering, and
// namespace confusion. A filter that only escapes `<` stops the first two and
// none of the rest.
// ---------------------------------------------------------------------------

const SCRIPT_TAG = '<script>alert(1)</script>'
const IMG_ONERROR = '<img src=x onerror=alert(1)>'
const SVG_ONLOAD = '<svg onload=alert(1)></svg>'
const JS_SCHEME = 'javascript:alert(1)'

/** The benign part, so a test cannot pass because the render came back empty. */
const BENIGN = 'Loved the new site'

const POISONED_MESSAGE = `${BENIGN} ${SCRIPT_TAG}${IMG_ONERROR}${SVG_ONLOAD}`

/**
 * Every assertion about served bytes, in one place, so each ingress path below is
 * held to the same bar and a vector added here is checked everywhere at once.
 *
 * THE BYTES ARE PARSED, NOT STRING-MATCHED, and that is the whole design of this
 * helper. A substring check cannot tell `<img onerror=…>` from
 * `&lt;img onerror=…&gt;`, and the second one is inert — it is text a visitor
 * reads, which is the correct outcome for an escaped field. A test that banned
 * the substring would fail on the safe result and push whoever hit it towards
 * weakening the assertion. So the response is parsed the way a browser parses it
 * and the question asked of the tree is the one that matters: is there anything
 * here that would RUN?
 *
 * Three things would: a script element with a body, an `on*` attribute on any
 * element, and a `javascript:` URL in anything that navigates or loads.
 */
function expectNothingExecutable(html: string): void {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const scriptBodies = [...doc.querySelectorAll('script')]
    .map((el) => (el.textContent ?? '').trim())
    .filter((body) => body.length > 0)
  expect(scriptBodies).toEqual([])

  const handlers: string[] = []
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (attr.name.toLowerCase().startsWith('on')) {
        handlers.push(`<${el.tagName.toLowerCase()} ${attr.name}="${attr.value}">`)
      }
    }
  }
  expect(handlers).toEqual([])

  const dangerousUrls = [...doc.querySelectorAll('[href], [src], [xlink\\:href]')]
    .map((el) => el.getAttribute('href') ?? el.getAttribute('src') ?? '')
    .filter((value) => /^\s*(javascript|vbscript|data:text\/html)/i.test(value))
  expect(dangerousUrls).toEqual([])

  // One string-level check that IS safe to make, because no page in this file
  // has any legitimate reason to carry it: the payload's own script body as
  // live markup.
  expect(html).not.toContain(SCRIPT_TAG)
}

// ---------------------------------------------------------------------------
// The submissions table. `kind: 'data'`, `system: false` — the only shape
// `isFormSubmissionTargetTable` accepts, so this is the only kind of table a
// stranger can write into.
//
// `link` is deliberately a `text` field and not a `url` one. A `url` field
// rejects `javascript:` at validation (`isValidUrl` allows http/https/mailto
// and nothing else), so the interesting case is the one that gets past the
// front door: a plain text cell that a site author has bound to a link's href.
// That is an ordinary thing to build and it leaves `isSafeUrl` at render as the
// only thing standing between the stranger and the anchor.
// ---------------------------------------------------------------------------

const TABLE_ID = 'feedback_submissions'

const feedbackFields = [
  { id: 'email', label: 'Email', type: 'email', required: true },
  { id: 'message', label: 'Message', type: 'longText' },
  { id: 'link', label: 'Your site', type: 'text' },
]

const feedbackTableRow = {
  id: TABLE_ID,
  name: 'Feedback',
  slug: 'feedback',
  kind: 'data',
  route_base: '',
  singular_label: 'Submission',
  plural_label: 'Submissions',
  primary_field_id: 'email',
  fields_json: feedbackFields,
  system: 0,
}

function formPage() {
  const page = makePage({
    root: { moduleId: 'base.body', children: ['form'] },
    form: {
      moduleId: 'base.form',
      props: {
        mode: 'cms',
        formId: 'feedback',
        targetTableId: TABLE_ID,
        honeypotName: 'company',
        minSubmitSeconds: 0,
      },
      children: ['emailInput', 'messageInput', 'linkInput'],
    },
    emailInput: {
      moduleId: 'base.input',
      props: { fieldId: 'email', name: 'email', id: 'email-input', inputType: 'email', required: true },
    },
    messageInput: {
      moduleId: 'base.input',
      props: { fieldId: 'message', name: 'message', id: 'message-input', inputType: 'text' },
    },
    linkInput: {
      moduleId: 'base.input',
      props: { fieldId: 'link', name: 'link', id: 'link-input', inputType: 'text' },
    },
  })
  page.id = 'page-home'
  page.slug = 'index'
  page.title = 'Home'
  return page
}

/**
 * The page that displays what strangers submitted — a testimonial wall, which
 * is the ordinary reason to show anonymous submissions at all.
 *
 * Three sinks, one per defence in `escapeProps`:
 *   - `base.text.text`   → `textarea` type  → escapeHtml
 *   - `base.link.href`   → `url` type       → isSafeUrl
 *   - `base.link.text`   → `text` type      → escapeHtml
 */
function wallPage() {
  const page = makePage({
    root: { moduleId: 'base.body', children: ['loop'] },
    loop: {
      moduleId: 'base.loop',
      props: { sourceId: 'data.rows', filters: { tableId: TABLE_ID }, orderBy: 'createdAt', limit: 10 },
      // ONE child, wrapping both sinks. The loop interceptor round-robins its
      // children across items, so two direct children with one row would render
      // only the first — and the href sink, the interesting one, would have been
      // the one silently skipped.
      children: ['card'],
    },
    card: { moduleId: 'base.container', children: ['quote', 'credit'] },
    quote: {
      moduleId: 'base.text',
      props: { text: 'placeholder', tag: 'p' },
      dynamicBindings: { text: { source: 'currentEntry', field: 'message' } },
    },
    credit: {
      moduleId: 'base.link',
      props: { href: '#', text: 'their site' },
      dynamicBindings: {
        href: { source: 'currentEntry', field: 'link' },
        text: { source: 'currentEntry', field: 'message' },
      },
    },
  })
  page.id = 'page-wall'
  page.slug = 'wall'
  page.title = 'What people say'
  return page
}

// ---------------------------------------------------------------------------
// One fake database, shared by the submit and the render.
//
// `storedRows` is the join between the two halves: the form handler's INSERT
// lands there, and the loop source's SELECT reads it back. Nothing is copied by
// hand between them, which is the whole point — if the handler stored something
// other than what the renderer is later given, these tests would not agree with
// each other.
// ---------------------------------------------------------------------------

interface StoredRow {
  id: string
  table_id: string
  cells_json: Record<string, unknown>
  slug: string
}

function makeChainDb() {
  const storedRows: StoredRow[] = []
  const site = makeSite({ pages: [formPage(), wallPage()] })

  const db = createFakeDb(async (rawSql, params): Promise<DbResult> => {
    const sql = rawSql.replace(/\s+/g, ' ').trim().toLowerCase()

    // --- the router's install/setup probes ---------------------------------
    if (sql.includes('count(*) as count from site')) return { rows: [{ count: 1 }], rowCount: 1 }
    if (sql.includes('from users') && sql.includes('role_id') && sql.includes('count')) {
      return { rows: [{ count: 1 }], rowCount: 1 }
    }
    if (sql.includes('from active_media_storage_adapter')) return { rows: [], rowCount: 0 }
    // getPublishedContentClassNames scans every published body for the class
    // names content uses. No content classes here, so an empty read.
    if (sql.startsWith('select data_row_versions.cells_json')) return { rows: [], rowCount: 0 }
    if (sql.startsWith('select id, name, version, enabled, lifecycle_status')) {
      return { rows: [], rowCount: 0 }
    }

    // --- the published site document ---------------------------------------
    if (sql.includes('site_snapshots.site_json')) {
      // getPublishedPageBySlug: a page lives as a data row, keyed by slug.
      if (sql.includes('data_rows.slug =')) {
        const slug = String(params[0])
        const page = site.pages.find((candidate) => candidate.slug === slug)
        if (!page) return { rows: [], rowCount: 0 }
        return {
          rows: [{
            row_id: page.id,
            site_json: site,
            runtime_assets_json: null,
            importmap_body: null,
            importmap_sha256: null,
          }],
          rowCount: 1,
        }
      }
      // getLatestPublishedSiteSnapshot — what the form handler resolves against.
      return {
        rows: [{
          row_id: 'page-home',
          site_json: site,
          runtime_assets_json: null,
          importmap_body: null,
          importmap_sha256: null,
        }],
        rowCount: 1,
      }
    }

    // --- the submissions table ---------------------------------------------
    if (sql.startsWith('select id, name, slug, kind, route_base')) {
      if (String(params[0]) !== TABLE_ID) return { rows: [], rowCount: 0 }
      return {
        rows: [{
          ...feedbackTableRow,
          created_by_user_id: null,
          updated_by_user_id: null,
          created_at: new Date('2026-09-01T00:00:00Z'),
          updated_at: new Date('2026-09-01T00:00:00Z'),
        }],
        rowCount: 1,
      }
    }
    // The loop source's own table projection (kind + fields).
    if (sql.startsWith('select kind, fields_json')) {
      if (String(params[0]) !== TABLE_ID) return { rows: [], rowCount: 0 }
      return { rows: [{ kind: 'data', fields_json: feedbackFields }], rowCount: 1 }
    }

    // --- the write the stranger performs -----------------------------------
    if (sql.startsWith('insert into data_rows')) {
      storedRows.push({
        id: String(params[0]),
        table_id: String(params[1]),
        cells_json: params[2] as Record<string, unknown>,
        slug: String(params[3] ?? ''),
      })
      return { rows: [{ id: params[0] }], rowCount: 1 }
    }

    // --- the read the visitor's page performs -------------------------------
    if (sql.includes('count(*) as total') && sql.includes('from data_rows')) {
      const total = storedRows.filter((row) => row.table_id === String(params[0])).length
      return { rows: [{ total }], rowCount: 1 }
    }
    if (sql.startsWith('select data_rows.id as row_id')) {
      const rows = storedRows
        .filter((row) => row.table_id === String(params[0]))
        .map((row) => ({
          row_id: row.id,
          table_id: row.table_id,
          table_slug: feedbackTableRow.slug,
          table_route_base: '',
          cells_json: row.cells_json,
          slug: row.slug,
          author_user_id: null,
          author_display_name: null,
          author_role_slug: null,
          author_role_name: null,
          created_at: new Date('2026-09-01T00:00:00Z'),
          updated_at: new Date('2026-09-01T00:00:00Z'),
        }))
      return { rows, rowCount: rows.length }
    }

    // The row read-back after the insert (createDataRow returns the fresh row).
    if (sql.startsWith('select data_rows.id') && sql.includes('from data_rows')) {
      const row = storedRows.find((candidate) => candidate.id === String(params[0]))
      if (!row) return { rows: [], rowCount: 0 }
      return {
        rows: [{
          ...row,
          status: 'published',
          author_user_id: null,
          author_email: null,
          author_display_name: null,
          author_role_slug: null,
          author_role_name: null,
          created_by_email: null,
          created_by_display_name: null,
          created_by_role_slug: null,
          created_by_role_name: null,
          updated_by_email: null,
          updated_by_display_name: null,
          updated_by_role_slug: null,
          updated_by_role_name: null,
          published_by_email: null,
          published_by_display_name: null,
          published_by_role_slug: null,
          published_by_role_name: null,
          published_at: null,
          scheduled_publish_at: null,
          deleted_at: null,
          created_at: new Date('2026-09-01T00:00:00Z'),
          updated_at: new Date('2026-09-01T00:00:00Z'),
        }],
        rowCount: 1,
      }
    }

    throw new Error(`Unhandled SQL: ${rawSql}`)
  })

  return { db, storedRows, site }
}

function submitRequest(path: string, body: unknown) {
  const req = new Request(`http://cms.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  req.headers.set('origin', 'http://cms.test')
  req.headers.set('sec-fetch-site', 'same-origin')
  return req
}

async function submitPoisonedFeedback(db: ReturnType<typeof makeChainDb>['db']) {
  resetPublicFormChallenges()
  publicFormPerIpRateLimit.reset('unknown')
  publicFormPerFormRateLimit.reset('unknown|feedback')

  const pageToken = issuePublicFormPageToken({ pageId: 'page-home', formId: 'feedback' })
  const challengeResponse = await handlePublicFormRequest(
    submitRequest('/_instatic/form/challenge', { formId: 'feedback', pageId: 'page-home', pageToken }),
    db,
    new URL('http://cms.test/_instatic/form/challenge'),
  )
  expect(challengeResponse?.status).toBe(200)
  const challenge = await challengeResponse!.json() as { token: string; challenge: string }

  return await handlePublicFormRequest(
    submitRequest('/_instatic/form/submit', {
      formId: 'feedback',
      pageId: 'page-home',
      token: challenge.token,
      challenge: challenge.challenge,
      values: {
        email: 'stranger@example.test',
        message: POISONED_MESSAGE,
        link: JS_SCHEME,
        company: '',
      },
    }),
    db,
    new URL('http://cms.test/_instatic/form/submit'),
  )
}

describe('unsafe HTML: anonymous submission to served bytes', () => {
  beforeEach(() => {
    resetForTests()
  })
  afterEach(() => {
    resetPublicOrigins()
  })

  it('accepts the submission and stores it RAW, which is what makes the render-time pass load-bearing', async () => {
    const { db, storedRows } = makeChainDb()

    const response = await submitPoisonedFeedback(db)
    expect(response?.status).toBe(200)
    expect(storedRows).toHaveLength(1)

    // Stated as an equality rather than a `toContain`, because the claim is not
    // "some of it survived" — it is that the stored cell is byte-for-byte what a
    // stranger typed. Nothing on this path sanitises, escapes or truncates.
    expect(storedRows[0]!.cells_json).toEqual({
      email: 'stranger@example.test',
      message: POISONED_MESSAGE,
      link: JS_SCHEME,
    })
  })

  it('serves the page that displays it with every vector neutralised', async () => {
    const { db, storedRows } = makeChainDb()

    expect((await submitPoisonedFeedback(db))?.status).toBe(200)
    // The renderer below reads through the same db, so this is the stored row —
    // not a fixture standing in for one.
    expect(storedRows).toHaveLength(1)

    const response = await handleServerRequest(new Request('http://cms.test/wall'), { db })
    expect(response.status).toBe(200)
    const html = await response.text()

    expectNothingExecutable(html)

    // The payload REACHED the page and was defanged, rather than the render
    // coming back empty — without these two the test above would pass against a
    // blank response, which is the way a chain test quietly stops testing
    // anything.
    expect(html).toContain(BENIGN)
    expect(html).toContain('&lt;script&gt;')

    // And the anchor is inert rather than absent: `isSafeUrl` substitutes `#`,
    // so the link still renders and simply goes nowhere.
    expect(html).toContain('href="#"')
  })

  it('carries a script-blocking CSP as a meta tag, which is the second layer behind the sanitiser', async () => {
    const { db } = makeChainDb()
    expect((await submitPoisonedFeedback(db))?.status).toBe(200)

    const response = await handleServerRequest(new Request('http://cms.test/wall'), { db })
    const html = await response.text()

    // Checked in the document, not the headers. `securityHeaders.ts` sends a CSP
    // header for `/admin` only, so a reader who looks at response headers alone
    // concludes a public page has no policy at all — and that conclusion sat in
    // this file's own header comment until this test was written.
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const meta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')
    expect(meta).not.toBeNull()

    const policy = meta!.getAttribute('content') ?? ''
    // `script-src 'none'` is the directive that matters here: with no
    // `unsafe-inline`, an `on*` handler that got past the sanitiser still does not
    // run. That is exactly what contained the one-pass sanitiser defect this file
    // uncovered, and the reason it was a defect rather than an incident.
    expect(policy).toContain("script-src 'none'")
    expect(policy).not.toContain("script-src 'unsafe-inline'")
  })

  it('refuses a javascript: URL at the front door when the field is typed as a url', async () => {
    // The other half of the story: the hole in the test above exists because the
    // author bound a TEXT cell to an href. Where the field is a `url`, the
    // scheme never reaches storage at all — worth pinning so a later change to
    // `isValidUrl` cannot quietly widen the ingress.
    const { db, storedRows } = makeChainDb()
    resetPublicFormChallenges()
    publicFormPerIpRateLimit.reset('unknown')
    publicFormPerFormRateLimit.reset('unknown|feedback')

    const urlTable = { ...feedbackTableRow, fields_json: [
      { id: 'email', label: 'Email', type: 'email', required: true },
      { id: 'link', label: 'Your site', type: 'url' },
    ] }
    const urlDb = createFakeDb(async (rawSql, params) => {
      const sql = rawSql.replace(/\s+/g, ' ').trim().toLowerCase()
      if (sql.startsWith('select id, name, slug, kind, route_base')) {
        return {
          rows: [{
            ...urlTable,
            created_by_user_id: null,
            updated_by_user_id: null,
            created_at: new Date('2026-09-01T00:00:00Z'),
            updated_at: new Date('2026-09-01T00:00:00Z'),
          }],
          rowCount: 1,
        }
      }
      return db.unsafe(rawSql, params)
    })

    const pageToken = issuePublicFormPageToken({ pageId: 'page-home', formId: 'feedback' })
    const challengeResponse = await handlePublicFormRequest(
      submitRequest('/_instatic/form/challenge', { formId: 'feedback', pageId: 'page-home', pageToken }),
      urlDb,
      new URL('http://cms.test/_instatic/form/challenge'),
    )
    const challenge = await challengeResponse!.json() as { token: string; challenge: string }

    const response = await handlePublicFormRequest(
      submitRequest('/_instatic/form/submit', {
        formId: 'feedback',
        pageId: 'page-home',
        token: challenge.token,
        challenge: challenge.challenge,
        values: { email: 'stranger@example.test', link: JS_SCHEME, company: '' },
      }),
      urlDb,
      new URL('http://cms.test/_instatic/form/submit'),
    )

    expect(response?.status).toBe(400)
    // Refused means nothing written, not written-and-flagged.
    expect(storedRows).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// The baked artefact — the bytes a real visitor actually gets.
//
// In production a published page is pre-rendered to disk and served from there;
// the live renderer the tests above exercise is the fallback. So an assertion
// that only ever reads a live response leaves the common case unexamined.
//
// WHAT THIS ASSERTS, AND WHAT IT DELIBERATELY DOES NOT. It bakes through the
// real `writeArtefact` and reads the file back off disk, so the claim is about
// the persisted bytes. It does NOT then serve them through the router, because
// `swapSlot` publishes by creating a symlink and Windows refuses that without
// elevation — three pre-existing tests in `cmsTemplateRoutes.test.ts` fail on the
// same `EPERM`. Serving mechanics are that file's subject. This file's subject is
// whether an attacker's payload survives into a published file, and that is
// answered by reading the file.
// ---------------------------------------------------------------------------

describe('unsafe HTML: the baked artefact written to disk', () => {
  beforeEach(() => {
    resetForTests()
  })

  it('holds the neutralised bytes, not the raw submission', async () => {
    const { db } = makeChainDb()
    expect((await submitPoisonedFeedback(db))?.status).toBe(200)

    // Render through the live path, exactly as publishSite does before baking.
    const rendered = await handleServerRequest(new Request('http://cms.test/wall'), { db })
    const renderedHtml = await rendered.text()

    const uploadsDir = await mkdtemp(join(tmpdir(), 'e8-artefact-'))
    try {
      const { slotDir } = await prepareInactiveSlot(uploadsDir)
      await writeArtefact(slotDir, '/wall', renderedHtml)

      // Read it back from disk rather than trusting the string we passed in — the
      // point is what LANDED, so an encoding or write-path change is caught here
      // rather than assumed away.
      const onDisk = await readFile(join(slotDir, 'wall.html'), 'utf-8')

      expectNothingExecutable(onDisk)
      expect(onDisk).toContain(BENIGN)
    } finally {
      await rm(uploadsDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// The richtext seat, which is the one with no escaping at all.
//
// `base.outlet`'s `html` prop is `type: 'richtext'`, so `escapeProps` does NOT
// escape it — it passes it to `sanitizeRichtext` and emits the result as real
// markup. And unlike every other prop, it is never persisted on the node: it
// comes from the current entry's body at render time. So there is no write-time
// sanitisation of it anywhere, by construction, and this single call is the only
// thing between a post body and the page.
//
// This is the seat where the fail-open mattered. The cell is handed to the
// renderer directly here — there is no anonymous ingress into a post body, so
// pretending otherwise would be theatre.
// ---------------------------------------------------------------------------

describe('unsafe HTML in an entry body, through the unescaped richtext prop', () => {
  beforeEach(() => {
    resetForTests()
  })

  it('is sanitised before it reaches the served page', async () => {
    const template = makePage({
      root: { moduleId: 'base.body', children: ['outlet'] },
      outlet: { moduleId: 'base.outlet', props: {} },
    })
    template.id = 'post-template'
    template.slug = 'post-template'
    template.title = 'Post template'
    template.template = {
      enabled: true,
      target: { kind: 'postTypes', tableSlugs: ['posts'] },
      priority: 100,
    }

    const snapshot: PublishedPageSnapshot = {
      cmsSnapshotVersion: 1,
      pageRowId: template.id,
      site: makeSite({ pages: [template] }),
    }

    const db = createFakeDb(async (rawSql, params): Promise<DbResult> => {
      const sql = rawSql.replace(/\s+/g, ' ').trim().toLowerCase()
      if (sql.startsWith('select id, name, version, enabled, lifecycle_status')) {
        return { rows: [], rowCount: 0 }
      }
      if (sql.includes('from active_media_storage_adapter')) return { rows: [], rowCount: 0 }
      if (sql.startsWith('select data_row_versions.cells_json')) return { rows: [], rowCount: 0 }
      if (sql.includes('count(*) as count from site')) return { rows: [{ count: 1 }], rowCount: 1 }
      if (sql.includes('site_snapshots.site_json')) {
        if (sql.includes('data_rows.slug =')) return { rows: [], rowCount: 0 }
        return {
          rows: [{
            row_id: snapshot.pageRowId,
            site_json: snapshot.site,
            runtime_assets_json: null,
            importmap_body: null,
            importmap_sha256: null,
          }],
          rowCount: 1,
        }
      }
      if (sql.startsWith('select data_row_versions.id')) {
        return {
          rows: [{
            id: 'version_1',
            row_id: 'row_1',
            table_id: 'posts',
            table_slug: 'posts',
            table_kind: 'postType',
            table_route_base: '/posts',
            version_number: 1,
            // The poisoned body, handed straight to the renderer.
            cells_json: {
              title: 'A post',
              slug: 'poisoned',
              body: POISONED_MESSAGE,
              featuredMedia: null,
              seoTitle: '',
              seoDescription: '',
            },
            slug: 'poisoned',
            published_at: new Date('2026-09-01T00:00:00Z'),
            created_at: new Date('2026-09-01T00:00:00Z'),
          }],
          rowCount: 1,
        }
      }
      throw new Error(`Unhandled SQL: ${rawSql}`)
    })

    const response = await handleServerRequest(new Request('http://cms.test/posts/poisoned'), { db })
    expect(response.status).toBe(200)
    const html = await response.text()

    expectNothingExecutable(html)
    // The body rendered — so the sanitiser stripped the payload out of real
    // content rather than the outlet coming back empty.
    expect(html).toContain(BENIGN)
    expect(html).toContain('data-instatic-content-region')
  })
})
