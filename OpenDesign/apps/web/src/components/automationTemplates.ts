/**
 * Automation templates — the catalogue behind the Templates section and the
 * composer's `Use template` picker.
 *
 * Shape and vocabulary come from the approved reference
 * (`prototype-reference/src/AutomationsScreen.jsx:30-124`); the CONTENT is this
 * app's, because the build kit names the prototype's hardcoded fixtures among
 * the behaviours a developer "must not preserve". Three sources are merged and
 * de-duplicated by id:
 *
 *   1. the daemon catalogue      (`GET /api/automation-templates`)
 *   2. design templates whose `scenario` is `orbit` / `live`
 *   3. the eight static templates the reference itself ships
 *
 * ── Two corrections against the previous implementation ──────────────────
 *
 * 1. FILTERING IS BY CATEGORY ONLY. The old code special-cased `orbit` and
 *    `live-artifact` to filter on `kind` — but every daemon-catalogue template
 *    is built with `kind: 'routine'`, so those two tabs were permanently close
 *    to empty. The reference filters every tab on `category`
 *    (`AutomationsScreen.jsx:277`) and treats `kind` as a display label only.
 *
 * 2. `orbit-dashboard` is category `connectors`, not `orbit`, and its glyph is
 *    `link` — `AutomationsScreen.jsx:82-90`. `orbit-daily`'s glyph is
 *    `gauge-high`, not a generic orbit mark — `:35`.
 *
 * Icons are Font Awesome Solid glyph names (no `fa-` prefix), rendered through
 * the vendored webfont the rest of the reskinned screens use. Every glyph below
 * appears in the reference's own import list at `AutomationsScreen.jsx:2-26`.
 */
import type { AutomationTemplate as ContractAutomationTemplate } from '@open-design/contracts';

import type { Dict } from '../i18n/types';
import type { SkillSummary } from '../types';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

/** Display label only — never a filter input. See correction 1 above. */
export type AutomationTemplateKind = 'routine' | 'orbit' | 'live-artifact';

/**
 * The reference's ten filter buckets (`AutomationsScreen.jsx:113-124`), plus
 * `routine` as the fallback for a future daemon template that matches none of
 * them. A `routine` template is still reachable under `All`, which is the same
 * arrangement the reference ships with (its `skills` and `compression` tabs
 * legitimately show zero).
 */
export type AutomationTemplateCategory =
  | 'routine'
  | 'orbit'
  | 'live-artifact'
  | 'memory'
  | 'design-system'
  | 'skills'
  | 'connectors'
  | 'compression'
  | 'release'
  | 'quality';

export type TemplateFilter = 'all' | AutomationTemplateCategory;

export interface AutomationTemplate {
  id: string;
  category: AutomationTemplateCategory;
  kind: AutomationTemplateKind;
  /** Font Awesome Solid glyph name, without the `fa-` prefix. */
  icon: string;
  title: string;
  description: string;
  prompt: string;
  defaultName?: string;
  skillId?: string | null;
}

/** `AutomationsScreen.jsx:113-124` — order and labels are the reference's. */
export function templateFilters(
  t: TranslateFn,
): ReadonlyArray<{ id: TemplateFilter; label: string }> {
  return [
    { id: 'all', label: t('automations.filterAll') },
    { id: 'orbit', label: t('automations.filterOrbit') },
    { id: 'live-artifact', label: t('automations.filterLiveArtifacts') },
    { id: 'memory', label: t('automations.filterMemory') },
    { id: 'design-system', label: t('automations.filterDesignSystems') },
    { id: 'skills', label: t('automations.filterSkills') },
    { id: 'connectors', label: t('automations.filterConnectors') },
    { id: 'compression', label: t('automations.filterCompression') },
    { id: 'release', label: t('automations.filterRelease') },
    { id: 'quality', label: t('automations.filterQuality') },
  ];
}

/**
 * The reference's eight, `AutomationsScreen.jsx:30-111`, with this app's
 * translated copy and its longer operational prompts. Ids, categories, kinds
 * and glyphs are the reference's exactly.
 */
function buildStaticTemplates(t: TranslateFn): ReadonlyArray<AutomationTemplate> {
  return [
    {
      id: 'orbit-daily',
      category: 'orbit',
      kind: 'orbit',
      icon: 'gauge-high',
      title: t('automations.tpl.orbitDaily.title'),
      description: t('automations.tpl.orbitDaily.desc'),
      defaultName: 'Daily connector digest',
      prompt:
        'Survey every connected integration and produce a daily digest of what changed in the last 24 hours. Group the result by people, projects, decisions, and follow-ups. Save the output as a live artifact named `daily_digest.md` and update it in place on each run.',
    },
    {
      id: 'live-status-board',
      category: 'live-artifact',
      kind: 'live-artifact',
      icon: 'file-code',
      title: t('automations.tpl.liveStatusBoard.title'),
      description: t('automations.tpl.liveStatusBoard.desc'),
      defaultName: 'Live status board',
      prompt:
        "Maintain a single live artifact named `status_board.md`. On each run, update the sections for 'In flight', 'Shipped this week', 'Risks', and 'Decisions made'. Edit in place so the artifact stays stable.",
    },
    {
      id: 'memory-refresh',
      category: 'memory',
      kind: 'routine',
      icon: 'wand-magic-sparkles',
      title: t('automations.tpl.memoryRefresh.title'),
      description: t('automations.tpl.memoryRefresh.desc'),
      defaultName: 'Memory refresh',
      prompt:
        'Review recent chats, PR comments, design feedback, and project changes. Extract durable preferences, repeated decisions, and workflow lessons. Propose concise memory updates with source links and separate one-off notes from reusable guidance.',
    },
    {
      id: 'design-system-refresh',
      category: 'design-system',
      kind: 'routine',
      icon: 'sliders',
      title: t('automations.tpl.designSystemRefresh.title'),
      description: t('automations.tpl.designSystemRefresh.desc'),
      defaultName: 'Design system maintainer',
      prompt:
        'Inspect recent generated artifacts, review feedback, and accepted revisions. Identify patterns that should become design-system tokens, component rules, examples, or anti-patterns. Draft precise updates to DESIGN.md and call out anything that needs human approval.',
    },
    {
      id: 'live-artifact-registry',
      category: 'live-artifact',
      kind: 'routine',
      icon: 'file-code',
      title: t('automations.tpl.liveArtifactRegistry.title'),
      description: t('automations.tpl.liveArtifactRegistry.desc'),
      defaultName: 'Live artifact maintainer',
      prompt:
        'List live artifacts for this project, find stale or failed refreshes, and update the highest-value artifact in place. Preserve artifact ids, summarize what changed, and flag artifacts that need connector access or human review.',
    },
    {
      id: 'orbit-dashboard',
      category: 'connectors',
      kind: 'routine',
      icon: 'link',
      title: t('automations.tpl.orbitDashboard.title'),
      description: t('automations.tpl.orbitDashboard.desc'),
      defaultName: 'Connector activity dashboard',
      prompt:
        'Use the selected connectors to build or refresh a live dashboard of recent activity. Group by people, projects, decisions, risks, and follow-ups. Prefer connected read-only tools, cite sources, and keep the dashboard refreshable.',
    },
    {
      id: 'release-notes',
      category: 'release',
      kind: 'routine',
      icon: 'code-branch',
      title: t('automations.tpl.releaseNotes.title'),
      description: t('automations.tpl.releaseNotes.desc'),
      defaultName: 'Weekly release notes',
      prompt:
        "Draft user-facing release notes covering merged PRs, updated artifacts, and design-system changes from the last 7 days. Group by 'New', 'Improved', and 'Fixed'. Include links when available and keep the copy user-readable.",
    },
    {
      id: 'quality-regression-watch',
      category: 'quality',
      kind: 'routine',
      icon: 'bell',
      title: t('automations.tpl.qualityRegressionWatch.title'),
      description: t('automations.tpl.qualityRegressionWatch.desc'),
      defaultName: 'Regression watch',
      prompt:
        'Compare recent project changes against accepted artifacts, design-system rules, benchmarks, and traces. Flag regressions in behavior, layout, accessibility, or product intent. Suggest the smallest fix and cite the evidence.',
    },
  ];
}

function templateFromSkill(
  skill: SkillSummary,
  kind: Extract<AutomationTemplateKind, 'orbit' | 'live-artifact'>,
): AutomationTemplate {
  return {
    id: `skill-${skill.id}`,
    category: kind,
    kind,
    icon: kind === 'orbit' ? 'gauge-high' : 'file-code',
    title: skill.name,
    description: skill.description || skill.id,
    defaultName: skill.name,
    prompt: skill.examplePrompt || skill.description || `Run ${skill.name}.`,
    skillId: skill.id,
  };
}

/**
 * Where a daemon-catalogue template belongs among the reference's ten buckets.
 * Verified against all six built-ins in `apps/daemon/src/automation-templates.ts`:
 * ingest-source-memory-tree -> memory, extract-design-system -> design-system,
 * crystallize-run-into-skill -> skills, connector-digest-design-context ->
 * connectors, compress-project-context -> compression, promote-artifact-style
 * -> design-system. Nothing falls through today.
 */
export function automationTemplateCategory(
  template: ContractAutomationTemplate,
): AutomationTemplateCategory {
  const tags = new Set(template.tags ?? []);
  if (template.outputSinks.includes('design-system') || tags.has('design-system')) {
    return 'design-system';
  }
  if (template.outputSinks.includes('skill') || tags.has('skills')) {
    return 'skills';
  }
  if (
    tags.has('connectors') ||
    (template.sourceKinds.length > 0 && template.sourceKinds.every((kind) => kind === 'connector'))
  ) {
    return 'connectors';
  }
  if (template.tokenCompression === 'aggressive' || tags.has('compression') || tags.has('tokens')) {
    return 'compression';
  }
  if (template.outputSinks.includes('memory') || tags.has('memory')) {
    return 'memory';
  }
  return 'routine';
}

/**
 * One glyph per bucket, drawn only from the reference's own icon vocabulary
 * (`AutomationsScreen.jsx:2-26` + `:30-111`). `compression` has no reference
 * template; `rotate` is the reference's refresh glyph, imported there for the
 * running-status spinner.
 */
export function automationTemplateIcon(category: AutomationTemplateCategory): string {
  switch (category) {
    case 'design-system':
      return 'sliders';
    case 'skills':
    case 'memory':
      return 'wand-magic-sparkles';
    case 'connectors':
      return 'link';
    case 'compression':
      return 'rotate';
    case 'orbit':
      return 'gauge-high';
    case 'live-artifact':
      return 'file-code';
    case 'release':
      return 'code-branch';
    case 'quality':
      return 'bell';
    default:
      return 'clock-rotate-left';
  }
}

export function automationTemplatePrompt(template: ContractAutomationTemplate): string {
  const stages = template.stages.map((stage) => stage.title).join(' -> ');
  return [
    `Use Automation template "${template.id}".`,
    `Purpose: ${template.purpose}`,
    `Sources: ${template.sourceKinds.join(', ')}.`,
    `Trigger modes: ${template.triggerKinds.join(', ')}.`,
    `Pipeline: ${stages}.`,
    `Outputs: ${template.outputSinks.join(', ')}.`,
    `Review policy: ${template.reviewPolicy}. Token compression: ${template.tokenCompression}.`,
    'Produce reviewable proposals with provenance before applying durable memory, skill, automation, or design-system changes.',
  ].join('\n');
}

function templateFromAutomationCatalog(template: ContractAutomationTemplate): AutomationTemplate {
  const category = automationTemplateCategory(template);
  return {
    id: template.id,
    category,
    kind: 'routine',
    icon: automationTemplateIcon(category),
    title: template.title,
    description: template.description,
    defaultName: template.title,
    prompt: automationTemplatePrompt(template),
  };
}

function dedupeTemplates(templates: AutomationTemplate[]): AutomationTemplate[] {
  const seen = new Set<string>();
  return templates.filter((template) => {
    if (seen.has(template.id)) return false;
    seen.add(template.id);
    return true;
  });
}

export function buildAutomationTemplates(
  designTemplates: SkillSummary[],
  automationCatalog: ContractAutomationTemplate[],
  t: TranslateFn,
): AutomationTemplate[] {
  const orbit = designTemplates
    .filter((skill) => skill.scenario === 'orbit')
    .map((skill) => templateFromSkill(skill, 'orbit'));
  const live = designTemplates
    .filter((skill) => skill.scenario === 'live')
    .map((skill) => templateFromSkill(skill, 'live-artifact'));

  // Statics last: the daemon catalogue and installed skills win on an id clash,
  // and the reference's own eight backfill whatever they do not cover.
  return dedupeTemplates([
    ...automationCatalog.map(templateFromAutomationCatalog),
    ...orbit,
    ...live,
    ...buildAutomationStatics(t),
  ]);
}

/** Split out so tests can assert the reference's eight independently. */
export function buildAutomationStatics(t: TranslateFn): AutomationTemplate[] {
  return [...buildStaticTemplates(t)];
}

/** Category-only, per the reference. See correction 1 in the file header. */
export function filterTemplates(
  templates: AutomationTemplate[],
  filter: TemplateFilter,
): AutomationTemplate[] {
  if (filter === 'all') return templates;
  return templates.filter((template) => template.category === filter);
}

export function templateKindLabel(kind: AutomationTemplateKind, t: TranslateFn): string {
  if (kind === 'orbit') return t('automations.kindOrbit');
  if (kind === 'live-artifact') return t('automations.kindLiveArtifact');
  return t('automations.kindAutomation');
}

/**
 * The card's category accent. The reference only tints `orbit` and
 * `live-artifact` (`styles.css:6334-6342`); everything else inherits
 * `--mms-action-strong` from `.cardIcon`.
 */
export function templateAccentClass(
  category: AutomationTemplateCategory,
  styles: Record<string, string>,
): string {
  if (category === 'orbit') return styles.isOrbit ?? '';
  if (category === 'live-artifact') return styles.isLiveArtifact ?? '';
  return '';
}
