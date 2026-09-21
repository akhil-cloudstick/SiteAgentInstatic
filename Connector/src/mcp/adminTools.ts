/**
 * Schema, media, bulk and session-elevation tools.
 *
 * Everything here existed in the CMS already and was simply unreachable through
 * the connector. The gaps were not theoretical: adding an SEO field meant
 * editing by hand, and removing several hundred rows meant several hundred
 * calls.
 */

import { readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import type { ConnectorTool, ToolResult } from './tools'
import { requireSession } from '../http/store'
import { InstaticHttpError, type InstaticSession } from '../http/session'
import { resolveTarget } from '../http/config'
import { reachableFrom } from './requestContext'
import { deleteRow, publishRow, withTableSlug } from '../http/rows'
import { GO_INPUT_PROP } from '../go/message'
import { runGated } from './goTool'
import {
  stepUp,
  getTable,
  createTable,
  addTableFields,
  uploadMedia,
  listMedia,
  getSiteShell,
  installGoogleFont,
  saveSiteShell,
  type DataField,
  type FontEntry,
  type SiteShell,
} from '../http/admin'

/**
 * Where the control plane listens.
 *
 * Site creation is the one operation that is not a call to a CMS instance — a
 * site does not exist until the control plane has provisioned a schema, a role
 * and a runtime for it. Configurable because the connector does not always run
 * on the same host, and defaulted because it usually does.
 */
const CONTROL_PLANE_URL_ENV = 'MMS_CONTROL_PLANE_URL'
const controlPlaneUrl = (): string =>
  (process.env[CONTROL_PLANE_URL_ENV] ?? 'http://127.0.0.1:4400').replace(/\/+$/, '')

/**
 * The control plane refuses its admin routes without a signed-in administrator
 * (R14). Site creation is the one it accepts from the connector instead, on the
 * same bearer the connector already uses for its managed-target list.
 */
const CONTROL_PLANE_TOKEN_ENV = 'MMS_CONNECTOR_MCP_TOKEN'
const controlPlaneAuth = (): Record<string, string> => {
  const token = process.env[CONTROL_PLANE_TOKEN_ENV]?.trim()
  return token ? { authorization: `Bearer ${token}` } : {}
}

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})

const fail = (message: string, detail?: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message, detail }, null, 2) }],
  isError: true,
})

async function guarded(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn()
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const targetProp = {
  type: 'string',
  description: 'Which configured CMS. Required when more than one is configured.',
} as const

/** Extension → MIME, for the handful of types a site actually uploads. */
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

/**
 * The SEO fields a site needs to keep its indexed URLs, none of which exist in
 * the stock schema. Shared here so `pages` and `posts` get an identical set —
 * two nearly-identical hand-written lists would drift.
 */
export const SEO_FIELDS: DataField[] = [
  { id: 'canonicalUrl', type: 'url', label: 'Canonical URL' },
  { id: 'ogTitle', type: 'text', label: 'Open Graph title' },
  { id: 'ogDescription', type: 'longText', label: 'Open Graph description' },
  { id: 'ogImage', type: 'media', label: 'Open Graph image' },
  { id: 'jsonLd', type: 'longText', label: 'JSON-LD structured data' },
]

interface FontRequest {
  family: string
  variants: string[]
  subsets: string[]
}

interface FontResult {
  family: string
  status: 'installed' | 'already-installed' | 'failed'
  id?: string
  variants?: string[]
  subsets?: string[]
  files?: number
  error?: string
}

function parseFontRequests(raw: unknown): FontRequest[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'fonts is empty.'
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []
  const requests: FontRequest[] = []
  for (const item of raw) {
    const r = (item ?? {}) as Record<string, unknown>
    const family = str(r.family).trim()
    if (!family) return 'Every font needs a family.'
    const variants = strings(r.variants)
    if (variants.length === 0) return `${family}: variants is empty.`
    const subsets = strings(r.subsets)
    requests.push({ family, variants, subsets: subsets.length > 0 ? subsets : ['latin'] })
  }
  return requests
}

const unionOf = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])]

function googleFontIn(site: SiteShell, family: string): FontEntry | undefined {
  const lower = family.toLowerCase()
  return site.settings?.fonts?.items?.find((f) => f.source === 'google' && f.family.toLowerCase() === lower)
}

/**
 * The shell with these entries in its font library, merged the way the editor's
 * font picker merges them: a re-installed family replaces its entry rather than
 * adding a second, and tokens pointing at the old entry follow it to the new id.
 */
function withFonts(site: SiteShell, entries: readonly FontEntry[]): SiteShell {
  const settings = site.settings ?? {}
  const items = [...(settings.fonts?.items ?? [])]
  const tokens = settings.fonts?.tokens?.map((token) => ({ ...token }))
  for (const entry of entries) {
    const lower = entry.family.toLowerCase()
    const index = items.findIndex(
      (f) => f.id === entry.id || (f.source === entry.source && f.family.toLowerCase() === lower),
    )
    if (index < 0) {
      items.push(entry)
      continue
    }
    const previousId = items[index]!.id
    items[index] = { ...entry, updatedAt: Date.now() }
    for (const token of tokens ?? []) {
      if (token.familyId === previousId) token.familyId = entry.id
    }
  }
  return {
    ...site,
    settings: { ...settings, fonts: { ...settings.fonts, items, ...(tokens ? { tokens } : {}) } },
  }
}


/**
 * What a site's font library actually holds, and which token resolves to what.
 *
 * R12's criterion is that a family the design uses still works after a replace.
 * Until this existed, the only way to check that was to look at the rendered
 * page — the same "somebody eyeballs it" dependency the whole phase is removing.
 * Read-only; the numbers here are what an acceptance run asserts on.
 */
async function listFonts(session: InstaticSession): Promise<{
  fonts: { id: string; family: string; source: string; variants: string[]; subsets: string[]; files: number }[]
  tokens: { variable: string; family: string | null }[]
}> {
  const { site } = await getSiteShell(session)
  const items = site.settings?.fonts?.items ?? []
  return {
    fonts: items.map((f) => ({
      id: f.id,
      family: f.family,
      source: f.source,
      variants: f.variants ?? [],
      subsets: f.subsets ?? [],
      // A registry entry whose files are gone renders nothing, so the count is
      // reported rather than assumed.
      files: f.files?.length ?? 0,
    })),
    tokens: (site.settings?.fonts?.tokens ?? []).map((t) => ({
      variable: t.variable,
      // A token pointing at a family that is no longer installed resolves to
      // its bare fallback stack — text that silently loses its typeface. Null
      // here is exactly that case, named.
      family: items.find((f) => f.id === t.familyId)?.family ?? null,
    })),
  }
}
async function installGoogleFonts(
  session: InstaticSession,
  requests: readonly FontRequest[],
): Promise<{ fonts: FontResult[]; saved: boolean; seq?: number }> {
  let { site, seq } = await getSiteShell(session)
  const results: FontResult[] = []
  const installed: FontEntry[] = []

  for (const request of requests) {
    const current = googleFontIn(site, request.family)
    if (
      current &&
      current.files.length > 0 &&
      request.variants.every((v) => current.variants.includes(v)) &&
      request.subsets.every((s) => current.subsets.includes(s))
    ) {
      results.push({
        family: current.family,
        status: 'already-installed',
        id: current.id,
        variants: current.variants,
        subsets: current.subsets,
        files: current.files.length,
      })
      continue
    }
    try {
      const entry = await installGoogleFont(session, {
        family: request.family,
        // The CMS wipes the family's files before writing, so keep what is already there.
        variants: unionOf(current?.variants ?? [], request.variants),
        subsets: unionOf(current?.subsets ?? [], request.subsets),
      })
      installed.push(entry)
      results.push({
        family: entry.family,
        status: 'installed',
        id: entry.id,
        variants: entry.variants,
        subsets: entry.subsets,
        files: entry.files.length,
      })
    } catch (err) {
      // Keep going: one family the CMS refuses should not cost the others.
      results.push({ family: request.family, status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (installed.length === 0) return { fonts: results, saved: false }

  // One retry. A 409 means another session changed the shell after it was
  // read; the downloaded entries are merged onto the fresh shell, not re-installed.
  for (let attempt = 0; ; attempt++) {
    try {
      const saved = await saveSiteShell(session, withFonts(site, installed), seq)
      return { fonts: results, saved: true, seq: saved.seq }
    } catch (err) {
      if (attempt === 0 && err instanceof InstaticHttpError && err.status === 409) {
        ;({ site, seq } = await getSiteShell(session))
        continue
      }
      throw new Error(
        `The font files were downloaded but the site settings were not saved, so the site does not ` +
          `use them yet. Re-run to retry. ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

export const ADMIN_TOOLS: ConnectorTool[] = [
  {
    name: 'connector_step_up',
    description:
      'Re-authenticate for a destructive or schema-changing operation. Required before a ' +
      'clean-site import, a full-site publish, and table or field changes. Uses the credential ' +
      'held on the server; supply mfaCode only if the account requires one. The session cookie ' +
      'rotates, which the connector handles.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        mfaCode: { type: 'string', description: 'Only if the account has MFA enabled.' },
      },
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const target = resolveTarget(str(a.target) || undefined)
        const session = requireSession(target.name)
        // The credential comes from server configuration, never from arguments.
        await stepUp(session, target.secret, str(a.mfaCode) || undefined)
        return ok({ steppedUp: target.name })
      }),
  },

  {
    name: 'connector_delete_rows',
    description:
      'Delete MANY rows in one call. DESTRUCTIVE AND NOT REVERSIBLE — no undo, no trash. ' +
      'Requires confirm to be exactly "DELETE <count> FROM <target>". Reports each row ' +
      'individually so a partial failure is visible rather than hidden. If the intent is to take ' +
      'pages off the site while keeping them, use connector_set_row_status with unpublished. On a ' +
      'gated target it also requires go — one owner-signed GO for delete whose sha256 is ' +
      'connector_rows_digest of exactly these rows.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        rowIds: { type: 'array', items: { type: 'string' }, description: 'Row ids to delete.' },
        confirm: {
          type: 'string',
          description: 'Exactly "DELETE <count> FROM <target>", e.g. "DELETE 12 FROM staging".',
        },
        go: GO_INPUT_PROP,
      },
      required: ['rowIds', 'confirm'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const target = str(a.target)
        const rowIds = Array.isArray(a.rowIds) ? (a.rowIds as string[]) : []
        if (rowIds.length === 0) return fail('rowIds is empty.')

        // The count is in the phrase so a confirmation cannot be reused for a
        // larger batch than the one it was written for.
        const expected = `DELETE ${rowIds.length} FROM ${target}`
        if (str(a.confirm) !== expected) {
          return fail(
            `Refused. confirm must be exactly "${expected}". ` +
              `This permanently removes ${rowIds.length} row(s) from "${target}".`,
          )
        }

        const session = requireSession(target)
        // One GO for the whole batch: its sha256 is the rows digest of exactly
        // this set, so it cannot delete a row it did not name.
        return runGated(a, 'delete', { kind: 'rows', session, rowIds }, async () => {
          const deleted: string[] = []
          const failed: { rowId: string; error: string }[] = []
          for (const rowId of rowIds) {
            try {
              await deleteRow(session, rowId)
              deleted.push(rowId)
            } catch (err) {
              // Keep going: stopping at the first failure leaves the caller
              // unable to tell which rows went and which stayed.
              failed.push({ rowId, error: err instanceof Error ? err.message : String(err) })
            }
          }
          return { requested: rowIds.length, deleted: deleted.length, failed }
        })
      }),
  },

  {
    name: 'connector_publish_rows',
    description:
      'PUBLISH MANY rows in one call — each becomes publicly visible immediately, with no ' +
      'previous-version rollback. Reports each row individually so a partial failure is visible ' +
      'rather than hidden. On a gated target it requires go — ONE owner-signed GO for publish-row ' +
      'whose sha256 is connector_rows_digest of exactly these rows, taken after their last edit.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        rowIds: { type: 'array', items: { type: 'string' }, description: 'Row ids to publish.' },
        go: GO_INPUT_PROP,
      },
      required: ['rowIds'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const rowIds = Array.isArray(a.rowIds) ? (a.rowIds as unknown[]).map(String) : []
        if (rowIds.length === 0) return fail('rowIds is empty.')
        const session = requireSession(str(a.target))
        // One GO for the set, bound to the digest of exactly these rows — the
        // same shape as connector_delete_rows, so eight articles need one
        // signature rather than eight.
        return runGated(a, 'publish-row', { kind: 'rows', session, rowIds }, async () => {
          const published: string[] = []
          const failed: { rowId: string; error: string }[] = []
          for (const rowId of rowIds) {
            try {
              await publishRow(session, rowId)
              published.push(rowId)
            } catch (err) {
              // Keep going, for the same reason as delete_rows: stopping at the
              // first failure hides which rows went live and which did not.
              failed.push({ rowId, error: err instanceof Error ? err.message : String(err) })
            }
          }
          return { requested: rowIds.length, published: published.length, failed }
        })
      }),
  },

  {
    name: 'connector_get_table',
    description:
      'Fetch one table with its complete field definitions. Read-only. Use before changing ' +
      'fields, so the change is made against what is actually there.',
    inputSchema: {
      type: 'object',
      properties: { target: targetProp, tableId: { type: 'string' } },
      required: ['tableId'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const session = requireSession(str(a.target))
        return ok(await withTableSlug(session, str(a.tableId), (tableId) => getTable(session, tableId)))
      }),
  },

  {
    name: 'connector_create_table',
    description:
      'Create a content table. WRITES, and changes the public URL surface, so it needs a recent ' +
      'connector_step_up. kind "postType" gives a routed collection whose entries have their own ' +
      'URLs — those entries return 404 until an entry template exists, so pair it with ' +
      'connector_create_entry_template. kind "data" is unrouted, which is what tags and ' +
      'categories want.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        name: { type: 'string' },
        slug: { type: 'string', description: 'Do not use "posts" — reserved.' },
        kind: { type: 'string', enum: ['data', 'postType'] },
        routeBase: { type: 'string', description: 'URL prefix for postType, e.g. /blog' },
        singularLabel: { type: 'string' },
        pluralLabel: { type: 'string' },
      },
      required: ['name', 'slug', 'kind'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () =>
        ok(
          await createTable(requireSession(str(a.target)), {
            name: str(a.name),
            slug: str(a.slug),
            kind: a.kind === 'postType' ? 'postType' : 'data',
            routeBase: str(a.routeBase) || undefined,
            singularLabel: str(a.singularLabel) || undefined,
            pluralLabel: str(a.pluralLabel) || undefined,
          }),
        ),
      ),
  },

  {
    name: 'connector_add_table_fields',
    description:
      'Add or update custom fields on a table. WRITES schema, so it needs a recent ' +
      'connector_step_up. Existing fields are preserved — the current field list is read and the ' +
      'new ones merged in, because the underlying update replaces the array wholesale. Built-in ' +
      'fields are protected by the server and cannot be removed.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        tableId: { type: 'string' },
        fields: {
          type: 'array',
          description: 'Field definitions: { id, type, label }.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: {
                type: 'string',
                description:
                  'text, longText, richText, number, boolean, date, dateTime, select, ' +
                  'multiSelect, url, email, media, relation, repeater',
              },
              label: { type: 'string' },
            },
            required: ['id', 'type', 'label'],
          },
        },
      },
      required: ['tableId', 'fields'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const session = requireSession(str(a.target))
        return ok(
          await withTableSlug(session, str(a.tableId), (tableId) =>
            addTableFields(session, tableId, (a.fields as DataField[]) ?? []),
          ),
        )
      }),
  },

  {
    name: 'connector_add_seo_fields',
    description:
      'Add the standard SEO field set — canonical URL, Open Graph title, description and image, ' +
      'and JSON-LD — to a table in one call. WRITES schema; needs a recent connector_step_up. ' +
      'NOT NEEDED for pages or posts on a current project: these are part of the stock schema now, ' +
      'so a fresh site can set them with no extra step. Re-running is harmless (a field that ' +
      'already exists is left alone). Still the right call for a project created before that, or ' +
      'to put the same set on a custom table.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        tableId: { type: 'string', description: 'Usually pages or posts.' },
      },
      required: ['tableId'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const session = requireSession(str(a.target))
        return ok(
          await withTableSlug(session, str(a.tableId), (tableId) => addTableFields(session, tableId, SEO_FIELDS)),
        )
      }),
  },

  {
    name: 'connector_install_google_fonts',
    description:
      'Install Google font families into a site, so CSS that names the family (font-family: ' +
      '"Space Grotesk") uses it. The CMS downloads the woff2 files and serves them itself; ' +
      'published pages never load Google. WRITES the draft site settings (settings.fonts) — ' +
      'nothing is public until the next publish, and on a gated target that publish GO must be ' +
      'taken after this call. Safe to re-run: a family already installed with every requested ' +
      'variant and subset is skipped. A replace import now KEEPS the families the incoming design ' +
      'still refers to and drops only the rest, so re-running after one is needed only for a ' +
      'family the design uses without naming it anywhere in its CSS. Variants use Google names: ' +
      '"400", "700", "400italic". connector_list_fonts reports what a site actually has.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        fonts: {
          type: 'array',
          description: 'e.g. [{ "family": "Space Grotesk", "variants": ["400", "700"], "subsets": ["latin"] }]',
          items: {
            type: 'object',
            properties: {
              family: { type: 'string', description: 'The exact Google family name.' },
              variants: { type: 'array', items: { type: 'string' } },
              subsets: { type: 'array', items: { type: 'string' }, description: 'Defaults to ["latin"].' },
            },
            required: ['family', 'variants'],
          },
        },
      },
      required: ['fonts'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const requests = parseFontRequests(a.fonts)
        if (typeof requests === 'string') return fail(requests)
        return ok(await installGoogleFonts(requireSession(str(a.target)), requests))
      }),
  },

  {
    name: 'connector_list_fonts',
    description:
      'The font families a site has installed, with their variants, subsets and file counts, and ' +
      'what each font token resolves to. Read-only. Use it to confirm a family survived a replace ' +
      'import, and to catch a token whose family reports null — that text has silently lost its ' +
      'typeface and falls back to a generic stack.',
    inputSchema: {
      type: 'object',
      properties: { target: targetProp },
      additionalProperties: false,
    },
    handler: async (a) => guarded(async () => ok(await listFonts(requireSession(str(a.target))))),
  },

  {
    name: 'connector_list_media',
    description: 'List media assets in the library. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { target: targetProp },
      additionalProperties: false,
    },
    handler: async (a) => guarded(async () => ok(await listMedia(requireSession(str(a.target))))),
  },

  {
    name: 'connector_upload_media',
    description:
      'Upload a file from a local path into the media library. WRITES. Returns the media id, ' +
      'which is what image and featured-image fields store.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        path: { type: 'string', description: 'Absolute path to the file on the server.' },
        fileName: { type: 'string', description: 'Optional override for the stored name.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const filePath = resolve(str(a.path))
        const bytes = new Uint8Array(readFileSync(filePath))
        const name = str(a.fileName) || basename(filePath)
        const mime = MIME[extname(name).toLowerCase()] ?? 'application/octet-stream'
        return ok(await uploadMedia(requireSession(str(a.target)), name, bytes, mime))
      }),
  },

  {
    name: 'connector_create_site',
    description:
      'Provision a NEW, empty CMS site and return its details. Each site is an isolated instance ' +
      'with its own database schema and its own login — which is why a clean seed needs one of ' +
      'these rather than a wipe of an existing site. Provisioning runs in the background and takes ' +
      'roughly 30-60 seconds. ' +
      'Onboarding is ONE call: a site created here is automatically reachable as a connector ' +
      'target once provisioning finishes. Poll connector_target until the returned slug appears, ' +
      'then connector_connect to it. Nobody needs to configure anything for you. ' +
      'A new site is NOT completely empty: it has the four system tables (pages, posts, ' +
      'components, layouts), no collections, and exactly ONE row — a starter homepage in pages ' +
      '(slug "index", title "Home", draft, unpublished). That seed is deliberate; a site with no ' +
      'homepage has nothing to open. Count it in any baseline diff. import_replace clears it ' +
      'along with everything else.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Display name. The slug is derived from it by lowercasing and replacing each run of ' +
            'non-alphanumeric characters with a single hyphen, e.g. "Global Nettech" -> ' +
            '"global-nettech". Use the returned slug rather than a predicted one.',
        },
        ownerEmail: { type: 'string', description: 'Email of the site owner. Receives the invite link.' },
        customDomain: { type: 'string', description: 'Optional custom domain to attach, e.g. globalnettech.com.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const res = await fetch(`${controlPlaneUrl()}/api/tenants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...controlPlaneAuth() },
          body: JSON.stringify({
            name: str(a.name),
            ownerEmail: str(a.ownerEmail) || undefined,
            customDomain: str(a.customDomain) || undefined,
            tier: 'advanced',
            // Flags the tenant as belonging to whoever holds this connector
            // token, which is what makes it auto-enrol as a target. Tenants
            // created any other way stay invisible here.
            connectorManaged: true,
          }),
        })
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (res.status === 401) {
          return fail(
            `The control plane refused the connector: ${CONTROL_PLANE_TOKEN_ENV} is unset here or ` +
              'does not match the one the control plane holds.',
            body,
          )
        }
        if (!res.ok) {
          return fail(
            typeof body.error === 'string' ? body.error : `Site creation failed (HTTP ${res.status})`,
            body,
          )
        }
        return ok({
          ...body,
          // The control plane mints this against its own base URL, which is
          // loopback on the host it runs on — so as returned it was a link only
          // this machine could open, handed to the one person who is not on it.
          // Re-addressed to whatever host the caller reached us on.
          ...(typeof body.inviteUrl === 'string'
            ? { inviteUrl: reachableFrom(body.inviteUrl) }
            : {}),
          inviteUrlNote:
            'Carries a password-set token — treat as a secret, and share it over a channel you ' +
            'would send a password on. Not needed to use the site through the connector.',
          note:
            'Provisioning continues in the background (~30-60s). Poll connector_target until the ' +
            'slug appears — it enrols itself, no configuration step. Then connector_connect and ' +
            'the site is ready for an import_replace.',
        })
      }),
  },
]
