// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesignSystemSummary } from '@open-design/contracts';

import { DesignSystemsScreen } from '../../src/components/DesignSystemsScreen';
import { updateDesignSystemDraft } from '../../src/providers/registry';

const exportMocks = vi.hoisted(() => ({
  downloadDesignSystemArchive: vi.fn(async () => true),
  downloadProjectArchive: vi.fn(async () => false),
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    fetchDesignSystem: vi.fn(async (id: string) => ({
      id,
      title: id === 'linear' ? 'Linear' : 'Acme Design System',
      summary: id === 'linear' ? 'Quiet issue-tracker system.' : 'Internal product system.',
      category: id === 'linear' ? 'Productivity & SaaS' : 'Custom',
      body: `# ${id}\n\n## Colors\n- Primary #111111`,
    })),
    updateDesignSystemDraft: vi.fn(async () => null),
    deleteDesignSystemDraft: vi.fn(async () => true),
    openFolderDialog: vi.fn(async () => null),
  };
});

vi.mock('../../src/runtime/exports', () => exportMocks);

afterEach(() => {
  cleanup();
  exportMocks.downloadDesignSystemArchive.mockReset();
  exportMocks.downloadDesignSystemArchive.mockResolvedValue(true);
  exportMocks.downloadProjectArchive.mockReset();
  exportMocks.downloadProjectArchive.mockResolvedValue(false);
  vi.restoreAllMocks();
});

const systems: DesignSystemSummary[] = [
  {
    id: 'user:acme',
    title: 'Acme Design System',
    category: 'Custom',
    summary: 'Internal product system.',
    surface: 'web',
    source: 'user',
    status: 'draft',
    isEditable: true,
    updatedAt: '2026-05-13T03:19:00.000Z',
  },
  {
    id: 'linear',
    title: 'Linear',
    category: 'Productivity & SaaS',
    summary: 'Quiet issue-tracker system.',
    surface: 'web',
    source: 'built-in',
    status: 'published',
    isEditable: false,
  },
];

// The active scope's first row auto-selects into the detail pane, so a title can
// appear twice (row + detail). Scope row lookups to the sidebar list.
function list() {
  return within(screen.getByTestId('design-systems-list'));
}

function openOfficialPresets() {
  fireEvent.click(screen.getByRole('tab', { name: /Official presets/ }));
}

function renderScreen(props: Partial<Parameters<typeof DesignSystemsScreen>[0]> = {}) {
  return render(
    <DesignSystemsScreen
      systems={systems}
      selectedId={null}
      onSelect={vi.fn()}
      {...props}
    />,
  );
}

describe('DesignSystemsScreen', () => {
  it('paints the reference page head, handoff band and shell', () => {
    renderScreen();

    // The reference's page head is part of the screen, not the app chrome:
    // kicker, title, subtitle and a right-aligned primary action.
    expect(screen.getByText('DESIGN SYSTEMS AREA')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Design systems' })).toBeTruthy();
    expect(screen.getByTestId('design-systems-create')).toBeTruthy();
    expect(screen.getByTestId('design-systems-list')).toBeTruthy();
    expect(screen.getByTestId('design-systems-preview')).toBeTruthy();
  });

  it('renders list and preview skeletons while design systems load', () => {
    renderScreen({ systems: [], loading: true });

    expect(screen.getByTestId('design-systems-sidebar-skeleton')).toBeTruthy();
    expect(screen.getByTestId('design-systems-preview-skeleton')).toBeTruthy();
    expect(screen.getByTestId('design-systems-loading-row-0')).toBeTruthy();
    expect(screen.getByText('Loading design systems…')).toBeTruthy();
  });

  it('offers exactly the two reference scopes, each with a count', () => {
    renderScreen();

    expect(screen.getByRole('tab', { name: /Your systems/ }).textContent).toContain('1');
    expect(screen.getByRole('tab', { name: /Official presets/ }).textContent).toContain('1');
    // The Enterprise "Coming soon" placeholder is gone — it had nothing behind
    // it and the approved screen has two scopes.
    expect(screen.queryByRole('tab', { name: /Enterprise/ })).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('runs a progress bar while loading, not just a static skeleton', () => {
    // A frozen skeleton reads as "stuck". Same bar and sweep as the Projects
    // panel, so the two screens behave identically under load.
    const { container } = renderScreen({ systems: [], loading: true });
    const track = container.querySelector('[class*="progressTrack"]');
    expect(track).not.toBeNull();

    cleanup();
    const loaded = renderScreen();
    expect(loaded.container.querySelector('[class*="progressTrack"]')).toBeNull();
  });

  it('puts the style-category filter inside the list it filters, and pins it there', () => {
    renderScreen();
    // Not present on "Your systems" — user systems are not categorised.
    expect(screen.queryByTestId('design-systems-category-filter')).toBeNull();

    openOfficialPresets();

    const filter = screen.getByTestId('design-systems-category-filter');
    expect(screen.getByTestId('design-systems-list').contains(filter)).toBe(true);
    // It must not scroll away with the 151 presets underneath it.
    expect(filter.className).toMatch(/listFilter/);
  });

  it('lists user systems under Your systems and presets under Official presets', () => {
    renderScreen();

    expect(screen.getByTestId('design-system-card-user:acme')).toBeTruthy();
    expect(list().queryByText('Linear')).toBeNull();

    openOfficialPresets();

    expect(screen.getByTestId('design-system-card-linear')).toBeTruthy();
    expect(list().queryByText('Acme Design System')).toBeNull();
  });

  it('shows the row summary as the subtitle', () => {
    renderScreen();
    const row = within(screen.getByTestId('design-system-card-user:acme'));
    expect(row.getByText('Internal product system.')).toBeTruthy();
  });

  it('clears the search when the scope changes', () => {
    // Reference `:343-344` — a query scoped to one collection must not silently
    // keep filtering the next one.
    renderScreen();
    const search = screen.getByTestId('design-systems-search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'acme' } });
    expect(search.value).toBe('acme');

    openOfficialPresets();

    expect(search.value).toBe('');
  });

  it('opens the create dialog from the page head', () => {
    renderScreen();

    fireEvent.click(screen.getByTestId('design-systems-create'));

    // Creation is this page's own surface now — the button opens the reference
    // dialog rather than routing away to the create page.
    expect(screen.getByTestId('design-system-create-dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Design a system, in minutes' })).toBeTruthy();
  });

  it('gates the create dialog submit until a source is present', () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('design-systems-create'));

    const submit = screen.getByTestId('ds-create-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('ds-create-source-input'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.keyDown(screen.getByTestId('ds-create-source-input'), { key: 'Enter' });

    expect(submit.disabled).toBe(false);
    // Reference `:136-139` — the first press advances to the confirmation step
    // rather than running anything.
    fireEvent.click(submit);
    expect(screen.getByText('READY TO EXTRACT')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('offers Default for new chats on an eligible system', async () => {
    const onSelect = vi.fn();
    renderScreen({ onSelect });
    openOfficialPresets();

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Default for new chats' }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('linear'));
  });

  it('reports a failed publish toggle without changing the row', async () => {
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: /Draft/ }));

    await waitFor(() => expect(updateDesignSystemDraft).toHaveBeenCalledWith('user:acme', {
      status: 'published',
    }));
    // The mocked daemon returns null, which the screen surfaces as a failure.
    await waitFor(() => expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy());
  });

  it('downloads a user system from the overflow menu', async () => {
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Download design system (.zip + SKILLS.md)' }),
    );

    await waitFor(() => expect(exportMocks.downloadDesignSystemArchive).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy());
  });

  it('closes the overflow menu on Escape', () => {
    // Not in the reference, which only toggles — a popover that outlives its
    // trigger is a standing defect in this product.
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
  });
});

/* ── Surface + category filtering (this product's own controls) ──────────── */

function ds(overrides: Partial<DesignSystemSummary> & { id: string }): DesignSystemSummary {
  return {
    title: overrides.id,
    category: 'Uncategorized',
    summary: 'A bundled preset.',
    surface: 'web',
    source: 'built-in',
    status: 'published',
    isEditable: false,
    ...overrides,
  };
}

const librarySystems: DesignSystemSummary[] = [
  ds({ id: 'retro-web-1', title: 'Retro Web One', category: 'Retro', surface: 'web' }),
  ds({ id: 'retro-web-2', title: 'Retro Web Two', category: 'Retro', surface: 'web' }),
  ds({ id: 'retro-img-1', title: 'Retro Image One', category: 'Retro', surface: 'image' }),
  ds({ id: 'social-web-1', title: 'Social Web One', category: 'Social', surface: 'web' }),
  ds({ id: 'social-img-1', title: 'Social Image One', category: 'Social', surface: 'image' }),
];

function renderLibrary(items: DesignSystemSummary[] = librarySystems) {
  return render(<DesignSystemsScreen systems={items} selectedId={null} onSelect={vi.fn()} />);
}

/**
 * The category filter is a `CustomSelect`, not a native `<select>` — a native
 * popup is an OS widget whose scrollbar cannot be styled, and this list's slim
 * scrollbar has to hold when the menu is open. So it is driven by clicking the
 * trigger and then the option, rather than by `fireEvent.change`.
 */
function categoryTrigger(): HTMLElement {
  return screen.getByRole('combobox', { name: /Filter design systems/ });
}

function selectCategory(value: string) {
  fireEvent.click(categoryTrigger());
  fireEvent.click(screen.getByRole('option', { name: value }));
}

describe('DesignSystemsScreen category filtering', () => {
  // The surface chip row ('All 151' / 'Web 151' / ...) was removed on request:
  // every shipped preset is a 'web' surface, so the row rendered one meaningful
  // chip whose count always equalled All's. The style category is now the only
  // preset filter, and these lock what it still has to do.
  it('renders no surface chip row', () => {
    renderLibrary();
    openOfficialPresets();

    for (const value of ['all', 'web', 'image', 'video', 'audio']) {
      expect(screen.queryByTestId(`design-systems-surface-${value}`)).toBeNull();
    }
  });

  it('filters the list down to the selected style category', () => {
    renderLibrary();
    openOfficialPresets();

    expect(list().getByText('Retro Web One')).toBeTruthy();
    expect(list().getByText('Social Web One')).toBeTruthy();

    selectCategory('Retro');

    expect(list().getByText('Retro Web One')).toBeTruthy();
    expect(list().getByText('Retro Web Two')).toBeTruthy();
    expect(list().getByText('Retro Image One')).toBeTruthy();
    // A system from another category must not leak back in.
    expect(list().queryByText('Social Web One')).toBeNull();
  });

  it('keeps the selected category on the trigger and combines it with search', () => {
    renderLibrary();
    openOfficialPresets();
    selectCategory('Retro');

    expect(categoryTrigger().getAttribute('aria-label')).toContain('Retro');

    fireEvent.change(screen.getByTestId('design-systems-search'), {
      target: { value: 'Image' },
    });

    expect(list().getByText('Retro Image One')).toBeTruthy();
    expect(list().queryByText('Retro Web One')).toBeNull();
  });

  it('falls back to All when the catalogue loses the selected category', () => {
    const { rerender } = renderLibrary();
    openOfficialPresets();
    selectCategory('Retro');

    rerender(
      <DesignSystemsScreen
        systems={librarySystems.filter((s) => s.category !== 'Retro')}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(list().getByText('Social Web One')).toBeTruthy();
  });
});
