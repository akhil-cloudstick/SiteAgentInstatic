// Site-level design tools — global design tokens, style rules, breakpoints and
// site settings.
//
// These live in the site shell row, not in `data_tables`, so the plugin content
// API cannot reach them at all; they go through the admin API like media does.
//
// The write path is a read-modify-write of the shell only: `PUT /site-document`
// in `incremental` mode with empty changed/deleted arrays is the CMS's own
// shell-only autosave shape, so no page, component or layout row is touched.
// The gateway always re-reads the shell immediately before writing, keeping the
// window in which it could clobber a concurrent human edit as small as the
// CMS's own editor does.
import { tenantJson } from '../session.mjs';

const str = (description) => ({ type: 'string', description });

export const designTools = [
  {
    name: 'design_read_site',
    permission: 'design.edit',
    description:
      'Read the site shell: global design tokens and framework settings, CSS style rules (the class ' +
      'registry), breakpoints, fonts and site settings. Read this before changing anything global, and to ' +
      'discover which CSS class names exist so page nodes can reference them.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => tenantJson(ctx.slug, '/cms/api/cms/site'),
  },
  {
    name: 'design_update_site',
    permission: 'design.edit',
    description:
      'Update the site shell — design tokens, style rules, breakpoints, settings. `patch` is merged into ' +
      'the top level of the shell returned by design_read_site, so send only the keys you are changing ' +
      '(e.g. { "styleRules": [...] }). This is site-wide: it affects every page. Existing published pages ' +
      'keep serving their old markup until cms_republish_all is called.',
    inputSchema: {
      type: 'object',
      properties: {
        patch: {
          type: 'object',
          description: 'Top-level keys of the site shell to replace, e.g. styleRules, settings, breakpoints.',
          additionalProperties: true,
        },
      },
      required: ['patch'],
      additionalProperties: false,
    },
    run: async (ctx, a) => {
      if (!a.patch || typeof a.patch !== 'object' || Array.isArray(a.patch)) {
        throw new Error('`patch` must be an object');
      }
      const current = await tenantJson(ctx.slug, '/cms/api/cms/site');
      const shell = current && current.site ? current.site : current;
      if (!shell || typeof shell !== 'object') throw new Error('Could not read the current site shell');

      await tenantJson(ctx.slug, '/cms/api/cms/site-document', {
        method: 'PUT',
        body: {
          mode: 'incremental',
          site: { ...shell, ...a.patch },
          changedPages: [],
          deletedPageIds: [],
          changedComponents: [],
          deletedComponentIds: [],
          changedLayouts: [],
          deletedLayoutIds: [],
        },
      });
      const updated = await tenantJson(ctx.slug, '/cms/api/cms/site');
      return { site: updated && updated.site ? updated.site : updated };
    },
  },
];
