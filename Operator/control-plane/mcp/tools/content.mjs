// Content + page-structure tools. Every one routes to the tenant's
// `mms.mcp-bridge` plugin, which runs the CMS's canonical engines in-process.
//
// Tool descriptions carry real weight here: an agent has no UI, no sidebar and
// no docs tab. Each one states which tables it applies to, that pages and blog
// posts are just rows, and that writes stay drafts until an explicit publish.
import { pluginCall } from '../session.mjs';

const TABLE_HINT =
  'Content lives in tables. `pages` holds site pages, `posts` holds blog posts/articles, ' +
  '`components` and `layouts` hold reusable pieces; clients may add custom tables ' +
  '(services, team, faqs...). Call cms_list_tables first if unsure.';

const DRAFT_HINT =
  'Writes are DRAFTS. Nothing reaches the live site until cms_publish_entry is called for that entry.';

const str = (description) => ({ type: 'string', description });

export const contentTools = [
  {
    name: 'cms_list_tables',
    permission: 'read',
    description:
      'List every content table with its row count, kind and primary field. Start here when you do not ' +
      'already know the table layout of this site. ' + TABLE_HINT,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => pluginCall(ctx.slug, '/tables/list'),
  },
  {
    name: 'cms_get_table',
    permission: 'read',
    tableArg: 'table',
    description:
      'Read one table\'s full field schema — every field id, label and type. You need this before writing ' +
      'entries, because `cells` keys are field ids from this schema. A field of type `pageTree` is the ' +
      'visual page structure and is edited with cms_read_tree / cms_mutate_tree, never through `cells`.',
    inputSchema: {
      type: 'object',
      properties: { table: str('Table slug, e.g. "pages" or "posts".') },
      required: ['table'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/tables/get', { table: a.table }),
  },
  {
    name: 'cms_list_entries',
    permission: 'read',
    tableArg: 'table',
    description:
      'List entries in a table. Use `options.status` to filter (draft / published / scheduled / any) and ' +
      '`options.limit` + `options.offset` to page through. Returns `{ entries, totalCount }`.',
    inputSchema: {
      type: 'object',
      properties: {
        table: str('Table slug.'),
        options: {
          type: 'object',
          description: 'Optional filter/sort/paging: { filter, orderBy, status, limit (1-500), offset }.',
          additionalProperties: true,
        },
      },
      required: ['table'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/entries/list', { table: a.table, options: a.options }),
  },
  {
    name: 'cms_get_entry',
    permission: 'read',
    tableArg: 'table',
    description: 'Read one entry by id, including all of its field values (`cells`).',
    inputSchema: {
      type: 'object',
      properties: { table: str('Table slug.'), entryId: str('Entry id.') },
      required: ['table', 'entryId'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/entries/get', { table: a.table, entryId: a.entryId }),
  },
  {
    name: 'cms_get_entry_by_slug',
    permission: 'read',
    tableArg: 'table',
    description:
      'Read one entry by its URL slug instead of its id — the usual way to find a known page, ' +
      'e.g. slug "about" in table "pages".',
    inputSchema: {
      type: 'object',
      properties: { table: str('Table slug.'), slug: str('The entry\'s URL slug.') },
      required: ['table', 'slug'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/entries/get-by-slug', { table: a.table, slug: a.slug }),
  },
  {
    name: 'cms_search',
    permission: 'read',
    description: 'Search entries across every table by text. Returns lightweight hits (id, table, slug, status).',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('Search text.'),
        limit: { type: 'integer', description: 'Max hits to return.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/search', { query: a.query, limit: a.limit }),
  },
  {
    name: 'cms_get_published_snapshot',
    permission: 'read',
    description:
      'Read the LIVE published version of an entry, as opposed to the current draft. Use this to compare ' +
      'what visitors see now against unpublished edits.',
    inputSchema: {
      type: 'object',
      properties: { entryId: str('Entry id.') },
      required: ['entryId'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/snapshot', { entryId: a.entryId }),
  },
  {
    name: 'cms_create_entry',
    permission: 'create',
    tableArg: 'table',
    description:
      'Create a new entry — a page in `pages`, a blog post in `posts`, a row in any custom table. ' +
      '`input.cells` maps field ids (from cms_get_table) to values; `input.slug` sets the URL slug. ' +
      DRAFT_HINT,
    inputSchema: {
      type: 'object',
      properties: {
        table: str('Table slug.'),
        input: {
          type: 'object',
          description: 'The new entry: { slug?: string, cells: { [fieldId]: value } }.',
          additionalProperties: true,
        },
      },
      required: ['table', 'input'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/entries/create', { table: a.table, input: a.input }),
  },
  {
    name: 'cms_create_entries',
    permission: 'create',
    tableArg: 'table',
    description: 'Create many entries in one call. `inputs` is an array of the same shape cms_create_entry takes.',
    inputSchema: {
      type: 'object',
      properties: {
        table: str('Table slug.'),
        inputs: { type: 'array', description: 'Array of { slug?, cells }.', items: { type: 'object' } },
      },
      required: ['table', 'inputs'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/entries/create-many', { table: a.table, inputs: a.inputs }),
  },
  {
    name: 'cms_update_entry',
    permission: 'edit',
    tableArg: 'table',
    description:
      'Update an entry\'s fields. `patch.cells` is merged — send only the fields you are changing. ' +
      'To change the visual layout of a page use cms_mutate_tree instead. ' + DRAFT_HINT,
    inputSchema: {
      type: 'object',
      properties: {
        table: str('Table slug.'),
        entryId: str('Entry id.'),
        patch: {
          type: 'object',
          description: 'Changes: { slug?: string, cells?: { [fieldId]: value } }.',
          additionalProperties: true,
        },
      },
      required: ['table', 'entryId', 'patch'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/entries/update', { table: a.table, entryId: a.entryId, patch: a.patch }),
  },
  {
    name: 'cms_update_entries',
    permission: 'edit',
    tableArg: 'table',
    description: 'Update many entries in one call. `updates` is an array of { id, patch }.',
    inputSchema: {
      type: 'object',
      properties: {
        table: str('Table slug.'),
        updates: { type: 'array', description: 'Array of { id, patch }.', items: { type: 'object' } },
      },
      required: ['table', 'updates'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/entries/update-many', { table: a.table, updates: a.updates }),
  },
  {
    name: 'cms_move_entry',
    permission: 'edit',
    tableArg: 'table',
    description: 'Move an entry to a different table, e.g. promote a row from a staging table into `posts`.',
    inputSchema: {
      type: 'object',
      properties: {
        table: str('Current table slug.'),
        entryId: str('Entry id.'),
        targetTable: str('Destination table slug.'),
      },
      required: ['table', 'entryId', 'targetTable'],
      additionalProperties: false,
    },
    run: (ctx, a) =>
      pluginCall(ctx.slug, '/entries/move', { table: a.table, entryId: a.entryId, targetTable: a.targetTable }),
  },
  {
    name: 'cms_delete_entry',
    permission: 'delete',
    tableArg: 'table',
    description:
      'Soft-delete an entry. It moves to Trash and a human can restore it from the CMS UI, so this is ' +
      'recoverable — but it does remove the page from the site on the next publish.',
    inputSchema: {
      type: 'object',
      properties: { table: str('Table slug.'), entryId: str('Entry id.') },
      required: ['table', 'entryId'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/entries/delete', { table: a.table, entryId: a.entryId }),
  },
  {
    name: 'cms_delete_entries',
    permission: 'delete',
    tableArg: 'table',
    description: 'Soft-delete many entries at once. Same recoverable Trash behaviour as cms_delete_entry.',
    inputSchema: {
      type: 'object',
      properties: {
        table: str('Table slug.'),
        entryIds: { type: 'array', items: { type: 'string' }, description: 'Entry ids to delete.' },
      },
      required: ['table', 'entryIds'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/entries/delete-many', { table: a.table, entryIds: a.entryIds }),
  },

  // -------------------------------------------------------------------------
  // Page tree — how a page is actually built
  // -------------------------------------------------------------------------
  {
    name: 'cms_read_tree',
    permission: 'read',
    description:
      'Read a page\'s visual structure: the tree of nodes (sections, containers, headings, text, images, ' +
      'buttons) that makes up the page. `fieldId` is the id of the `pageTree`-typed field on the table — ' +
      'find it with cms_get_table. Always read the tree before mutating it, so you have real node ids.',
    inputSchema: {
      type: 'object',
      properties: {
        entryId: str('Entry id of the page.'),
        fieldId: str('Id of the pageTree field on that table.'),
      },
      required: ['entryId', 'fieldId'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/tree/read', { entryId: a.entryId, fieldId: a.fieldId }),
  },
  {
    name: 'cms_mutate_tree',
    permission: 'edit',
    description:
      'Build or restructure a page by applying operations to its node tree. THIS is how you lay out a page. ' +
      'Operations run in order through the CMS\'s own mutation engine, so an invalid one is rejected rather ' +
      'than persisted. Supported `kind` values: insertNode {parentId,index,node}, deleteNode {nodeId}, ' +
      'moveNode {nodeId,parentId,index}, duplicateNode {nodeId}, wrapNode {nodeId,wrapper:{moduleId,defaults?}}, ' +
      'renameNode {nodeId,name}, updateNodeProps {nodeId,props} (text, image src/alt, link href, CSS classes ' +
      'and style overrides all live in props), setBreakpointOverride {nodeId,breakpoint,props}, ' +
      'clearBreakpointOverride {nodeId,breakpoint}, toggleNodeHidden {nodeId}, toggleNodeLocked {nodeId}. ' +
      'Returns the updated tree plus `affectedNodeIds`. ' + DRAFT_HINT,
    inputSchema: {
      type: 'object',
      properties: {
        entryId: str('Entry id of the page.'),
        fieldId: str('Id of the pageTree field.'),
        operations: {
          type: 'array',
          description: 'Ordered tree operations, each an object with a `kind` field as described above.',
          items: { type: 'object' },
        },
      },
      required: ['entryId', 'fieldId', 'operations'],
      additionalProperties: false,
    },
    run: (ctx, a) =>
      pluginCall(ctx.slug, '/tree/mutate', { entryId: a.entryId, fieldId: a.fieldId, operations: a.operations }),
  },
  {
    name: 'cms_replace_tree',
    permission: 'edit',
    description:
      'Replace a page\'s whole node tree at once. Destructive — it discards the existing structure, including ' +
      'any concurrent human edit. Prefer cms_mutate_tree unless you are deliberately rebuilding the page from ' +
      'scratch. Pass a tree in the exact shape cms_read_tree returned.',
    inputSchema: {
      type: 'object',
      properties: {
        entryId: str('Entry id of the page.'),
        fieldId: str('Id of the pageTree field.'),
        tree: { type: 'object', description: 'Full replacement tree ({ rootNodeId, nodes }).' },
      },
      required: ['entryId', 'fieldId', 'tree'],
      additionalProperties: false,
    },
    run: (ctx, a) =>
      pluginCall(ctx.slug, '/tree/replace', { entryId: a.entryId, fieldId: a.fieldId, tree: a.tree }),
  },

  // -------------------------------------------------------------------------
  // Tables + publish
  // -------------------------------------------------------------------------
  {
    name: 'cms_create_table',
    permission: 'tables.manage',
    description:
      'Create a new content table (collection) — e.g. a "Case Studies" collection with its own fields. ' +
      'The table survives even if this integration is later removed, so create one only when the site ' +
      'genuinely needs a new content type.',
    inputSchema: {
      type: 'object',
      properties: {
        input: {
          type: 'object',
          description:
            'Table definition: { slug, name, singularLabel, pluralLabel, kind?, routeBase?, primaryFieldId?, fields? }.',
          additionalProperties: true,
        },
      },
      required: ['input'],
      additionalProperties: false,
    },
    run: (ctx, a) => pluginCall(ctx.slug, '/tables/create', { input: a.input }),
  },
  {
    name: 'cms_publish_entry',
    permission: 'publish',
    tableArg: 'table',
    description:
      'Publish one entry so it goes live on the public site — or schedule it by passing `scheduledFor` ' +
      '(ISO datetime). This is the only tool that makes draft work visible to visitors. Verify the content ' +
      'first; publish once, at the end.',
    inputSchema: {
      type: 'object',
      properties: {
        table: str('Table slug.'),
        entryId: str('Entry id.'),
        scheduledFor: str('Optional ISO datetime to schedule publication instead of publishing now.'),
      },
      required: ['table', 'entryId'],
      additionalProperties: false,
    },
    run: (ctx, a) =>
      pluginCall(ctx.slug, '/entries/publish', {
        table: a.table,
        entryId: a.entryId,
        scheduledFor: a.scheduledFor,
      }),
  },
  {
    name: 'cms_republish_all',
    permission: 'publish',
    description:
      'Re-publish every already-published page. Use after a site-wide change (a design token, a shared ' +
      'component, a layout) so existing live pages pick it up. Does not publish drafts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => pluginCall(ctx.slug, '/republish-all'),
  },
];
