/**
 * StartDesk — the client-approved MMS Design home screen ("Website Start Desk").
 *
 * Rebuilt from the MMSBUILD developer handoff (owner-approved 2026-08-10),
 * which ships the screen as running source rather than a picture. Layout,
 * copy, spacing and interaction all come from there; `start-desk.css` carries
 * the geometry and `context-surfaces.css` the Product Hub surfaces.
 *
 * ── Scope ────────────────────────────────────────────────────────────────
 * DECISIONS.md 2026-08-09 locks this screen to six website starts. The other
 * creation types the app supports (decks, media, documents …) are deliberately
 * absent HERE — they remain reachable through New project and the Plugins view.
 * Nothing about their behaviour changed; only this screen's contents did.
 *
 * ── What this component does not own ─────────────────────────────────────
 * It is a view. Prompt state, plugin binding, project creation, design-system
 * and working-directory selection all stay where they were, and arrive as
 * props. Swapping the home screen must not move a single line of that logic.
 *
 * ── No dead controls ─────────────────────────────────────────────────────
 * Every control here reaches something real. The conversation mode drives the
 * run's `conversationMode`; each Add-context entry opens the surface it names;
 * the footer's design system and working directory are the values the next run
 * is created with. A control that could only print a hint about itself was
 * removed rather than left to look operable.
 */
import { useMemo, useRef, useState } from 'react';
import type { HubContext } from '@mms/shell';
import './start-desk.css';
import './context-surfaces.css';
import { deriveInheritedContext } from './inherited-context';
import { ContextHandoffBand, CloneBoundary, InheritedContextChips } from './ContextSurfaces';
import { ProductHubContextDrawer } from './ProductHubContextDrawer';
import { useDismissable } from './useDismissable';

/**
 * The six approved starts, with the reference's exact labels, descriptions and
 * requirement lines. `id` maps onto the creation path the app already has —
 * see `onStart` in the host.
 */
export const WEBSITE_STARTS = [
  {
    id: 'website-clone',
    label: 'Website clone',
    description: 'Source-first site reproduction',
    requirement: 'Target URL + Local CLI for file edits',
    icon: 'globe',
  },
  {
    id: 'prototype',
    label: 'Website',
    description: 'Build a new site from a brief',
    requirement: 'Brief + target platform',
    icon: 'file-code',
  },
  {
    id: 'wireframe',
    label: 'Wireframe',
    description: 'Lo-fi screens & flows',
    requirement: 'Flow + wireframe fidelity',
    icon: 'border-all',
  },
  {
    id: 'design-system',
    label: 'Create Design System',
    description: 'Build a reusable system from scratch',
    requirement: 'Brand files, URL, repo or DESIGN.md',
    icon: 'palette',
  },
  {
    id: 'from-template',
    label: 'From template',
    description: 'Start from a saved template',
    requirement: 'A saved website template',
    icon: 'layer-group',
  },
  {
    id: 'blank-project',
    label: 'Blank project',
    description: 'Start with an empty canvas',
    requirement: 'Local CLI + working directory',
    icon: 'plus',
  },
] as const;

export type StartId = (typeof WEBSITE_STARTS)[number]['id'];

/**
 * Per-start placeholder copy. The reference writes a specific line for the four
 * starts whose brief differs in kind, and generates the rest — a start whose
 * required input is a URL should not be asking for a description.
 */
const PROMPT_PLACEHOLDER: Partial<Record<StartId, string>> = {
  'website-clone':
    'Paste the authorized website URL, then describe what the visual reproduction must preserve…',
  'design-system': 'Describe the website brand system and attach its approved source material…',
  'from-template': 'Describe how the saved website template should be adapted…',
  'blank-project': 'Describe the website you want to build from an empty canvas…',
};

/** Add-context entries. Each one opens the surface it names — see `onAddContext`. */
export const CONTEXT_OPTIONS = [
  {
    id: 'attach',
    label: 'Attach files',
    detail: 'Drag, paste or choose local files',
    icon: 'paperclip',
  },
  {
    id: 'project',
    label: 'Reference another project',
    detail: 'Requires an accessible project',
    icon: 'folder-tree',
  },
  {
    id: 'local-code',
    label: 'Link local code',
    detail: 'Read-only context from a trusted folder',
    icon: 'file-code',
  },
  { id: 'plugins', label: 'Plugins', detail: 'Use an installed workflow plugin', icon: 'puzzle-piece' },
  {
    id: 'figma',
    label: 'Import from Figma',
    detail: 'Offline .fig or an OAuth-connected URL',
    icon: 'arrow-up-from-bracket',
  },
  { id: 'connectors', label: 'Connectors', detail: 'Use configured external data', icon: 'link' },
  { id: 'mcp', label: 'MCP', detail: 'Use a configured MCP server', icon: 'plug' },
] as const;

export type ContextOptionId = (typeof CONTEXT_OPTIONS)[number]['id'];

/**
 * Conversation modes. These are the daemon's real session modes — picking one
 * changes what the next run is allowed to do, not just what the button says.
 */
export const MODES = [
  { id: 'plan', label: 'Plan', detail: 'Work out the approach before changing the artifact' },
  { id: 'design', label: 'Design', detail: 'Create or revise the design artifact' },
  { id: 'ask', label: 'Ask', detail: 'Discuss the project without changing files' },
] as const;

export type StartDeskMode = (typeof MODES)[number]['id'];

const RUNTIMES = [
  {
    id: 'local-cli',
    label: 'Local CLI',
    detail: 'Required when the run must read, write or edit project files',
    icon: 'terminal',
  },
  {
    id: 'byok',
    label: 'BYOK',
    detail: 'Provider key + model; deployed fork cannot edit project files',
    icon: 'key',
  },
] as const;

export type StartDeskRuntime = (typeof RUNTIMES)[number]['id'];

/**
 * Show the Local CLI / BYOK runtime picker in the composer's last row.
 *
 * Set to `false` to HIDE the control without deleting it — the runtime keeps
 * working, it just stays on whatever the host has selected (`local-cli` by
 * default, which is the one that can write project files). Set back to `true`
 * to bring the control back; nothing else has to change.
 *
 * Hidden rather than removed because the BYOK path is still wired: `submit()`
 * below still refuses to start a file-editing run on `byok`, and the BYOK
 * boundary note still renders. If you hide the picker while the runtime is
 * already `byok`, Send will keep refusing with no visible way to switch back —
 * so hide it from the Local CLI default, not from a BYOK session.
 */
const SHOW_RUNTIME_PICKER = false;

export interface StartDeskProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  /** Fires when a start is chosen AND its preconditions are met. */
  onStart: (start: StartId, context: { prompt: string }) => void;
  /**
   * A start is in flight (binding the scenario, creating the project, opening
   * the run). Send has to reflect it: the work behind this click can take a
   * while, and with no busy state the desk looked frozen, so users clicked Send
   * repeatedly and then clicked away believing it had hung.
   */
  sending?: boolean;
  /** Blank project bypasses the composer entirely — it needs no brief. */
  onBlankProject: () => void;
  onOpenTemplates: () => void;
  onCreateDesignSystem: () => void;
  /** Opens the real surface behind an Add-context entry. */
  onAddContext: (optionId: ContextOptionId) => void;
  /**
   * Short status per Add-context entry, shown in the reference's badge slot —
   * e.g. how many MCP servers are configured. The reference labels this slot
   * `MMS fork` / `Upstream`, which described its own prototype rather than
   * anything a user can act on; the slot is kept and filled with the source's
   * real state instead. Omit an entry to leave its badge off.
   */
  contextBadges?: Partial<Record<ContextOptionId, string>>;
  onNotice: (message: string) => void;
  onViewAllProjects: () => void;

  /** Conversation mode, owned by the host so it reaches the created run. */
  mode: StartDeskMode;
  onModeChange: (mode: StartDeskMode) => void;
  /** Execution runtime, owned by the host so it reaches provider config. */
  runtime: StartDeskRuntime;
  onRuntimeChange: (runtime: StartDeskRuntime) => void;
  /** Label for the template control; `null` renders the reference's "None". */
  templateLabel?: string | null;
  /** Opens the outline / prompt-template surface. Omit to hide the control. */
  onOpenOutline?: () => void;

  /** Live label for the composer footer's design-system control. */
  designSystemName?: string | null;
  designSystemSlot?: React.ReactNode;
  workingDirSlot?: React.ReactNode;
  recentProjectsSlot?: React.ReactNode;

  /** Files already staged on the host, rendered as removable chips. */
  attachments?: Array<{ id: string; name: string }>;
  onRemoveAttachment?: (id: string) => void;
  /** Receives files from the hidden picker and from a drop on the composer. */
  onAttachFiles?: (files: File[]) => void;

  /** The Product Hub hand-off this session was opened with, or null. */
  hubContext?: HubContext | null;
}

export function StartDesk({
  prompt,
  onPromptChange,
  onStart,
  sending = false,
  onBlankProject,
  onOpenTemplates,
  onCreateDesignSystem,
  onAddContext,
  contextBadges,
  onNotice,
  onViewAllProjects,
  mode,
  onModeChange,
  runtime,
  onRuntimeChange,
  templateLabel,
  onOpenOutline,
  designSystemName,
  designSystemSlot,
  workingDirSlot,
  recentProjectsSlot,
  attachments,
  onRemoveAttachment,
  onAttachFiles,
  hubContext = null,
}: StartDeskProps) {
  const [activeId, setActiveId] = useState<StartId>('website-clone');
  const [openMenu, setOpenMenu] = useState<string>('');
  const [contextOpen, setContextOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const active = WEBSITE_STARTS.find((item) => item.id === activeId) ?? WEBSITE_STARTS[0];
  const placeholder =
    PROMPT_PLACEHOLDER[active.id] ?? `Describe the ${active.label.toLowerCase()} you want to make…`;
  const activeMode = MODES.find((item) => item.id === mode) ?? MODES[1];
  const activeRuntime = RUNTIMES.find((item) => item.id === runtime) ?? RUNTIMES[0];

  const inherited = useMemo(
    () => deriveInheritedContext(hubContext, designSystemName ?? null),
    [hubContext, designSystemName],
  );

  // Every popover on this screen closes on an outside press, on scroll, on
  // Escape and on resize. Without it an absolutely-positioned menu detaches
  // from its trigger the moment the page moves underneath it.
  useDismissable({
    open: openMenu !== '',
    panelRef: menuPanelRef,
    triggerRef: menuTriggerRef,
    onDismiss: () => setOpenMenu(''),
  });

  const toggleMenu = (name: string) => setOpenMenu((current) => (current === name ? '' : name));

  function focusPrompt(): void {
    window.requestAnimationFrame(() => {
      promptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      promptRef.current?.focus({ preventScroll: true });
    });
  }

  function acceptFiles(files: File[]): void {
    if (files.length === 0 || !onAttachFiles) return;
    onAttachFiles(files);
    setOpenMenu('');
    onNotice(
      `${files.length} file${files.length === 1 ? '' : 's'} attached as local context.`,
    );
  }

  /**
   * Send. The guards are the reference's, and each exists because the run would
   * otherwise fail later and less clearly: a clone with no URL has no source, and
   * BYOK cannot write the project files every one of these starts produces.
   */
  function submit(): void {
    if (active.id === 'from-template') {
      onOpenTemplates();
      return;
    }
    if (active.id === 'design-system') {
      onCreateDesignSystem();
      return;
    }
    if (runtime === 'byok') {
      onNotice(
        'Choose Local CLI before entering the website Studio because this flow changes project files.',
      );
      return;
    }
    if (active.id === 'website-clone' && !/https?:\/\/\S+/i.test(prompt)) {
      onNotice('Paste the target website URL before opening Website clone in Project Studio.');
      focusPrompt();
      return;
    }
    onStart(active.id, { prompt });
  }

  /**
   * Card click. Two starts are deliberately not "select then Send":
   * Blank project needs no brief so it opens immediately, and Website clone
   * stays here until a URL exists (DECISIONS.md 2026-08-09, start routing).
   */
  function chooseStart(id: StartId): void {
    if (id === 'blank-project') {
      onBlankProject();
      return;
    }
    setActiveId(id);
    if (id === 'website-clone') {
      onPromptChange(prompt.trim() ? prompt : 'Website URL to clone: ');
      onNotice('Website clone selected. Paste the target URL above; Send opens Project Studio.');
      focusPrompt();
      return;
    }
    const start = WEBSITE_STARTS.find((item) => item.id === id);
    if (start) onNotice(`${start.label} selected. Needs: ${start.requirement}.`);
  }

  return (
    <main className="start-desk">
      <div className="start-desk__intro">
        <p className="start-desk__eyebrow">WEBSITE START DESK</p>
        <h1 className="start-desk__title">Build or redesign a website</h1>
        <p className="start-desk__subtitle">
          Choose a verified OpenDesign start, add the brief and select the runtime that can do the
          work.
        </p>
      </div>

      <ContextHandoffBand context={inherited} onOpenContext={() => setContextOpen(true)} />

      {/* `CloneBoundary` is intentionally not rendered. It explained the split
          between Product Hub's governed capture and MMS Design's editable
          rebuild — accurate, but it took a full row on every Website clone to
          restate a division of labour the operator already knows.
          `CloneBoundary` stays exported for the surfaces that still want it. */}

      <section
        className="start-desk__composer"
        aria-label="Website brief"
        onDragOver={(event) => {
          if (onAttachFiles) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!onAttachFiles) return;
          event.preventDefault();
          acceptFiles(Array.from(event.dataTransfer.files ?? []));
        }}
      >
        {onAttachFiles && (
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            multiple
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
        )}

        <div className="start-desk__chip-row">
          <span className="start-desk__type-chip">
            <i className={`fa-solid fa-${active.icon}`} aria-hidden="true" />
            {active.label}
          </span>
          <InheritedContextChips
            context={inherited}
            onOpenContext={() => setContextOpen(true)}
          />
          {(attachments ?? []).map((file) => (
            <button
              type="button"
              className="start-desk__file-chip"
              key={file.id}
              onClick={() => onRemoveAttachment?.(file.id)}
              aria-label={`Remove ${file.name}`}
            >
              <i className="fa-solid fa-paperclip" aria-hidden="true" />
              {file.name}
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          ))}
        </div>

        <textarea
          ref={promptRef}
          className="start-desk__prompt"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={placeholder}
          aria-label="Describe the project"
        />

        <div className="start-desk__hint">
          <i className="fa-solid fa-at" aria-hidden="true" /> Type @ to search design files, plugins,
          skills, MCP and connectors.
        </div>

        <div className="start-desk__controls">
          {onOpenOutline && (
            <button type="button" className="start-desk__control" onClick={onOpenOutline}>
              <i className="fa-solid fa-list-check" aria-hidden="true" />
              Outline
            </button>
          )}

          <div className="start-desk__control-wrap">
            <button
              type="button"
              ref={openMenu === 'context' ? menuTriggerRef : undefined}
              className="start-desk__control"
              onClick={() => toggleMenu('context')}
              aria-expanded={openMenu === 'context'}
              aria-haspopup="menu"
            >
              <i className="fa-solid fa-plus" aria-hidden="true" />
              Add context
              <i className="fa-solid fa-chevron-down" aria-hidden="true" />
            </button>
            {openMenu === 'context' && (
              <div
                className="start-desk__menu"
                role="menu"
                aria-label="Add context"
                ref={menuPanelRef}
              >
                {CONTEXT_OPTIONS.map((option) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={option.id}
                    className="start-desk__menu-option"
                    onClick={() => {
                      setOpenMenu('');
                      // Attach is the one entry the composer services itself:
                      // the picker is right here, so routing it out to the host
                      // and back would only add a frame of latency.
                      if (option.id === 'attach' && onAttachFiles) {
                        fileInputRef.current?.click();
                        return;
                      }
                      onAddContext(option.id);
                    }}
                  >
                    <span className="start-desk__menu-icon">
                      <i className={`fa-solid fa-${option.icon}`} aria-hidden="true" />
                    </span>
                    <span className="start-desk__menu-copy">
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                    </span>
                    {contextBadges?.[option.id] && (
                      <span className="start-desk__badge">{contextBadges[option.id]}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button type="button" className="start-desk__control" onClick={onOpenTemplates}>
            <i className="fa-solid fa-layer-group" aria-hidden="true" />
            Template: {templateLabel?.trim() || 'None'}
            <i className="fa-solid fa-chevron-down" aria-hidden="true" />
          </button>

          <div className="start-desk__control-wrap">
            <button
              type="button"
              ref={openMenu === 'mode' ? menuTriggerRef : undefined}
              className="start-desk__control"
              onClick={() => toggleMenu('mode')}
              aria-expanded={openMenu === 'mode'}
              aria-haspopup="menu"
            >
              <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
              {activeMode.label}
              <i className="fa-solid fa-chevron-down" aria-hidden="true" />
            </button>
            {openMenu === 'mode' && (
              <div
                className="start-desk__menu"
                role="menu"
                aria-label="Conversation mode"
                ref={menuPanelRef}
              >
                {MODES.map((option) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === option.id}
                    key={option.id}
                    className="start-desk__menu-option"
                    data-active={mode === option.id}
                    onClick={() => {
                      onModeChange(option.id);
                      setOpenMenu('');
                    }}
                  >
                    <span className="start-desk__menu-icon">
                      <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
                    </span>
                    <span className="start-desk__menu-copy">
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>


        <div className="start-desk__footer">
          <label>
            <i className="fa-solid fa-palette" aria-hidden="true" />
            <span>Design system:</span>
            {designSystemSlot}
          </label>
          {/* Runtime picker. Lives in the last row so it carries the full
              commit decision alongside Send: what the run builds with, and go.
              ────────────────────────────────────────────────────────────────
              SHOW_RUNTIME_PICKER is the on/off switch. Flip it to `true` to
              bring the Local CLI / BYOK control back — nothing else needs to
              change, and the runtime itself keeps working either way (it just
              stays on whatever `runtime` already is, which defaults to Local
              CLI). A JSX block cannot be commented out with slash-slash or a
              plain C-style comment, and a JSX brace-comment cannot nest inside
              a block that already contains one, so a flag is the way to hide
              this subtree. */}
          {SHOW_RUNTIME_PICKER && (
          <div className="start-desk__control-wrap start-desk__control-wrap--trailing">
            <button
              type="button"
              ref={openMenu === 'runtime' ? menuTriggerRef : undefined}
              className="start-desk__control"
              onClick={() => toggleMenu('runtime')}
              aria-expanded={openMenu === 'runtime'}
              aria-haspopup="menu"
            >
              <i className={`fa-solid fa-${activeRuntime.icon}`} aria-hidden="true" />
              {activeRuntime.label}
              <i className="fa-solid fa-chevron-down" aria-hidden="true" />
            </button>
            {openMenu === 'runtime' && (
              <div
                className="start-desk__menu"
                role="menu"
                aria-label="Execution runtime"
                ref={menuPanelRef}
              >
                {RUNTIMES.map((option) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={runtime === option.id}
                    key={option.id}
                    className="start-desk__menu-option"
                    data-active={runtime === option.id}
                    onClick={() => {
                      onRuntimeChange(option.id);
                      setOpenMenu('');
                    }}
                  >
                    <span className="start-desk__menu-icon">
                      <i className={`fa-solid fa-${option.icon}`} aria-hidden="true" />
                    </span>
                    <span className="start-desk__menu-copy">
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          )}
          {/* Send lives in this last row, beside the design-system picker, rather
              than in the controls row above — the row it used to share held the
              context/template/mode controls, and the footer had free space once
              the working-directory picker came out. */}
          <button
            type="button"
            className="start-desk__send"
            onClick={submit}
            disabled={sending}
            aria-busy={sending}
          >
            {sending ? (
              <span className="sd-spinner" aria-hidden="true" />
            ) : (
              <i className="fa-solid fa-paper-plane" aria-hidden="true" />
            )}
            {sending ? 'Starting…' : 'Send'}
          </button>
          {/* Working-directory picker removed from this screen by request. The
              prop is still accepted so the host keeps passing its slot and no
              caller breaks; a run simply starts without a working directory,
              which is what "Not selected" already meant. */}
        </div>

        {runtime === 'byok' && (
          <div className="start-desk__boundary" role="note">
            <i className="fa-solid fa-circle-info" aria-hidden="true" /> BYOK can generate an
            artifact, but the verified MMS fork cannot read, write or edit project files. Choose
            Local CLI for code changes.
          </div>
        )}
      </section>

      <section className="start-desk__starts" aria-label="Website design starts">
        <div className="start-desk__starter-grid">
          {WEBSITE_STARTS.map((card) => (
            <button
              type="button"
              key={card.id}
              className="start-desk__starter"
              data-active={card.id === activeId}
              aria-pressed={card.id === activeId}
              onClick={() => chooseStart(card.id)}
            >
              <span className="start-desk__starter-icon">
                <i className={`fa-solid fa-${card.icon}`} aria-hidden="true" />
              </span>
              <span className="start-desk__starter-copy">
                <strong>{card.label}</strong>
                <small>{card.description}</small>
                <span className="start-desk__starter-needs">Needs: {card.requirement}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="start-desk__recents">
        <div className="start-desk__section-head">
          <h2>Recent projects</h2>
          <button type="button" onClick={onViewAllProjects}>
            View all projects <i className="fa-solid fa-arrow-right" aria-hidden="true" />
          </button>
        </div>
        {recentProjectsSlot}
      </section>

      <ProductHubContextDrawer
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        context={inherited}
        hubContext={hubContext}
      />
    </main>
  );
}
