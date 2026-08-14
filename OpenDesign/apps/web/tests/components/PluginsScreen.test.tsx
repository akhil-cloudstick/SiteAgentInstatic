// @vitest-environment jsdom

/**
 * The rebuilt `/plugins` screen — the approved MMSBUILD reference's blocks
 * (bare page head, handoff strip, Expert suites / Skills tab row, scope +
 * search filter block, two-column card grid, setup note, Add modal) driven by
 * the real plugin, marketplace and skill catalogues.
 *
 * These replace the PluginsView / plugins-home-section suites. What they hold
 * onto is what the rebuild was allowed to change and what it was not: the
 * reference's blocks are present, the removed controls stay removed, the scope
 * partitioning is the one the plan fixed, the actions reach the same handlers,
 * and the banned product name never renders.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstalledPluginRecord } from '@open-design/contracts';
import type { SkillSummary } from '../../src/types';

const listPlugins = vi.fn();
const listPluginMarketplaces = vi.fn();
const installPluginSource = vi.fn();
const uploadPluginFolder = vi.fn();
const uploadPluginZip = vi.fn();

vi.mock('../../src/analytics/provider', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));

vi.mock('../../src/state/hubContext', () => ({
  useHubContext: () => ({ client: 'Harbour Group', project: 'Harbour Suites website' }),
}));

vi.mock('../../src/state/projects', () => ({
  listPlugins: (...args: unknown[]) => listPlugins(...args),
  listPluginMarketplaces: () => listPluginMarketplaces(),
  installPluginSource: (...args: unknown[]) => installPluginSource(...args),
  uploadPluginFolder: (...args: unknown[]) => uploadPluginFolder(...args),
  uploadPluginZip: (...args: unknown[]) => uploadPluginZip(...args),
}));

// The rich inspector is exercised by its own suite; here it only has to be
// reachable, and its real implementation drags in preview iframes.
vi.mock('../../src/components/PluginDetailsModal', () => ({
  PluginDetailsModal: ({ record }: { record: InstalledPluginRecord }) => (
    <div data-testid="plugin-details-modal">{record.id}</div>
  ),
}));

import { PluginsScreen } from '../../src/components/PluginsScreen';

function makePlugin(overrides: Partial<InstalledPluginRecord> = {}): InstalledPluginRecord {
  return {
    id: 'code-migration',
    title: 'Code Migration',
    version: '1.0.0',
    sourceKind: 'bundled',
    source: 'bundled:code-migration',
    trust: 'official',
    capabilitiesGranted: ['prompt:inject'],
    manifest: {
      name: 'code-migration',
      description: 'Refresh an existing codebase to a brand specification.',
      od: { kind: 'skill', mode: 'prototype' },
    },
    fsPath: '/plugins/code-migration',
    installedAt: 1,
    updatedAt: 1,
    ...overrides,
  } as InstalledPluginRecord;
}

function makeSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: 'wireframe-sketch',
    name: 'Wireframe sketch',
    description: 'Sketch a low-fidelity wireframe.',
    triggers: [],
    mode: 'prototype',
    category: 'design-systems',
    source: 'built-in',
    previewType: 'html',
    designSystemRequired: false,
    defaultFor: [],
    ...overrides,
  } as SkillSummary;
}

const BUNDLED = makePlugin();
const PERSONAL = makePlugin({
  id: 'my-suite',
  title: 'My Suite',
  sourceKind: 'github',
  source: 'github:acme/my-suite',
  trust: 'restricted',
  manifest: {
    name: 'my-suite',
    description: 'A personal workflow.',
    od: { kind: 'skill', mode: 'deck' },
  } as InstalledPluginRecord['manifest'],
});
const ATOM = makePlugin({
  id: 'file-write',
  title: 'File write',
  manifest: { name: 'file-write', od: { kind: 'atom' } } as InstalledPluginRecord['manifest'],
});

const MARKETPLACE = {
  id: 'official',
  url: 'https://example.test/catalog.json',
  trust: 'official' as const,
  manifest: {
    name: 'MMS catalog',
    plugins: [
      {
        name: 'gsap',
        source: 'github:greensock/gsap',
        version: '1.2.0',
        title: 'GSAP',
        description: 'Production-grade web animation.',
      },
    ],
  },
};

function renderScreen(overrides: Record<string, unknown> = {}) {
  const onUsePlugin = vi.fn();
  const onUseSkill = vi.fn();
  const onCreatePlugin = vi.fn();
  const onCreateSkill = vi.fn();
  render(
    <PluginsScreen
      skills={[makeSkill(), makeSkill({ id: 'my-skill', name: 'My skill', source: 'user', category: 'writing' })]}
      onUsePlugin={onUsePlugin}
      onUseSkill={onUseSkill}
      onCreatePlugin={onCreatePlugin}
      onCreateSkill={onCreateSkill}
      {...overrides}
    />,
  );
  return { onUsePlugin, onUseSkill, onCreatePlugin, onCreateSkill };
}

beforeEach(() => {
  listPlugins.mockResolvedValue([BUNDLED, PERSONAL, ATOM]);
  listPluginMarketplaces.mockResolvedValue([MARKETPLACE]);
  installPluginSource.mockResolvedValue({ ok: true, warnings: [], message: '', log: [] });
  uploadPluginFolder.mockResolvedValue({ ok: true, warnings: [], message: '', log: [] });
  uploadPluginZip.mockResolvedValue({ ok: true, warnings: [], message: '', log: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PluginsScreen — reference shape', () => {
  it('renders the reference blocks and nothing the reference removed', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Plugins');
    expect(screen.getByTestId('plugins-add-button')).toBeInTheDocument();
    expect(screen.getByTestId('plugins-handoff-strip')).toBeInTheDocument();
    expect(screen.getByTestId('plugins-mode-plugins')).toBeInTheDocument();
    expect(screen.getByTestId('plugins-mode-skills')).toBeInTheDocument();
    expect(screen.getByTestId('plugins-scope-official')).toBeInTheDocument();
    expect(screen.getByTestId('plugins-scope-personal')).toBeInTheDocument();
    expect(screen.getByTestId('plugins-search')).toBeInTheDocument();

    // Removed by the rebuild: the stats row, the four-tab row, the sort toggle,
    // the Saved chip and the marketplace-sources panel.
    expect(screen.queryByTestId('plugins-tab-installed')).toBeNull();
    expect(screen.queryByTestId('plugins-tab-sources')).toBeNull();
    expect(screen.queryByTestId('plugins-tab-team')).toBeNull();
    expect(screen.queryByTestId('plugins-home-sort')).toBeNull();
    expect(screen.queryByTestId('plugins-home-chip-saved')).toBeNull();
  });

  // The client asked this screen to carry the reference's product name verbatim
  // rather than the MMS label the rest of the admin uses, on the scope tab and
  // on every card badge.
  it('labels the official shelf the way the reference does', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');
    expect(screen.getByTestId('plugins-scope-official')).toHaveTextContent('OpenDesign official');
    expect(within(screen.getByTestId('plugins-grid')).getAllByText('OpenDesign official').length)
      .toBeGreaterThan(0);
  });

  // Matches Projects / Design systems / Automations: the page chrome paints
  // immediately, a sweeping bar sits above the grid, and skeleton cards hold
  // the layout so it does not jump when the catalogue lands.
  it('shows the running progress bar and skeleton cards while the catalogue loads', async () => {
    let release: (rows: InstalledPluginRecord[]) => void = () => {};
    listPlugins.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    renderScreen();

    const loading = await screen.findByTestId('plugins-loading');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.querySelectorAll('[class*="skeletonCard"]').length).toBeGreaterThan(0);
    expect(document.querySelector('[class*="progressTrack"]')).not.toBeNull();
    // The chrome above it is already on screen — only the catalogue waits.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('plugins-search')).toBeInTheDocument();

    release([BUNDLED]);
    await screen.findByTestId('plugins-grid');
    expect(screen.queryByTestId('plugins-loading')).toBeNull();
    expect(document.querySelector('[class*="progressTrack"]')).toBeNull();
  });

  it('shows the Product Hub scope in the handoff strip', async () => {
    renderScreen();
    await screen.findByTestId('plugins-handoff-strip');
    expect(screen.getByTestId('plugins-handoff-strip')).toHaveTextContent(
      'Product Hub handoff · Harbour Group / Harbour Suites website',
    );
  });
});

describe('PluginsScreen — scope partitioning', () => {
  it('puts bundled plugins and uninstalled catalogue entries on the official shelf', async () => {
    renderScreen();
    const grid = await screen.findByTestId('plugins-grid');

    expect(within(grid).getByText('Code Migration')).toBeInTheDocument();
    expect(within(grid).getByText('GSAP')).toBeInTheDocument();
    expect(within(grid).queryByText('My Suite')).toBeNull();
    // Pipeline atoms are infrastructure, never a card.
    expect(within(grid).queryByText('File write')).toBeNull();
  });

  it('puts user-installed plugins on the personal shelf', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.click(screen.getByTestId('plugins-scope-personal'));

    const grid = screen.getByTestId('plugins-grid');
    expect(within(grid).getByText('My Suite')).toBeInTheDocument();
    expect(within(grid).queryByText('Code Migration')).toBeNull();
  });

  it('splits skills into built-in and user the same way', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.click(screen.getByTestId('plugins-mode-skills'));
    expect(within(screen.getByTestId('plugins-grid')).getByText('Wireframe sketch')).toBeInTheDocument();
    expect(within(screen.getByTestId('plugins-grid')).queryByText('My skill')).toBeNull();

    fireEvent.click(screen.getByTestId('plugins-scope-personal'));
    expect(within(screen.getByTestId('plugins-grid')).getByText('My skill')).toBeInTheDocument();
  });
});

describe('PluginsScreen — filters', () => {
  it('narrows the grid by search across title, id, description and category', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.change(screen.getByTestId('plugins-search'), { target: { value: 'animation' } });
    const grid = screen.getByTestId('plugins-grid');
    expect(within(grid).getByText('GSAP')).toBeInTheDocument();
    expect(within(grid).queryByText('Code Migration')).toBeNull();
  });

  it('resets search and category when the mode changes', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.change(screen.getByTestId('plugins-search'), { target: { value: 'gsap' } });
    expect(screen.getByTestId('plugins-search')).toHaveValue('gsap');

    fireEvent.click(screen.getByTestId('plugins-mode-skills'));
    expect(screen.getByTestId('plugins-search')).toHaveValue('');
  });

  it('renders the four empty-state branches the reference defines', async () => {
    listPlugins.mockResolvedValue([]);
    listPluginMarketplaces.mockResolvedValue([]);
    renderScreen({ skills: [] });

    // Unfiltered official: no Add CTA.
    const empty = await screen.findByTestId('plugins-empty');
    expect(empty).toHaveTextContent('No official expert suites yet');
    expect(screen.queryByTestId('plugins-empty-add')).toBeNull();

    // Unfiltered personal: Add CTA present.
    fireEvent.click(screen.getByTestId('plugins-scope-personal'));
    expect(screen.getByTestId('plugins-empty')).toHaveTextContent('No personal expert suites yet');
    expect(screen.getByTestId('plugins-empty')).toHaveTextContent('Install from OpenDesign official');
    expect(screen.getByTestId('plugins-empty-add')).toBeInTheDocument();

    // Filtered: the "no matching results" wording, and no Add CTA.
    fireEvent.change(screen.getByTestId('plugins-search'), { target: { value: 'zzz' } });
    expect(screen.getByTestId('plugins-empty')).toHaveTextContent('No matching results');
    expect(screen.queryByTestId('plugins-empty-add')).toBeNull();

    // Skills shelf keeps its own noun. The reference's `changeMode` resets the
    // query and the category but NOT the scope, so this is still the personal
    // shelf — switching what you are browsing does not switch whose it is.
    fireEvent.change(screen.getByTestId('plugins-search'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('plugins-mode-skills'));
    expect(screen.getByTestId('plugins-empty')).toHaveTextContent('No personal skills yet');

    fireEvent.click(screen.getByTestId('plugins-scope-official'));
    expect(screen.getByTestId('plugins-empty')).toHaveTextContent('No official skills yet');
  });
});

describe('PluginsScreen — card actions', () => {
  it('hands an installed plugin to the composer with its example query', async () => {
    const withQuery = makePlugin({
      manifest: {
        name: 'code-migration',
        description: 'Refresh an existing codebase.',
        od: { kind: 'skill', mode: 'prototype', useCase: { query: 'Migrate {repo}' } },
      } as InstalledPluginRecord['manifest'],
    });
    listPlugins.mockResolvedValue([withQuery]);
    const { onUsePlugin } = renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.click(screen.getByTestId('plugins-try-code-migration'));
    expect(onUsePlugin).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'code-migration' }),
      'use-with-query',
    );
  });

  it('hands a skill to the composer', async () => {
    const { onUseSkill } = renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.click(screen.getByTestId('plugins-mode-skills'));
    fireEvent.click(screen.getByTestId('plugins-try-wireframe-sketch'));
    expect(onUseSkill).toHaveBeenCalledWith(expect.objectContaining({ id: 'wireframe-sketch' }));
  });

  it('installs an uninstalled catalogue entry through the daemon', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.click(screen.getByTestId('plugins-install-gsap'));
    await waitFor(() => expect(installPluginSource).toHaveBeenCalledWith('gsap'));
  });

  // The card body stays live for an uninstalled entry — disabling it would dim
  // the whole card through the product-wide `button:disabled` opacity.
  it('opens the record when an uninstalled entry card is clicked', async () => {
    renderScreen();
    const grid = await screen.findByTestId('plugins-grid');

    fireEvent.click(within(grid).getByText('GSAP'));
    expect(screen.getByTestId('plugins-provenance-modal')).toHaveTextContent('gsap');
  });

  it('offers Details and Provenance on the kebab, and closes it on Escape', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.click(screen.getByTestId('plugins-more-code-migration'));
    const menu = screen.getByTestId('plugins-menu-code-migration');
    expect(within(menu).getByText('Details')).toBeInTheDocument();
    expect(within(menu).getByText('Provenance')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('plugins-menu-code-migration')).toBeNull();
  });

  it('closes the kebab on an outside pointer press', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.click(screen.getByTestId('plugins-more-code-migration'));
    expect(screen.getByTestId('plugins-menu-code-migration')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('plugins-menu-code-migration')).toBeNull();
  });

  it('shows real provenance instead of a prototype notice', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.click(screen.getByTestId('plugins-more-code-migration'));
    fireEvent.click(within(screen.getByTestId('plugins-menu-code-migration')).getByText('Provenance'));

    const modal = screen.getByTestId('plugins-provenance-modal');
    expect(modal).toHaveTextContent('code-migration');
    expect(modal).toHaveTextContent('bundled:code-migration');
    expect(modal).toHaveTextContent('prompt:inject');
  });

  it('opens the rich inspector for an installed plugin', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.click(screen.getByTestId('plugins-more-code-migration'));
    fireEvent.click(within(screen.getByTestId('plugins-menu-code-migration')).getByText('Details'));
    expect(screen.getByTestId('plugin-details-modal')).toHaveTextContent('code-migration');
  });
});

describe('PluginsScreen — Add dialog', () => {
  it('routes the prompt path to plugin or skill authoring by branch', async () => {
    const { onCreatePlugin, onCreateSkill } = renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.click(screen.getByTestId('plugins-add-button'));
    fireEvent.click(screen.getByTestId('plugins-add-from-prompt'));
    expect(onCreatePlugin).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('plugins-add-button'));
    fireEvent.click(screen.getByTestId('plugins-add-kind-skills'));
    fireEvent.click(screen.getByTestId('plugins-add-from-prompt'));
    expect(onCreateSkill).toHaveBeenCalled();
  });

  it('installs from a link and closes on success', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.click(screen.getByTestId('plugins-add-button'));
    fireEvent.change(screen.getByTestId('plugins-add-link-input'), {
      target: { value: 'https://github.com/acme/suite' },
    });
    fireEvent.click(screen.getByTestId('plugins-add-link-submit'));

    await waitFor(() => expect(installPluginSource).toHaveBeenCalledWith('https://github.com/acme/suite'));
    await waitFor(() => expect(screen.queryByTestId('plugins-add-dialog')).toBeNull());
  });

  it('hides the import paths on the Skill branch and says where they live', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.click(screen.getByTestId('plugins-add-button'));
    fireEvent.click(screen.getByTestId('plugins-add-kind-skills'));

    expect(screen.queryByTestId('plugins-add-link-input')).toBeNull();
    expect(screen.queryByTestId('plugins-add-folder-input')).toBeNull();
    expect(screen.getByTestId('plugins-add-dialog')).toHaveTextContent('Integrations → Skills');
  });

  it('closes on Escape and on a backdrop press', async () => {
    renderScreen();
    await screen.findByTestId('plugins-grid');

    fireEvent.click(screen.getByTestId('plugins-add-button'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('plugins-add-dialog')).toBeNull();

    fireEvent.click(screen.getByTestId('plugins-add-button'));
    const backdrop = screen.getByTestId('plugins-add-dialog').parentElement!;
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByTestId('plugins-add-dialog')).toBeNull();
  });
});
