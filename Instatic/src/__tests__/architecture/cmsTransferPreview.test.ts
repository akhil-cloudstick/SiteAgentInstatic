/**
 * Architecture Gate — Site-transfer import preview (diff math)
 *
 * Verifies that `handleImportPreviewRoute` correctly computes the per-table
 * diff against the local database:
 *
 *   inBundle    = bundle rows for this table
 *   willReplace = bundle rows whose id EXISTS locally
 *   willAdd     = bundle rows whose id does NOT exist locally
 *   currentLocal = count of rows currently in the local DB for this table
 *
 * Each test uses a fresh in-memory SQLite database. Auth is seeded directly
 * via repositories.
 *
 * @see server/handlers/cms/importPreview.ts
 * @see src/core/data/bundleSchema.ts
 * @see docs/plans/2026-05-19-site-transfer-ux.md
 */

import { describe, test, expect } from 'bun:test'
import { createSqliteClient } from '../../../server/db/sqlite'
import { runMigrations } from '../../../server/db/runMigrations'
import { sqliteMigrations } from '../../../server/db/migrations-sqlite'
import { saveDraftSite } from '../../../server/repositories/site'
import { createUser } from '../../../server/repositories/users'
import { createSession } from '../../../server/auth/sessions'
import {
  createSessionToken,
  hashSessionToken,
  SESSION_COOKIE_NAME,
  sessionExpiry,
} from '../../../server/auth/tokens'
import { createDataRow } from '../../../server/repositories/data/rows'
import { handleImportPreviewRoute, findUnresolvedClasses } from '../../../server/handlers/cms/importPreview'
import { DEFAULT_IMPORT_STRATEGY } from '../../../server/handlers/cms/importStrategy'
import { parseValue } from '@core/utils/typeboxHelpers'
import { BundlePreviewSchema } from '@core/data/bundleSchema'
import type { DbClient } from '../../../server/db/client'
import type { SiteShell } from '@core/page-tree'
import type { DataRow, DataTable } from '@core/data/schemas'

// ---------------------------------------------------------------------------
// Minimal valid site shell for seeding
// ---------------------------------------------------------------------------

const TEST_SHELL: SiteShell = {
  id: 'default',
  name: 'Preview Test Site',
  breakpoints: [],
  settings: { shortcuts: {} },
  styleRules: {},
  files: [],
  packageJson: { dependencies: {}, devDependencies: {} },
  runtime: {
    dependencyLock: { version: 1, packages: {}, updatedAt: 0 },
    scripts: {},
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

// ---------------------------------------------------------------------------
// seedAuth — seeds site + owner user + session; returns the cookie string
// ---------------------------------------------------------------------------

async function seedAuth(db: DbClient): Promise<string> {
  await saveDraftSite(db, TEST_SHELL)
  await createUser(db, {
    id: 'test-owner',
    email: 'owner@preview.test',
    displayName: 'Test Owner',
    passwordHash: 'placeholder-hash',
    roleId: 'owner',
    allowOwnerRole: true,
  })
  const token = createSessionToken()
  await createSession(db, {
    idHash: await hashSessionToken(token),
    userId: 'test-owner',
    expiresAt: sessionExpiry(),
    ipAddress: null,
    userAgent: null,
  })
  return `${SESSION_COOKIE_NAME}=${token}`
}

// ---------------------------------------------------------------------------
// Helpers to construct minimal-valid bundle objects
// ---------------------------------------------------------------------------

function bundleTableEntry(id: string, name: string, kind: DataTable['kind'] = 'postType'): DataTable {
  const now = new Date().toISOString()
  return {
    id,
    name,
    slug: id,
    kind,
    singularLabel: name,
    pluralLabel: `${name}s`,
    routeBase: `/${id}`,
    primaryFieldId: 'title',
    fields: [],
    system: id === 'posts' || id === 'pages' || id === 'components',
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: now,
    updatedAt: now,
  }
}

function bundleRowEntry(id: string, tableId: string, slug: string = ''): DataRow {
  const now = new Date().toISOString()
  return {
    id,
    tableId,
    cells: { slug },
    slug,
    status: 'draft',
    authorUserId: null,
    createdByUserId: null,
    updatedByUserId: null,
    publishedByUserId: null,
    author: null,
    createdBy: null,
    updatedBy: null,
    publishedBy: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    scheduledPublishAt: null,
    deletedAt: null,
  }
}

/**
 * A preview request.
 *
 * `strategy` defaults to `merge-overwrite` because the suites below measure
 * merge diffs — willReplace, willAdd, slug conflicts — and those only mean
 * anything under a merge. It used to be omitted, which silently asserted that
 * an absent `?strategy=` means "merge". Both import endpoints read an absent
 * one as `replace`, so that assumption was the bug rather than the contract:
 * it let preview describe a row-by-row merge for a run that wipes first.
 * Naming the strategy keeps these tests about diffing, and leaves the default
 * to the suite that actually tests the default.
 */
function makePreviewRequest(
  cookie: string,
  bundle: unknown,
  strategy: string | null = 'merge-overwrite',
): Request {
  // The `cookie` header is a forbidden header per WHATWG Fetch spec and is
  // stripped by Bun's Request constructor in test mode. Set it after construction.
  const query = strategy === null ? '' : `?strategy=${strategy}`
  const req = new Request(`http://localhost/cms/api/cms/import/preview${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bundle),
  })
  req.headers.set('cookie', cookie)
  return req
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleImportPreviewRoute — empty local + non-empty bundle', () => {
  test('willReplace=0, all bundle rows are willAdd', async () => {
    const db = createSqliteClient(':memory:')
    await runMigrations(db, sqliteMigrations)
    const cookie = await seedAuth(db)

    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceSiteName: 'Source',
      tables: [bundleTableEntry('posts', 'Posts')],
      rows: [
        bundleRowEntry('row-a', 'posts', 'row-a'),
        bundleRowEntry('row-b', 'posts', 'row-b'),
        bundleRowEntry('row-c', 'posts', 'row-c'),
      ],
    }

    const req = makePreviewRequest(cookie, bundle)
    const res = await handleImportPreviewRoute(req, db)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)

    const body = JSON.parse(await res!.text())
    const preview = parseValue(BundlePreviewSchema, body)

    const postsEntry = preview.tables.find((t) => t.id === 'posts')
    expect(postsEntry).toBeDefined()
    expect(postsEntry!.inBundle).toBe(3)
    expect(postsEntry!.willReplace).toBe(0)
    expect(postsEntry!.willAdd).toBe(3)
    expect(postsEntry!.currentLocal).toBe(0)
  })
})

describe('handleImportPreviewRoute — 2 of 5 local rows overlap with bundle', () => {
  test('willReplace=2 for the overlapping rows', async () => {
    const db = createSqliteClient(':memory:')
    await runMigrations(db, sqliteMigrations)
    const cookie = await seedAuth(db)

    // Seed 5 posts locally — 2 of them will share IDs with the bundle
    const local1 = await createDataRow(db, { tableId: 'posts', cells: {}, slug: 'l1' })
    const local2 = await createDataRow(db, { tableId: 'posts', cells: {}, slug: 'l2' })
    const overlap1 = await createDataRow(db, { tableId: 'posts', cells: {}, slug: 'o1' })
    const overlap2 = await createDataRow(db, { tableId: 'posts', cells: {}, slug: 'o2' })
    const local5 = await createDataRow(db, { tableId: 'posts', cells: {}, slug: 'l5' })

    // Bundle contains 4 rows: 2 overlap with local, 2 are new
    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: [bundleTableEntry('posts', 'Posts')],
      rows: [
        bundleRowEntry(overlap1.id, 'posts', 'o1'),
        bundleRowEntry(overlap2.id, 'posts', 'o2'),
        bundleRowEntry('bundle-new-a', 'posts', 'bn-a'),
        bundleRowEntry('bundle-new-b', 'posts', 'bn-b'),
      ],
    }

    // Suppress TS unused-variable warning — we seeded these rows to build the local state
    void local1; void local2; void local5

    const req = makePreviewRequest(cookie, bundle)
    const res = await handleImportPreviewRoute(req, db)
    const body = JSON.parse(await res!.text())
    const preview = parseValue(BundlePreviewSchema, body)

    const postsEntry = preview.tables.find((t) => t.id === 'posts')
    expect(postsEntry).toBeDefined()
    expect(postsEntry!.inBundle).toBe(4)
    expect(postsEntry!.willReplace).toBe(2)
    expect(postsEntry!.willAdd).toBe(2)
    expect(postsEntry!.currentLocal).toBe(5)
  })
})

describe('handleImportPreviewRoute — row slug conflicts', () => {
  test('suggests a slug that is free locally and within the incoming bundle', async () => {
    const db = createSqliteClient(':memory:')
    await runMigrations(db, sqliteMigrations)
    const cookie = await seedAuth(db)

    await createDataRow(db, { tableId: 'posts', cells: { title: 'Local', slug: 'shared' }, slug: 'shared' })

    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: [bundleTableEntry('posts', 'Posts')],
      rows: [
        bundleRowEntry('bundle-conflict', 'posts', 'shared'),
        bundleRowEntry('bundle-suffix', 'posts', 'shared-2'),
      ],
    }

    const req = makePreviewRequest(cookie, bundle)
    const res = await handleImportPreviewRoute(req, db)
    const body = JSON.parse(await res!.text())
    const preview = parseValue(BundlePreviewSchema, body)

    expect(preview.rowConflicts).toHaveLength(1)
    expect(preview.rowConflicts?.[0]).toMatchObject({
      tableId: 'posts',
      rowId: 'bundle-conflict',
      slug: 'shared',
      suggestedSlug: 'shared-3',
    })
  })
})

describe('handleImportPreviewRoute — bundle table not present locally', () => {
  test('currentLocal=0 for a table that exists only in the bundle', async () => {
    const db = createSqliteClient(':memory:')
    await runMigrations(db, sqliteMigrations)
    const cookie = await seedAuth(db)

    // 'custom-xyz' does not exist in the local DB
    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: [bundleTableEntry('custom-xyz', 'Custom XYZ', 'data')],
      rows: [
        bundleRowEntry('cx-row-1', 'custom-xyz'),
        bundleRowEntry('cx-row-2', 'custom-xyz'),
      ],
    }

    const req = makePreviewRequest(cookie, bundle)
    const res = await handleImportPreviewRoute(req, db)
    const body = JSON.parse(await res!.text())
    const preview = parseValue(BundlePreviewSchema, body)

    const entry = preview.tables.find((t) => t.id === 'custom-xyz')
    expect(entry).toBeDefined()
    expect(entry!.inBundle).toBe(2)
    expect(entry!.willReplace).toBe(0)
    expect(entry!.willAdd).toBe(2)
    expect(entry!.currentLocal).toBe(0)
  })
})

describe('handleImportPreviewRoute — totals.mediaEmbedded', () => {
  test('mediaEmbedded=true when bundle has media array', async () => {
    const db = createSqliteClient(':memory:')
    await runMigrations(db, sqliteMigrations)
    const cookie = await seedAuth(db)

    const fakeMedia = [
      {
        id: 'media-1',
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 50000,
        altText: '',
        caption: '',
        title: '',
        tags: [],
        width: 800,
        height: 600,
        durationMs: null,
        dominantColor: null,
        blurHash: null,
        storagePath: 'photo.jpg',
        posterPath: null,
        bytesBase64: 'abc123',
        folderIds: [],
      },
      {
        id: 'media-2',
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1000000,
        altText: '',
        caption: '',
        title: '',
        tags: [],
        width: null,
        height: null,
        durationMs: 5000,
        dominantColor: null,
        blurHash: null,
        storagePath: 'video.mp4',
        posterPath: null,
        bytesBase64: 'xyz789',
        folderIds: [],
      },
    ]

    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: [bundleTableEntry('posts', 'Posts')],
      rows: [bundleRowEntry('r1', 'posts')],
      media: fakeMedia,
    }

    const req = makePreviewRequest(cookie, bundle)
    const res = await handleImportPreviewRoute(req, db)
    const body = JSON.parse(await res!.text())
    const preview = parseValue(BundlePreviewSchema, body)

    expect(preview.totals.mediaEmbedded).toBe(true)
    expect(preview.totals.mediaFiles).toBe(2)
  })

  test('mediaEmbedded=false when bundle has no media field', async () => {
    const db = createSqliteClient(':memory:')
    await runMigrations(db, sqliteMigrations)
    const cookie = await seedAuth(db)

    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: [bundleTableEntry('posts', 'Posts')],
      rows: [bundleRowEntry('r1', 'posts')],
      // no media field
    }

    const req = makePreviewRequest(cookie, bundle)
    const res = await handleImportPreviewRoute(req, db)
    const body = JSON.parse(await res!.text())
    const preview = parseValue(BundlePreviewSchema, body)

    expect(preview.totals.mediaEmbedded).toBe(false)
    expect(preview.totals.mediaFiles).toBe(0)
  })
})

describe('handleImportPreviewRoute — meta fields', () => {
  test('meta reflects the bundle exportedAt and sourceSiteName', async () => {
    const db = createSqliteClient(':memory:')
    await runMigrations(db, sqliteMigrations)
    const cookie = await seedAuth(db)

    const exportedAt = '2026-05-19T10:00:00.000Z'
    const bundle = {
      schemaVersion: 1,
      exportedAt,
      sourceSiteName: 'My Production Site',
      tables: [],
      rows: [],
    }

    const req = makePreviewRequest(cookie, bundle)
    const res = await handleImportPreviewRoute(req, db)
    const body = JSON.parse(await res!.text())
    const preview = parseValue(BundlePreviewSchema, body)

    expect(preview.meta.exportedAt).toBe(exportedAt)
    expect(preview.meta.sourceSiteName).toBe('My Production Site')
    expect(preview.meta.schemaVersion).toBe(1)
  })

  test('sourceSiteName is null when absent from bundle', async () => {
    const db = createSqliteClient(':memory:')
    await runMigrations(db, sqliteMigrations)
    const cookie = await seedAuth(db)

    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: [],
      rows: [],
      // no sourceSiteName
    }

    const req = makePreviewRequest(cookie, bundle)
    const res = await handleImportPreviewRoute(req, db)
    const body = JSON.parse(await res!.text())
    const preview = parseValue(BundlePreviewSchema, body)

    expect(preview.meta.sourceSiteName).toBeNull()
  })
})

describe('handleImportPreviewRoute — totals.rows', () => {
  test('totals.rows equals bundle.rows.length', async () => {
    const db = createSqliteClient(':memory:')
    await runMigrations(db, sqliteMigrations)
    const cookie = await seedAuth(db)

    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: [bundleTableEntry('posts', 'Posts')],
      rows: [
        bundleRowEntry('r1', 'posts'),
        bundleRowEntry('r2', 'posts'),
        bundleRowEntry('r3', 'posts'),
      ],
    }

    const req = makePreviewRequest(cookie, bundle)
    const res = await handleImportPreviewRoute(req, db)
    const body = JSON.parse(await res!.text())
    const preview = parseValue(BundlePreviewSchema, body)

    expect(preview.totals.rows).toBe(3)
  })
})

describe('handleImportPreviewRoute — auth', () => {
  test('returns 401 when no session cookie', async () => {
    const db = createSqliteClient(':memory:')
    await runMigrations(db, sqliteMigrations)
    await seedAuth(db)

    const bundle = { schemaVersion: 1, exportedAt: new Date().toISOString(), tables: [], rows: [] }
    // Deliberately no cookie set on this request
    const req = new Request('http://localhost/cms/api/cms/import/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundle),
    })
    const res = await handleImportPreviewRoute(req, db)
    expect(res!.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// The default strategy — the one thing preview and import must never disagree on
// ---------------------------------------------------------------------------

describe('handleImportPreviewRoute — an absent ?strategy=', () => {
  test('resolves the same way the import endpoints resolve it', async () => {
    const db = createSqliteClient(':memory:')
    await runMigrations(db, sqliteMigrations)
    const cookie = await seedAuth(db)

    // Two local rows the bundle also carries. Under a merge they are
    // willReplace=2 against currentLocal=2; under `replace` the wipe removes
    // them before anything is inserted, so they are willAdd against nothing.
    const overlap1 = await createDataRow(db, { tableId: 'posts', cells: {}, slug: 'o1' })
    const overlap2 = await createDataRow(db, { tableId: 'posts', cells: {}, slug: 'o2' })

    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: [bundleTableEntry('posts', 'Posts')],
      rows: [
        bundleRowEntry(overlap1.id, 'posts', 'o1'),
        bundleRowEntry(overlap2.id, 'posts', 'o2'),
      ],
    }

    const res = await handleImportPreviewRoute(makePreviewRequest(cookie, bundle, null), db)
    const preview = parseValue(BundlePreviewSchema, JSON.parse(await res!.text()))
    const postsEntry = preview.tables.find((t) => t.id === 'posts')

    // Both import endpoints read an absent `?strategy=` as `replace`, so the
    // default preview must describe the wipe. If this ever reads willReplace=2,
    // preview has drifted back to describing a merge the import will not do —
    // a dry run reporting an operation that never happens.
    expect(DEFAULT_IMPORT_STRATEGY).toBe('replace')
    expect(postsEntry).toBeDefined()
    expect(postsEntry!.willReplace).toBe(0)
    expect(postsEntry!.willAdd).toBe(2)
    expect(postsEntry!.currentLocal).toBe(0)
    expect(preview.rowConflicts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// unresolvedClasses — the join nobody validated
// ---------------------------------------------------------------------------

describe('findUnresolvedClasses', () => {
  const bundleWith = (styleRules: Record<string, unknown>, classIds: string[]) => ({
    schemaVersion: 1 as const,
    exportedAt: new Date().toISOString(),
    tables: [],
    rows: [{ ...bundleRowEntry('r1', 'pages', 'p'), cells: { body: { rootNodeId: 'n1', nodes: { n1: { classIds } } } } }],
    site: { styleRules },
  })

  test('reports a class whose id matches no rule, with the node count', () => {
    // The v4 shape: rules exist, ids were minted, nothing resolves.
    const found = findUnresolvedClasses(
      bundleWith({ 'style:class:hero': { id: 'style:class:hero', name: 'hero', kind: 'class' } }, ['hero', 'hero']) as never,
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.className).toBe('hero')
    expect(found[0]!.nodeCount).toBe(2)
  })

  test('reports nothing when ids and classIds agree', () => {
    // The v5 shape: id === name, so every reference resolves.
    expect(
      findUnresolvedClasses(bundleWith({ hero: { id: 'hero', name: 'hero', kind: 'class' } }, ['hero']) as never),
    ).toHaveLength(0)
  })

  test('stays silent when the bundle carries no registry at all', () => {
    // Nothing to resolve against. Reporting every class here would be noise,
    // not a finding, and would fire on every bundle that ships no styles.
    expect(findUnresolvedClasses(bundleWith({}, ['hero', 'card']) as never)).toHaveLength(0)
  })
})

describe('destructiveEffects', () => {
  test('a replace preview names the published-version wipe; a merge does not', async () => {
    const db = createSqliteClient(':memory:')
    await runMigrations(db, sqliteMigrations)
    const cookie = await seedAuth(db)
    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: [bundleTableEntry('posts', 'Posts')],
      rows: [bundleRowEntry('a', 'posts', 'a')],
    }

    // The effect that has no count anywhere else in the preview: rows come back
    // from the bundle, the published version comes back from nothing.
    const replaceRes = await handleImportPreviewRoute(makePreviewRequest(cookie, bundle, 'replace'), db)
    const replaced = parseValue(BundlePreviewSchema, JSON.parse(await replaceRes!.text()))
    expect(replaced.destructiveEffects?.join(' ')).toContain('published version')

    const mergeRes = await handleImportPreviewRoute(makePreviewRequest(cookie, bundle, 'merge-overwrite'), db)
    const merged = parseValue(BundlePreviewSchema, JSON.parse(await mergeRes!.text()))
    expect(merged.destructiveEffects ?? []).toHaveLength(0)
  })
})
