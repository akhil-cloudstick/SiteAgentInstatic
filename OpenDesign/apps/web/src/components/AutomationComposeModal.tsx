/**
 * AutomationComposeModal — the reference's automation composer
 * (`prototype-reference/src/AutomationsScreen.jsx:158-262`,
 * `styles.css:5555-5577`, `5915-5958`, `6385-6673`).
 *
 * The persistence layer is unchanged: `/api/routines`, with the same
 * `CreateRoutineRequest` payload the previous modal sent. What changed is the
 * frame — a borderless title, a template pill in the head, one labelled prompt
 * field, the runtime note, and two footer pills whose popovers open UPWARD.
 *
 * ── Kept beyond the reference ────────────────────────────────────────────
 * The reference's `@` picker renders a placeholder because the prototype has no
 * runtime. The build kit requires the real thing ("authorized `@` context"), so
 * the reference's tab chrome wraps this app's actual Skills / Plugins / MCP /
 * Connector results, and the selections it produces stay visible and removable
 * as chips. Everything else on screen is the reference's.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type {
  ConnectorDetail,
  CreateRoutineRequest,
  InstalledPluginRecord,
  Routine,
  RoutineProjectTarget,
  RoutineSchedule,
  Weekday,
} from '@open-design/contracts';

import { useI18n, useT } from '../i18n';
import type { Dict } from '../i18n/types';
import type { SkillSummary } from '../types';
import { listPlugins } from '../state/projects';
import { fetchMcpServers, type McpServerConfig } from '../state/mcp';
import { inlineMentionToken } from '../utils/inlineMentions';
import { useHubContext } from '../state/hubContext';
import { localizePluginDescription, localizePluginTitle } from './plugins-home/localization';
import { describeRoutineSchedule } from './routineScheduleLabels';
import { useDismissable } from './start-desk/useDismissable';
import { templateAccentClass, templateKindLabel, type AutomationTemplate } from './automationTemplates';
import styles from './AutomationsScreen.module.css';

type ProjectSummary = { id: string; name: string };
type ScheduleKind = RoutineSchedule['kind'];
type CapabilityKind = 'skills' | 'plugins' | 'mcp' | 'connectors';
type CapabilityPickerTab = 'all' | CapabilityKind;
type PopoverName = 'template' | 'project' | 'schedule';
type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

interface ContextMention {
  start: number;
  end: number;
  query: string;
}

interface SelectedContextItem {
  kind: CapabilityKind;
  id: string;
  label: string;
  meta: string;
  glyph: string;
}

/** `AutomationsScreen.jsx:246` — four kinds, in the reference's order. */
const SCHEDULE_KINDS: { kind: ScheduleKind; labelKey: keyof Dict }[] = [
  { kind: 'hourly', labelKey: 'routines.kind.hourly' },
  { kind: 'daily', labelKey: 'routines.kind.daily' },
  { kind: 'weekdays', labelKey: 'routines.kind.weekdays' },
  { kind: 'weekly', labelKey: 'routines.kind.weekly' },
];

/**
 * The reference's Day `<select>` lists Monday first (`:248`). The contract's
 * `Weekday` is `Date.getDay()` order, so the display order and the stored value
 * are decoupled here.
 */
const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** Only used when the runtime cannot enumerate zones itself. */
const FALLBACK_TIMEZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
];

function detectLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function listSupportedTimezones(): string[] {
  try {
    const fn = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof fn === 'function') {
      const list = fn('timeZone');
      if (Array.isArray(list) && list.length > 0) {
        return list.includes('UTC') ? list : ['UTC', ...list];
      }
    }
  } catch {
    /* fall through */
  }
  return FALLBACK_TIMEZONES;
}

function tzCityLabel(timezone: string): string {
  if (timezone === 'UTC') return 'UTC';
  const last = timezone.split('/').pop() ?? timezone;
  return last.replace(/_/g, ' ');
}

interface FormState {
  name: string;
  prompt: string;
  kind: ScheduleKind;
  minute: number;
  time: string;
  weekday: Weekday;
  timezone: string;
  mode: 'create_each_run' | 'reuse';
  projectId: string;
}

function emptyForm(): FormState {
  return {
    name: '',
    prompt: '',
    kind: 'daily',
    minute: 0,
    time: '09:00',
    weekday: 1,
    timezone: detectLocalTimezone(),
    mode: 'create_each_run',
    projectId: '',
  };
}

function formFromRoutine(routine: Routine): FormState {
  const base = emptyForm();
  base.name = routine.name;
  base.prompt = routine.prompt;
  const schedule = routine.schedule;
  if (schedule.kind === 'hourly') {
    base.kind = 'hourly';
    base.minute = schedule.minute;
  } else if (schedule.kind === 'weekly') {
    base.kind = 'weekly';
    base.weekday = schedule.weekday;
    base.time = schedule.time;
    base.timezone = schedule.timezone;
  } else {
    base.kind = schedule.kind;
    base.time = schedule.time;
    base.timezone = schedule.timezone;
  }
  if (routine.target.mode === 'reuse') {
    base.mode = 'reuse';
    base.projectId = routine.target.projectId;
  }
  return base;
}

function buildSchedule(form: FormState): RoutineSchedule {
  if (form.kind === 'hourly') return { kind: 'hourly', minute: form.minute };
  if (form.kind === 'weekly') {
    return { kind: 'weekly', weekday: form.weekday, time: form.time, timezone: form.timezone };
  }
  return { kind: form.kind, time: form.time, timezone: form.timezone };
}

function clampMinute(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(59, Math.round(value)));
}

export interface AutomationComposeModalProps {
  open: boolean;
  initial?: { template?: AutomationTemplate; routine?: Routine } | null;
  templates: AutomationTemplate[];
  projects: ProjectSummary[];
  skills: SkillSummary[];
  connectors?: ConnectorDetail[];
  onClose: () => void;
  onSaved: (routine: Routine) => void;
}

export function AutomationComposeModal({
  open,
  initial,
  templates,
  projects,
  skills,
  connectors = [],
  onClose,
  onSaved,
}: AutomationComposeModalProps) {
  const t = useT();
  const { locale } = useI18n();
  const hubContext = useHubContext();
  const editingId = initial?.routine?.id ?? null;
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverName | null>(null);
  const [plugins, setPlugins] = useState<InstalledPluginRecord[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mentionTab, setMentionTab] = useState<CapabilityPickerTab>('all');
  const [mention, setMention] = useState<ContextMention | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [selectedPluginIds, setSelectedPluginIds] = useState<string[]>([]);
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([]);
  const [selectedConnectorIds, setSelectedConnectorIds] = useState<string[]>([]);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  // One panel is mounted at a time, so a single panel ref serves all three
  // popovers; the trigger ref is re-pointed as the open popover changes.
  const popoverPanelRef = useRef<HTMLDivElement | null>(null);
  const templateTriggerRef = useRef<HTMLButtonElement | null>(null);
  const projectTriggerRef = useRef<HTMLButtonElement | null>(null);
  const scheduleTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeTriggerRef = useRef<HTMLElement | null>(null);
  activeTriggerRef.current =
    popover === 'template'
      ? templateTriggerRef.current
      : popover === 'project'
        ? projectTriggerRef.current
        : popover === 'schedule'
          ? scheduleTriggerRef.current
          : null;

  useDismissable({
    open: popover !== null,
    panelRef: popoverPanelRef,
    triggerRef: activeTriggerRef,
    onDismiss: () => setPopover(null),
  });

  const timezones = useMemo(() => {
    const local = detectLocalTimezone();
    return Array.from(new Set<string>([local, ...listSupportedTimezones()]));
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    void (async () => {
      const [pluginResult, mcpResult] = await Promise.allSettled([listPlugins(), fetchMcpServers()]);
      if (canceled) return;
      setPlugins(pluginResult.status === 'fulfilled' ? (pluginResult.value ?? []) : []);
      setMcpServers(
        mcpResult.status === 'fulfilled'
          ? (mcpResult.value?.servers ?? []).filter((server) => server.enabled)
          : [],
      );
    })();
    return () => {
      canceled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (initial?.routine) {
      setForm(formFromRoutine(initial.routine));
      setSelectedTemplateId(null);
      setSelectedSkillIds(
        initial.routine.context?.skillIds ?? (initial.routine.skillId ? [initial.routine.skillId] : []),
      );
      setSelectedPluginIds(initial.routine.context?.pluginIds ?? []);
      setSelectedMcpIds(initial.routine.context?.mcpServerIds ?? []);
      setSelectedConnectorIds(initial.routine.context?.connectorIds ?? []);
    } else if (initial?.template) {
      const template = initial.template;
      setForm({ ...emptyForm(), name: template.defaultName ?? template.title, prompt: template.prompt });
      setSelectedTemplateId(template.id);
      setSelectedSkillIds(template.skillId ? [template.skillId] : []);
    } else {
      setForm(emptyForm());
      setSelectedTemplateId(null);
      setSelectedSkillIds([]);
      setSelectedPluginIds([]);
      setSelectedMcpIds([]);
      setSelectedConnectorIds([]);
    }
    setError(null);
    setPopover(null);
    setMentionTab('all');
    setMention(null);
  }, [open, initial]);

  /**
   * `AutomationsScreen.jsx:175-179` — Escape peels one layer at a time. The
   * popover layer is owned by `useDismissable`, so this handler only has to
   * stand down while one is open.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (mention) {
        setMention(null);
        return;
      }
      if (popover) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mention, onClose, open, popover]);

  // `AutomationsScreen.jsx:173-174`.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => titleRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;

  function applyTemplate(template: AutomationTemplate) {
    setForm({
      ...emptyForm(),
      name: template.defaultName ?? template.title,
      prompt: template.prompt,
    });
    setSelectedTemplateId(template.id);
    setSelectedSkillIds(template.skillId ? [template.skillId] : []);
    setPopover(null);
  }

  function updatePrompt(nextPrompt: string, cursor: number) {
    setForm((current) => ({ ...current, prompt: nextPrompt }));
    setMention(readContextMention(nextPrompt, cursor));
  }

  function refreshMentionFromPrompt() {
    const textarea = promptRef.current;
    if (!textarea) return;
    setMention(readContextMention(textarea.value, textarea.selectionStart ?? textarea.value.length));
  }

  function replaceMentionWithLabel(label: string) {
    const token = `${inlineMentionToken(label)} `;
    const textarea = promptRef.current;
    const activeMention = mention;
    const nextPrompt = (() => {
      if (!activeMention) {
        const spacer = form.prompt.trim().length > 0 ? '\n' : '';
        return `${form.prompt}${spacer}${token}`;
      }
      const before = form.prompt.slice(0, activeMention.start);
      const after = form.prompt.slice(activeMention.end).replace(/^\s+/, '');
      return `${before}${token}${after}`;
    })();
    const cursor = activeMention
      ? form.prompt.slice(0, activeMention.start).length + token.length
      : nextPrompt.length;
    setForm((current) => ({ ...current, prompt: nextPrompt }));
    setMention(null);
    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function pickSkill(skill: SkillSummary) {
    setSelectedSkillIds((current) => (current.includes(skill.id) ? current : [...current, skill.id]));
    replaceMentionWithLabel(skill.name);
  }

  function pickPlugin(plugin: InstalledPluginRecord) {
    const pluginLabel = localizePluginTitle(locale, plugin);
    setSelectedPluginIds((current) => (current.includes(plugin.id) ? current : [...current, plugin.id]));
    replaceMentionWithLabel(pluginLabel);
  }

  function pickMcp(server: McpServerConfig) {
    setSelectedMcpIds((current) => (current.includes(server.id) ? current : [...current, server.id]));
    replaceMentionWithLabel(server.label || server.id);
  }

  function pickConnector(connector: ConnectorDetail) {
    setSelectedConnectorIds((current) =>
      current.includes(connector.id) ? current : [...current, connector.id],
    );
    replaceMentionWithLabel(connector.name);
  }

  function removeSelectedContext(kind: CapabilityKind, id: string) {
    if (kind === 'skills') setSelectedSkillIds((current) => current.filter((item) => item !== id));
    if (kind === 'plugins') setSelectedPluginIds((current) => current.filter((item) => item !== id));
    if (kind === 'mcp') setSelectedMcpIds((current) => current.filter((item) => item !== id));
    if (kind === 'connectors')
      setSelectedConnectorIds((current) => current.filter((item) => item !== id));
  }

  function handlePromptKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape' && mention) {
      event.preventDefault();
      setMention(null);
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    // Silent return, like the reference (`AutomationsScreen.jsx:193`): the
    // submit button is already disabled while either field is empty, so a
    // message here would be unreachable copy.
    if (!form.name.trim() || !form.prompt.trim()) return;
    setSubmitting(true);
    try {
      const target: RoutineProjectTarget =
        form.mode === 'reuse' && form.projectId
          ? { mode: 'reuse', projectId: form.projectId }
          : { mode: 'create_each_run' };
      const body: CreateRoutineRequest = {
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        schedule: buildSchedule(form),
        target,
        skillId: selectedSkillIds[0] ?? null,
        context: {
          ...(selectedSkillIds.length > 0 ? { skillIds: selectedSkillIds } : {}),
          ...(selectedPluginIds.length > 0 ? { pluginIds: selectedPluginIds } : {}),
          ...(selectedMcpIds.length > 0 ? { mcpServerIds: selectedMcpIds } : {}),
          ...(selectedConnectorIds.length > 0 ? { connectorIds: selectedConnectorIds } : {}),
        },
        enabled: true,
      };
      const isEdit = editingId !== null;
      const url = isEdit ? `/api/routines/${editingId}` : '/api/routines';
      const payload = isEdit
        ? {
            name: body.name,
            prompt: body.prompt,
            schedule: body.schedule,
            target: body.target,
            skillId: body.skillId,
            context: body.context,
          }
        : body;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `${isEdit ? 'update' : 'create'} failed: ${res.status}`);
      }
      const json = await res.json();
      onSaved(json.routine);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const projectName = projects.find((project) => project.id === form.projectId)?.name ?? null;
  const projectLabel =
    form.mode === 'reuse' && projectName ? projectName : t('automations.targetCreateEachRun');
  const schedule = buildSchedule(form);
  const scheduleLabel = describeRoutineSchedule(schedule, t, initial?.routine?.nextRunAt ?? null);

  const mentionQuery = (mention?.query ?? '').trim().toLowerCase();
  const filteredSkills = filterCapabilities(
    skills,
    mentionQuery,
    (skill) => `${skill.name} ${skill.id} ${skill.description}`,
  ).slice(0, 10);
  const filteredPlugins = filterCapabilities(plugins, mentionQuery, (plugin) => {
    const title = localizePluginTitle(locale, plugin);
    const description = localizePluginDescription(locale, plugin);
    return `${title} ${plugin.id} ${description}`;
  }).slice(0, 10);
  const filteredMcp = filterCapabilities(
    mcpServers,
    mentionQuery,
    (server) => `${server.label || ''} ${server.id} ${server.url || ''} ${server.command || ''}`,
  ).slice(0, 10);
  const filteredConnectors = filterCapabilities(
    connectors.filter((connector) => connector.status === 'connected'),
    mentionQuery,
    (connector) =>
      `${connector.name} ${connector.id} ${connector.provider} ${connector.category} ${connector.description ?? ''} ${connector.accountLabel ?? ''}`,
  ).slice(0, 10);

  const showSkills = mentionTab === 'all' || mentionTab === 'skills';
  const showPlugins = mentionTab === 'all' || mentionTab === 'plugins';
  const showMcp = mentionTab === 'all' || mentionTab === 'mcp';
  const showConnectors = mentionTab === 'all' || mentionTab === 'connectors';
  const hasMentionResults =
    (showSkills && filteredSkills.length > 0) ||
    (showPlugins && filteredPlugins.length > 0) ||
    (showMcp && filteredMcp.length > 0) ||
    (showConnectors && filteredConnectors.length > 0);

  const selectedContextItems: SelectedContextItem[] = [
    ...selectedSkillIds.map((id) => ({
      kind: 'skills' as const,
      id,
      label: skills.find((item) => item.id === id)?.name ?? id,
      meta: t('chat.designToolbox.kind.skill'),
      glyph: 'wand-magic-sparkles',
    })),
    ...selectedPluginIds.map((id) => {
      const plugin = plugins.find((item) => item.id === id);
      return {
        kind: 'plugins' as const,
        id,
        label: plugin ? localizePluginTitle(locale, plugin) : id,
        meta: (plugin ? localizePluginDescription(locale, plugin) : '') || id,
        glyph: 'puzzle-piece',
      };
    }),
    ...selectedMcpIds.map((id) => ({
      kind: 'mcp' as const,
      id,
      label: mcpServers.find((item) => item.id === id)?.label || id,
      meta: t('chat.designToolbox.kind.mcp'),
      glyph: 'link',
    })),
    ...selectedConnectorIds.map((id) => {
      const connector = connectors.find((item) => item.id === id);
      return {
        kind: 'connectors' as const,
        id,
        label: connector?.name ?? id,
        meta: connector?.accountLabel
          ? `${t('chat.designToolbox.kind.connector')} · ${connector.accountLabel}`
          : t('chat.designToolbox.kind.connector'),
        glyph: 'link',
      };
    }),
  ];

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      data-testid="automation-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className={styles.modalCard}
        role="dialog"
        aria-modal="true"
        aria-label={editingId ? t('automations.edit') : t('automations.newAutomation')}
        onSubmit={submit}
      >
        <header className={styles.composeHead}>
          <input
            ref={titleRef}
            type="text"
            className={styles.titleInput}
            placeholder={t('routines.fieldNamePlaceholder')}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            aria-label={t('routines.fieldName')}
            data-testid="automation-modal-title"
          />
          <div className={styles.headActions}>
            <span className={styles.menuWrap}>
              <button
                ref={templateTriggerRef}
                type="button"
                className={`${styles.pill} ${popover === 'template' ? styles.pillActive : ''}`.trim()}
                aria-haspopup="menu"
                aria-expanded={popover === 'template'}
                onClick={() => setPopover((open) => (open === 'template' ? null : 'template'))}
              >
                <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
                <span className={styles.pillLabel}>
                  {selectedTemplate?.title ?? selectedTemplate?.defaultName ?? t('automations.useTemplate')}
                </span>
                <i className="fa-solid fa-chevron-down" aria-hidden="true" />
              </button>
              {popover === 'template' ? (
                <div
                  ref={popoverPanelRef}
                  className={`${styles.popover} ${styles.templatePicker}`}
                  role="menu"
                >
                  {templates.map((template) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={template.id}
                      onClick={() => applyTemplate(template)}
                    >
                      <span
                        className={`${styles.cardIcon} ${templateAccentClass(template.category, styles)}`.trim()}
                        aria-hidden="true"
                      >
                        <i className={`fa-solid fa-${template.icon}`} />
                      </span>
                      <span>
                        <strong>{template.title ?? template.defaultName}</strong>
                        <small>{templateKindLabel(template.kind, t)}</small>
                      </span>
                      {selectedTemplateId === template.id ? (
                        <i className="fa-solid fa-check" aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </span>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onClose}
              aria-label={t('common.close')}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className={styles.composeBody}>
          <label
            className={styles.promptField}
            data-testid="automation-modal-prompt-field"
            data-mentioning={mention ? 'true' : 'false'}
          >
            <span>{t('automations.promptFieldLabel')}</span>
            <textarea
              ref={promptRef}
              value={form.prompt}
              placeholder={t('automations.promptPlaceholder')}
              rows={9}
              onChange={(event) =>
                updatePrompt(event.target.value, event.target.selectionStart ?? event.target.value.length)
              }
              onClick={refreshMentionFromPrompt}
              onFocus={() => setPopover(null)}
              onKeyDown={handlePromptKeyDown}
              onKeyUp={refreshMentionFromPrompt}
              aria-controls={mention ? 'automation-context-picker' : undefined}
              aria-expanded={Boolean(mention)}
              data-testid="automation-modal-prompt"
            />
            <small>{t('automations.promptHint')}</small>
          </label>

          {mention ? (
            <div
              id="automation-context-picker"
              className={styles.contextPicker}
              role="listbox"
              aria-label={t('homeHero.contextSearchResults')}
              data-testid="automation-mention-popover"
              onMouseDown={(event) => event.preventDefault()}
            >
              <div className={styles.contextTabs} role="tablist" aria-label={t('chat.mentionTabsAria')}>
                {(
                  [
                    ['all', t('chat.mentionTabAll')],
                    ['skills', t('chat.mentionTabSkills')],
                    ['plugins', t('chat.mentionTabPlugins')],
                    ['mcp', t('chat.mentionTabMcp')],
                    ['connectors', t('chat.mentionTabConnectors')],
                  ] as [CapabilityPickerTab, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={mentionTab === id}
                    className={mentionTab === id ? styles.contextTabActive : undefined}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setMentionTab(id);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className={styles.contextResults}>
                {!hasMentionResults ? (
                  <div className={styles.contextEmpty}>
                    <i className="fa-solid fa-link" aria-hidden="true" />
                    <span>
                      <strong>{t('chat.mentionTabAll')}</strong>
                      <small>
                        {mention.query
                          ? t('chat.mentionNoResults', { query: mention.query })
                          : t('chat.mentionSearchPrompt')}
                      </small>
                    </span>
                  </div>
                ) : null}
                {showSkills && filteredSkills.length > 0 ? (
                  <MentionSection label={t('chat.mentionSectionSkills')}>
                    {filteredSkills.map((skill) => (
                      <MentionItem
                        key={`skill-${skill.id}`}
                        glyph="wand-magic-sparkles"
                        label={skill.name}
                        meta={skill.description || skill.mode}
                        selected={selectedSkillIds.includes(skill.id)}
                        onPick={() => pickSkill(skill)}
                      />
                    ))}
                  </MentionSection>
                ) : null}
                {showPlugins && filteredPlugins.length > 0 ? (
                  <MentionSection label={t('chat.mentionSectionPlugins')}>
                    {filteredPlugins.map((plugin) => (
                      <MentionItem
                        key={`plugin-${plugin.id}`}
                        glyph="puzzle-piece"
                        label={localizePluginTitle(locale, plugin)}
                        meta={localizePluginDescription(locale, plugin) || plugin.id}
                        selected={selectedPluginIds.includes(plugin.id)}
                        onPick={() => pickPlugin(plugin)}
                      />
                    ))}
                  </MentionSection>
                ) : null}
                {showMcp && filteredMcp.length > 0 ? (
                  <MentionSection label={t('chat.mentionSectionMcp')}>
                    {filteredMcp.map((server) => (
                      <MentionItem
                        key={`mcp-${server.id}`}
                        glyph="link"
                        label={server.label || server.id}
                        meta={server.url || server.command || server.transport}
                        selected={selectedMcpIds.includes(server.id)}
                        onPick={() => pickMcp(server)}
                      />
                    ))}
                  </MentionSection>
                ) : null}
                {showConnectors && filteredConnectors.length > 0 ? (
                  <MentionSection label={t('chat.mentionSectionConnectors')}>
                    {filteredConnectors.map((connector) => (
                      <MentionItem
                        key={`connector-${connector.id}`}
                        glyph="link"
                        label={connector.name}
                        meta={connector.accountLabel ?? connector.provider ?? connector.id}
                        selected={selectedConnectorIds.includes(connector.id)}
                        onPick={() => pickConnector(connector)}
                      />
                    ))}
                  </MentionSection>
                ) : null}
              </div>
            </div>
          ) : null}

          {selectedContextItems.length > 0 ? (
            <div className={styles.chips} aria-label={t('homeHero.contextSurfaces')}>
              {selectedContextItems.map((item) => (
                <button
                  key={`${item.kind}-${item.id}`}
                  type="button"
                  className={styles.chip}
                  onClick={() => removeSelectedContext(item.kind, item.id)}
                  title={t('chat.removeAria', { name: item.label })}
                >
                  <i className={`fa-solid fa-${item.glyph}`} aria-hidden="true" />
                  <span>{item.label}</span>
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}

          {/* `AutomationsScreen.jsx:233`. "OpenDesign" in the reference copy is
              the internal name; the user-facing product is MMS Design. */}
          <div className={styles.runtimeNote}>
            <span className={styles.runtimeDot} aria-hidden="true" />
            <div>
              <strong>{t('automations.runtimeNoteTitle')}</strong>
              <small>
                {hubContext?.client && hubContext?.project
                  ? t('automations.runtimeNoteBody', {
                      client: hubContext.client,
                      project: hubContext.project,
                    })
                  : t('automations.runtimeNoteBodyUnscoped')}
              </small>
            </div>
          </div>

          {error ? (
            <div className={styles.modalError} role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <footer className={styles.composeFoot}>
          <div className={styles.footerPills}>
            <span className={styles.menuWrap}>
              <button
                ref={projectTriggerRef}
                type="button"
                className={`${styles.pill} ${popover === 'project' ? styles.pillActive : ''}`.trim()}
                aria-haspopup="menu"
                aria-expanded={popover === 'project'}
                onClick={() => setPopover((open) => (open === 'project' ? null : 'project'))}
              >
                <i className="fa-solid fa-folder" aria-hidden="true" />
                <span className={styles.pillLabel}>{projectLabel}</span>
                <i className="fa-solid fa-chevron-down" aria-hidden="true" />
              </button>
              {popover === 'project' ? (
                <div
                  ref={popoverPanelRef}
                  className={`${styles.popover} ${styles.popoverUp}`}
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setForm({ ...form, mode: 'create_each_run', projectId: '' });
                      setPopover(null);
                    }}
                  >
                    <i
                      className={`fa-solid fa-${form.mode === 'create_each_run' ? 'check' : 'plus'}`}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{t('automations.targetCreateEachRun')}</strong>
                      <small>{t('routines.modeCreateHint')}</small>
                    </span>
                  </button>
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      role="menuitem"
                      // Native tooltip for names the 290px row clips (#3274).
                      title={project.name}
                      onClick={() => {
                        setForm({ ...form, mode: 'reuse', projectId: project.id });
                        setPopover(null);
                      }}
                    >
                      <i
                        className={`fa-solid fa-${
                          form.mode === 'reuse' && form.projectId === project.id ? 'check' : 'folder'
                        }`}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{project.name}</strong>
                        <small>{t('routines.modeReuseHint')}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </span>

            <span className={styles.menuWrap}>
              <button
                ref={scheduleTriggerRef}
                type="button"
                className={`${styles.pill} ${popover === 'schedule' ? styles.pillActive : ''}`.trim()}
                aria-haspopup="dialog"
                aria-expanded={popover === 'schedule'}
                aria-label={scheduleLabel}
                onClick={() => setPopover((open) => (open === 'schedule' ? null : 'schedule'))}
              >
                <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
                <span className={styles.pillLabel}>{scheduleLabel}</span>
                <i className="fa-solid fa-chevron-down" aria-hidden="true" />
              </button>
              {popover === 'schedule' ? (
                <div
                  ref={popoverPanelRef}
                  className={styles.schedulePopover}
                  role="dialog"
                  aria-label={t('routines.fieldSchedule')}
                >
                  <div className={styles.scheduleKindRow} role="tablist">
                    {SCHEDULE_KINDS.map((entry) => (
                      <button
                        type="button"
                        key={entry.kind}
                        role="tab"
                        aria-selected={form.kind === entry.kind}
                        className={form.kind === entry.kind ? styles.scheduleKindActive : undefined}
                        onClick={() => setForm({ ...form, kind: entry.kind })}
                      >
                        {t(entry.labelKey)}
                      </button>
                    ))}
                  </div>

                  {form.kind === 'hourly' ? (
                    <label className={styles.scheduleField}>
                      <span>{t('routines.fieldMinute')}</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        step={1}
                        value={form.minute}
                        onChange={(event) =>
                          setForm({ ...form, minute: clampMinute(Number(event.target.value)) })
                        }
                      />
                    </label>
                  ) : (
                    <>
                      {form.kind === 'weekly' ? (
                        <label className={styles.scheduleField}>
                          <span>{t('automations.scheduleDay')}</span>
                          <select
                            value={String(form.weekday)}
                            onChange={(event) =>
                              setForm({ ...form, weekday: Number(event.target.value) as Weekday })
                            }
                          >
                            {WEEKDAY_ORDER.map((day) => (
                              <option key={day} value={String(day)}>
                                {t(`routines.weekday.long.${day}` as keyof Dict)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label className={styles.scheduleField}>
                        <span>{t('routines.fieldTime')}</span>
                        <input
                          type="time"
                          value={form.time}
                          onChange={(event) => setForm({ ...form, time: event.target.value })}
                        />
                      </label>
                      <label className={styles.scheduleField}>
                        <span>{t('routines.fieldTimezone')}</span>
                        <select
                          value={form.timezone}
                          onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                        >
                          {timezones.map((tz) => (
                            <option key={tz} value={tz}>
                              {tzCityLabel(tz)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}

                  <button
                    type="button"
                    className={styles.scheduleDone}
                    onClick={() => setPopover(null)}
                  >
                    {t('automations.scheduleDone')}
                  </button>
                </div>
              ) : null}
            </span>
          </div>

          <div className={styles.submitActions}>
            <button type="button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.submitPrimary}
              disabled={submitting || !form.name.trim() || !form.prompt.trim()}
            >
              {submitting
                ? t('common.loading')
                : editingId
                  ? t('common.save')
                  : t('common.create')}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function filterCapabilities<T>(values: T[], query: string, index: (value: T) => string): T[] {
  if (!query) return values;
  return values.filter((value) => index(value).toLowerCase().includes(query));
}

function readContextMention(value: string, cursor: number): ContextMention | null {
  const beforeCursor = value.slice(0, cursor);
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCursor);
  if (!match) return null;
  const prefix = match[1] ?? '';
  return { start: match.index + prefix.length, end: cursor, query: match[2] ?? '' };
}

function MentionSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.contextSection}>
      <div className={styles.contextSectionLabel}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function MentionItem({
  glyph,
  label,
  meta,
  selected,
  onPick,
}: {
  glyph: string;
  label: string;
  meta: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={styles.contextItem}
      onMouseDown={(event) => {
        event.preventDefault();
        onPick();
      }}
    >
      <span className={styles.contextItemIcon} aria-hidden="true">
        <i className={`fa-solid fa-${selected ? 'check' : glyph}`} />
      </span>
      <span className={styles.contextItemBody}>
        <strong>{label}</strong>
        <small>{meta}</small>
      </span>
    </button>
  );
}
