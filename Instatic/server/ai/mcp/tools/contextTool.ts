/**
 * get_context — orientation for an MCP agent in one call.
 *
 * Surfaces the two things that silently tripped up live use:
 *   1. which live workspaces are connected (browser tools need the matching
 *      Site or Content bridge), and
 *   2. which "everywhere" / post-type templates wrap pages (so the agent isn't
 *      surprised by a nav/footer it didn't author).
 *
 * Headless: editor presence comes from the bridge registry; templates + author
 * come straight from the DB. No browser snapshot.
 */
import { Type } from '@core/utils/typeboxHelpers'
import { BRAND_NAME } from '@core/brand'
import { parseTemplateTarget } from '@core/page-tree'
import type { CoreCapability } from '@core/capabilities'
import type { AiTool, ToolContext } from '../../runtime/types'
import { getDraftSite } from '../../../repositories/site'
import { hasEditorBridge } from '../editorBridge'

const CONTEXT_READ_CAPS: readonly CoreCapability[] = [
  'site.read',
  'content.manage',
  'data.system.tables.read',
  'data.custom.tables.read',
  'pages.edit',
]

const GetContextInput = Type.Object(
  {
    entryId: Type.Optional(
      Type.String({ description: 'Optional page/post entry id — also reports whether a template wraps it.' }),
    ),
  },
  { additionalProperties: false },
)

interface PageCells {
  title?: string
  templateEnabled?: boolean
  /** Object or JSON string — read it through `parseTemplateTarget`, never directly. */
  templateTarget?: unknown
  templatePriority?: number
}

interface PageRow {
  id: string
  table_id: string
  cells_json: PageCells
}

export const contextMcpTools: AiTool[] = [
  {
    name: 'get_context',
    description:
      `Orient yourself before editing: reports whether the ${BRAND_NAME} Site editor and Content workspace are connected (browser tools require their matching workspace), and which templates wrap pages — an "everywhere" template applies a nav/footer/etc. to every page, so anything you author is in addition to it. Pass entryId to also learn whether a template wraps that specific page. Headless — no editor needed. Call this first if a browser tool returns an "open the workspace" error.`,
    scope: 'site',
    execution: 'server',
    inputSchema: GetContextInput,
    requiredCapabilities: CONTEXT_READ_CAPS,
    handler: async (input, ctx: ToolContext) => {
      const { entryId } = input as { entryId?: string }
      const site = await getDraftSite(ctx.db)

      const { rows } = await ctx.db<PageRow>`
        select id, table_id, cells_json
        from data_rows
        where table_id = 'pages' and deleted_at is null
      `
      const templates = rows
        .filter((r) => r.cells_json?.templateEnabled)
        .map((r) => {
          // The cell is declared `longText`, so a bundle-authored template
          // stores it as a JSON string. Reading `.kind` off it directly
          // reported a real template as target "unknown".
          const target = parseTemplateTarget(r.cells_json.templateTarget)
          return {
            id: r.id,
            title: r.cells_json.title ?? r.id,
            target: target?.kind ?? 'unknown',
            tableSlugs: target?.kind === 'postTypes' ? target.tableSlugs : undefined,
            priority: r.cells_json.templatePriority ?? 100,
          }
        })
        .sort((a, b) => a.priority - b.priority)

      const result: Record<string, unknown> = {
        site: site ? { name: site.name } : null,
        editor: {
          siteConnected: hasEditorBridge(ctx.userId, 'site'),
          contentConnected: hasEditorBridge(ctx.userId, 'content'),
        },
        templates,
      }

      if (entryId) {
        const entry = rows.find((r) => r.id === entryId)
        // `everywhere` templates wrap every page; that's the common surprise.
        const wrapping = templates.filter((t) => t.target === 'everywhere')
        result.page = {
          found: Boolean(entry),
          title: entry?.cells_json.title ?? null,
          wrappedByTemplates: wrapping.map((t) => t.title),
        }
      }

      return result
    },
  },
]
