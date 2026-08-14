// Regression lock for the two corrections the reference migration made to the
// automation template catalogue.
//
// 1. Filtering is by CATEGORY, for every tab. The previous implementation
//    special-cased `orbit` and `live-artifact` to filter on `kind` — and since
//    every daemon-catalogue template is built with `kind: 'routine'`, those two
//    tabs could only ever show the handful of skill-derived entries. The
//    reference filters every tab on `category`
//    (`prototype-reference/src/AutomationsScreen.jsx:277`).
//
// 2. `orbit-dashboard` belongs to `connectors`, not `orbit`
//    (`AutomationsScreen.jsx:82-90`).

import { describe, expect, it } from 'vitest';
import type { AutomationTemplate as ContractAutomationTemplate } from '@open-design/contracts';

import {
  automationTemplateCategory,
  buildAutomationTemplates,
  filterTemplates,
  templateFilters,
} from '../../src/components/automationTemplates';
import { en } from '../../src/i18n/locales/en';
import type { Dict } from '../../src/i18n/types';

const t = (key: keyof Dict, vars?: Record<string, string | number>): string => {
  const raw = en[key];
  if (!vars) return raw;
  return Object.entries(vars).reduce(
    (acc, [name, value]) => acc.split(`{${name}}`).join(String(value)),
    raw,
  );
};

/** Shaped like the daemon's `extract-design-system` built-in. */
const daemonTemplate: ContractAutomationTemplate = {
  id: 'extract-design-system',
  title: 'Extract design system',
  description: 'Draft a DESIGN.md from brand docs.',
  purpose: 'Make the design-system tree evolve from real source material.',
  triggerKinds: ['manual'],
  sourceKinds: ['upload'],
  stages: [{ id: 'ingest', kind: 'ingest', title: 'Capture design source' }],
  outputSinks: ['design-system', 'memory'],
  reviewPolicy: 'always',
  tokenCompression: 'balanced',
  tags: ['design-system'],
};

describe('automation template catalogue', () => {
  it('ships the reference\'s eight static templates with its ids and categories', () => {
    const templates = buildAutomationTemplates([], [], t);
    const byId = new Map(templates.map((template) => [template.id, template]));

    expect(byId.get('orbit-daily')?.category).toBe('orbit');
    expect(byId.get('orbit-daily')?.kind).toBe('orbit');
    expect(byId.get('orbit-daily')?.icon).toBe('gauge-high');

    expect(byId.get('live-status-board')?.category).toBe('live-artifact');
    expect(byId.get('live-artifact-registry')?.category).toBe('live-artifact');
    expect(byId.get('memory-refresh')?.category).toBe('memory');
    expect(byId.get('design-system-refresh')?.category).toBe('design-system');
    expect(byId.get('release-notes')?.category).toBe('release');
    expect(byId.get('quality-regression-watch')?.category).toBe('quality');

    // Correction 2: the reference files this one under Connectors, with the
    // link glyph — it builds a dashboard FROM connectors, it is not an Orbit.
    expect(byId.get('orbit-dashboard')?.category).toBe('connectors');
    expect(byId.get('orbit-dashboard')?.icon).toBe('link');
  });

  it('returns daemon-catalogue templates under their category tab, not only under All', () => {
    // Correction 1. The daemon template is `kind: 'routine'`; under the old
    // kind-based special case it disappeared from every tab but All.
    const templates = buildAutomationTemplates([], [daemonTemplate], t);

    const designSystem = filterTemplates(templates, 'design-system');
    expect(designSystem.map((template) => template.id)).toContain('extract-design-system');

    const all = filterTemplates(templates, 'all');
    expect(all.length).toBe(templates.length);
  });

  it('keeps the Orbit and Live artifacts tabs non-empty', () => {
    const templates = buildAutomationTemplates([], [daemonTemplate], t);

    expect(filterTemplates(templates, 'orbit').map((item) => item.id)).toEqual(['orbit-daily']);
    expect(filterTemplates(templates, 'live-artifact').map((item) => item.id)).toEqual([
      'live-status-board',
      'live-artifact-registry',
    ]);
  });

  it('files every shipped template under a tab that exists in the filter rail', () => {
    const templates = buildAutomationTemplates([], [daemonTemplate], t);
    const tabs = new Set(templateFilters(t).map((filter) => filter.id));

    for (const template of templates) {
      expect(tabs.has(template.category)).toBe(true);
    }
  });

  it('maps every daemon built-in into a real bucket', () => {
    const cases: [Partial<ContractAutomationTemplate>, string][] = [
      [{ outputSinks: ['memory'], tags: ['memory', 'ingestion'], tokenCompression: 'balanced' }, 'memory'],
      [{ outputSinks: ['design-system', 'memory'], tags: ['design-system'] }, 'design-system'],
      [{ outputSinks: ['skill', 'memory'], tags: ['skills'] }, 'skills'],
      [{ outputSinks: ['memory', 'artifact'], tags: ['connectors'] }, 'connectors'],
      [{ outputSinks: ['memory'], tags: ['compression'], tokenCompression: 'aggressive' }, 'compression'],
    ];

    for (const [patch, expected] of cases) {
      const template = { ...daemonTemplate, tags: [], sourceKinds: ['upload'], ...patch };
      expect(automationTemplateCategory(template as ContractAutomationTemplate)).toBe(expected);
    }
  });
});
