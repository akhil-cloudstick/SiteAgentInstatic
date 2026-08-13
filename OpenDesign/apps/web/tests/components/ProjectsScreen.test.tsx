// @vitest-environment jsdom

/**
 * The rebuilt `/projects` screen — the approved MMS Design reference's three
 * blocks (page head, handoff band, linked-projects panel) driven by real
 * project data.
 *
 * These replace the DesignsTab grid/kanban suites. What they hold onto is what
 * the rebuild is allowed to have changed and what it is not: the reference's
 * blocks are present, the removed controls stay removed, the row's actions
 * still reach the same handlers, and the banned product name never renders.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectsScreen } from '../../src/components/ProjectsScreen';
import type { DesignSystemSummary, Project } from '../../src/types';

vi.mock('../../src/analytics/provider', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));

vi.mock('../../src/state/hubContext', () => ({
  useHubContext: () => null,
}));

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Harbour Suites website',
    skillId: 'prototype',
    designSystemId: null,
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 30_000,
    status: { value: 'succeeded' },
    ...overrides,
  } as Project;
}

const DESIGN_SYSTEMS: DesignSystemSummary[] = [
  { id: 'ds-1', title: 'Harbour Suites DS', category: 'web', summary: '', status: 'published' },
];

function renderScreen(projects: Project[], overrides: Record<string, unknown> = {}) {
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  const onRename = vi.fn();
  const onDuplicate = vi.fn();
  render(
    <ProjectsScreen
      projects={projects}
      designSystems={DESIGN_SYSTEMS}
      onOpen={onOpen}
      onDelete={onDelete}
      onRename={onRename}
      onDuplicate={onDuplicate}
      {...overrides}
    />,
  );
  return { onOpen, onDelete, onRename, onDuplicate };
}

afterEach(() => {
  cleanup();
});

describe('ProjectsScreen — reference shape', () => {
  it('renders the reference page head, list panel and one row per project', () => {
    renderScreen([
      makeProject({ id: 'p1', name: 'Alpha' }),
      makeProject({ id: 'p2', name: 'Beta' }),
    ]);

    expect(screen.getByText('MMS DESIGN PROJECTS')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Linked projects' })).toBeTruthy();
    expect(screen.getAllByTestId('linked-project-row')).toHaveLength(2);
  });

  it('pluralises the panel count', () => {
    renderScreen([makeProject()]);
    expect(screen.getByText('1 project')).toBeTruthy();

    cleanup();
    renderScreen([makeProject({ id: 'a' }), makeProject({ id: 'b' }), makeProject({ id: 'c' })]);
    expect(screen.getByText('3 projects')).toBeTruthy();
  });

  it('orders rows by most recently updated', () => {
    const now = Date.now();
    renderScreen([
      makeProject({ id: 'old', name: 'Older', updatedAt: now - 90_000 }),
      makeProject({ id: 'new', name: 'Newest', updatedAt: now - 1_000 }),
      makeProject({ id: 'mid', name: 'Middle', updatedAt: now - 40_000 }),
    ]);

    const names = screen
      .getAllByTestId('linked-project-row')
      .map((row) => within(row).getByRole('heading', { level: 3 }).textContent);
    expect(names).toEqual(['Newest', 'Middle', 'Older']);
  });

  it('paints the head and panel frame while the rows are still loading', () => {
    render(
      <ProjectsScreen
        projects={[]}
        designSystems={DESIGN_SYSTEMS}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        loading
      />,
    );

    // The whole page must not be replaced by a spinner — only the list body.
    expect(screen.getByText('MMS DESIGN PROJECTS')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Linked projects' })).toBeTruthy();
    const busy = screen.getByTestId('projects-loading');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    // Animated skeleton rows, not a spinner — a static glyph read as hung.
    expect(busy.querySelectorAll('[class*="skeletonRow"]').length).toBeGreaterThan(0);
    // …plus a sweeping progress bar, so the wait is unmistakably in motion.
    expect(document.querySelector('[class*="progressTrack"]')).toBeTruthy();
    // No "0 projects" claim before the count is known.
    expect(screen.queryByText(/\d+ projects?/)).toBeNull();
    expect(screen.queryByTestId('projects-empty')).toBeNull();
  });

  it('drops the progress bar once loading finishes', () => {
    renderScreen([makeProject()]);
    expect(document.querySelector('[class*="progressTrack"]')).toBeNull();
    expect(screen.queryByTestId('projects-loading')).toBeNull();
  });

  it('gives the handoff band the same width as the list panel', () => {
    const { container } = render(
      <ProjectsScreen
        projects={[makeProject()]}
        designSystems={DESIGN_SYSTEMS}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    // Both are flex items whose `margin: 0 auto` would otherwise shrink them to
    // content width instead of stretching — they must carry the width class.
    const band = container.querySelector('.sd-handoff');
    expect(band?.className).toMatch(/handoffCompact/);
  });

  it('shows the empty state, with no create button of its own', () => {
    renderScreen([]);

    const empty = screen.getByTestId('projects-empty');
    expect(empty.textContent).toContain('No projects yet.');
    expect(screen.queryAllByTestId('linked-project-row')).toHaveLength(0);
    // `New project` belongs to the specialist row above this screen.
    expect(screen.queryByRole('button', { name: /new project/i })).toBeNull();
  });

  it('does not reintroduce the controls the rebuild removed', () => {
    const { container } = render(
      <ProjectsScreen
        projects={[makeProject()]}
        designSystems={DESIGN_SYSTEMS}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(container.querySelector('.tab-panel-toolbar')).toBeNull();
    expect(container.querySelector('.design-grid')).toBeNull();
    expect(container.querySelector('.design-kanban-board')).toBeNull();
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /your designs/i })).toBeNull();
    expect(screen.queryByRole('group', { name: /view mode/i })).toBeNull();
  });

  it('never renders the banned product name', () => {
    const { container } = render(
      <ProjectsScreen
        projects={[makeProject(), makeProject({ id: 'p2', metadata: { kind: 'deck' } })]}
        designSystems={DESIGN_SYSTEMS}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(container.textContent ?? '').not.toMatch(/open\s*design/i);
  });
});

describe('ProjectsScreen — row actions', () => {
  it('opens a project from the row button, not the row body', () => {
    const { onOpen } = renderScreen([makeProject({ id: 'p9', name: 'Openable' })]);

    // The reference row is not a click target.
    fireEvent.click(screen.getByRole('heading', { level: 3, name: 'Openable' }));
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('open-studio'));
    expect(onOpen).toHaveBeenCalledWith('p9');
  });

  it('exposes rename, duplicate and delete on the row kebab', () => {
    renderScreen([makeProject({ name: 'Kebab Project' })]);

    fireEvent.click(screen.getByRole('button', { name: /more actions for Kebab Project/i }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /rename/i })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /duplicate/i })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /delete/i })).toBeTruthy();
  });

  it('omits duplicate when no handler is supplied', () => {
    render(
      <ProjectsScreen
        projects={[makeProject({ name: 'No Dup' })]}
        designSystems={DESIGN_SYSTEMS}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /more actions for No Dup/i }));
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: /duplicate/i })).toBeNull();
  });

  it('renames through the dialog and rejects an unchanged name', () => {
    const { onRename } = renderScreen([makeProject({ id: 'p3', name: 'Before' })]);

    fireEvent.click(screen.getByRole('button', { name: /more actions for Before/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }));

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('Before');

    const save = screen.getByRole('button', { name: /save|ok/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'After' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onRename).toHaveBeenCalledWith('p3', 'After');
  });

  it('deletes only after the confirm dialog is accepted', () => {
    const { onDelete } = renderScreen([makeProject({ id: 'p4', name: 'Doomed' })]);

    fireEvent.click(screen.getByRole('button', { name: /more actions for Doomed/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Doomed');
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    expect(onDelete).toHaveBeenCalledWith('p4');
  });

  it('closes the kebab on Escape and returns focus to its trigger', () => {
    renderScreen([makeProject({ name: 'Dismissable' })]);

    const trigger = screen.getByRole('button', { name: /more actions for Dismissable/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('ProjectsScreen — row content', () => {
  it('labels a website-shaped project and shows its design system', () => {
    renderScreen([
      makeProject({
        name: 'Harbour Suites website',
        designSystemId: 'ds-1',
        metadata: { kind: 'prototype', intent: 'web-clone' },
      }),
    ]);

    const row = screen.getByTestId('linked-project-row');
    expect(within(row).getByText('WEBSITE')).toBeTruthy();
    expect(row.textContent).toContain('Harbour Suites DS');
    expect(row.textContent).toContain('Editable MMS Design project for the Harbour Suites website');
  });

  it('renders the reference four meta chips, with the design system status', () => {
    renderScreen([
      makeProject({
        name: 'Harbour Suites website',
        designSystemId: 'ds-1',
        status: { value: 'succeeded' },
      }),
    ]);

    const chips = screen
      .getByTestId('linked-project-row')
      .querySelectorAll('[class*="rowMeta"] > span');
    expect(chips).toHaveLength(4);

    const text = screen.getByTestId('linked-project-row').textContent ?? '';
    // 1 — "{design system} · {publish state}", both halves as in the reference.
    expect(text).toContain('Harbour Suites DS · Published');
    // 3 — Product Hub inheritance stands in for the reference's snapshot chip.
    expect(text).toContain('No Product Hub context');
    // 4 — "Updated {relative}", not a bare timestamp.
    expect(text).toMatch(/Updated\s/);
  });

  it('falls back to the freeform label when no design system is bound', () => {
    renderScreen([makeProject({ designSystemId: null })]);
    expect(screen.getByTestId('linked-project-row').textContent).toContain('freeform');
  });

  it('marks the row as Hub-linked only when Product Hub scoped this session', () => {
    // useHubContext is mocked to null for this suite, so nothing is linked.
    renderScreen([makeProject({ name: 'Unlinked' })]);
    expect(screen.getByTestId('linked-project-row').textContent).not.toContain(
      'PRODUCT HUB LINKED',
    );
  });
});
