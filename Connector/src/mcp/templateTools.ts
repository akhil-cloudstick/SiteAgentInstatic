/**
 * Entry templates for routed collections.
 *
 * This closes a trap that is silent and expensive: moving content into a
 * `postType` collection without an entry template makes every entry URL return
 * 404. Nothing warns about it, because from the CMS side the rows are perfectly
 * valid — they simply have nothing to render into.
 *
 * A template is an ordinary `pages` row carrying three extra cells
 * (`templateEnabled`, `templateTarget`, `templatePriority`) and exactly one
 * `base.outlet` node in its tree. Templates are *matched* by target and
 * priority, never referenced by id, so two templates aiming at the same
 * collection at the same priority resolve by document order — which is nobody's
 * intent, and why this refuses to create a duplicate.
 */

import type { ConnectorTool, ToolResult } from './tools'
import { requireSession } from '../http/store'
import { listRows, createRow, type DataRow } from '../http/rows'

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})

const fail = (message: string, detail?: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message, detail }, null, 2) }],
  isError: true,
})

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Short, collision-resistant node id. The tree only needs uniqueness within itself. */
function nodeId(): string {
  return Math.random().toString(36).slice(2, 12)
}

/**
 * Build the minimal template tree: a body root wrapping a heading bound to the
 * entry title, then the outlet the entry body flows into.
 *
 * `dynamicBindings` is what makes the heading show each entry's own title
 * rather than fixed text — `currentEntry` resolves per rendered entry.
 */
function buildTemplateTree(): { nodes: Record<string, unknown>; rootNodeId: string } {
  const rootId = nodeId()
  const headingId = nodeId()
  const outletId = nodeId()

  return {
    rootNodeId: rootId,
    nodes: {
      [rootId]: {
        id: rootId,
        moduleId: 'base.body',
        props: {},
        children: [headingId, outletId],
        classIds: [],
        breakpointOverrides: {},
        parentId: null,
      },
      [headingId]: {
        id: headingId,
        moduleId: 'base.text',
        label: 'Entry title',
        props: { text: 'Entry title', tag: 'h1', htmlAttributes: {} },
        children: [],
        classIds: [],
        breakpointOverrides: {},
        parentId: rootId,
        dynamicBindings: { text: { source: 'currentEntry', field: 'title', format: 'plain' } },
      },
      [outletId]: {
        id: outletId,
        moduleId: 'base.outlet',
        label: 'Entry body',
        props: { tag: 'main', customTag: '', html: '' },
        children: [],
        classIds: [],
        breakpointOverrides: {},
        parentId: rootId,
      },
    },
  }
}

export const TEMPLATE_TOOLS: ConnectorTool[] = [
  {
    name: 'connector_list_templates',
    description:
      'List the template pages and what each one targets. Read-only. A routed collection with no ' +
      'template returns 404 for every entry, so this is the first thing to check when entry URLs ' +
      'are missing.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS.' },
      },
      additionalProperties: false,
    },
    handler: async (a) => {
      try {
        const session = requireSession(str(a.target))
        const body = (await listRows(session, 'pages', { limit: 200, fields: 'full' })) as {
          rows: DataRow[]
        }
        const templates = (body.rows ?? [])
          .filter((r) => r.cells?.templateEnabled === true)
          .map((r) => ({
            rowId: r.id,
            slug: r.slug,
            title: r.cells?.title ?? null,
            target: r.cells?.templateTarget ?? null,
            priority: r.cells?.templatePriority ?? null,
            status: r.status,
          }))
        return ok({ templates, count: templates.length })
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  },

  {
    name: 'connector_create_entry_template',
    description:
      'Create the entry template a routed collection needs. WRITES. Without one, every entry in ' +
      'that collection returns 404 no matter how the rows are published — so this belongs in the ' +
      'same session as creating the collection, not after someone notices the URLs are dead. ' +
      'Builds a page with a title bound to each entry and an outlet for the body. Refuses if a ' +
      'template already targets the same collection at the same priority, because ties resolve ' +
      'by document order rather than by intent.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS.' },
        tableSlugs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Collection slugs this template renders, e.g. ["blog"].',
        },
        title: { type: 'string', description: 'Name for the template page.' },
        slug: { type: 'string', description: 'Slug for the template page.' },
        priority: { type: 'number', description: 'Higher wins. Defaults to 10.' },
      },
      required: ['tableSlugs'],
      additionalProperties: false,
    },
    handler: async (a) => {
      try {
        const session = requireSession(str(a.target))
        const tableSlugs = Array.isArray(a.tableSlugs) ? (a.tableSlugs as string[]) : []
        if (tableSlugs.length === 0) return fail('tableSlugs is empty.')

        const priority = typeof a.priority === 'number' ? a.priority : 10

        // Refuse a duplicate rather than create an ambiguous match.
        const existing = (await listRows(session, 'pages', { limit: 200, fields: 'full' })) as {
          rows: DataRow[]
        }
        const clash = (existing.rows ?? []).find((r) => {
          if (r.cells?.templateEnabled !== true) return false
          if (r.cells?.templatePriority !== priority) return false
          const t = r.cells?.templateTarget as { kind?: string; tableSlugs?: string[] } | undefined
          if (t?.kind !== 'postTypes') return false
          return (t.tableSlugs ?? []).some((s) => tableSlugs.includes(s))
        })
        if (clash) {
          return fail(
            `A template already targets ${tableSlugs.join(', ')} at priority ${priority} ` +
              `(row ${clash.id}, slug "${clash.slug}"). Two templates matching the same ` +
              `collection at the same priority resolve by document order, which is not a ` +
              `decision anyone made. Use a different priority, or edit the existing template.`,
          )
        }

        const tree = buildTemplateTree()
        const title = str(a.title) || `${tableSlugs[0]} entry template`
        const slug = str(a.slug) || `${tableSlugs[0]}-entry-template`

        const row = await createRow(session, 'pages', {
          slug,
          cells: {
            title,
            body: tree,
            templateEnabled: true,
            templateTarget: { kind: 'postTypes', tableSlugs },
            templatePriority: priority,
          },
        })

        return ok({
          created: row.id,
          slug: row.slug,
          targets: tableSlugs,
          priority,
          note:
            'Created as a draft. Publish the site so the template takes effect, then entry URLs ' +
            'resolve instead of returning 404.',
        })
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  },
]
