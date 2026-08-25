import type { AppTheme } from '../types';

const ACCENT_VARS = [
  '--accent',
  '--accent-strong',
  '--accent-soft',
  '--accent-tint',
  '--accent-hover',
] as const;

export const DEFAULT_ACCENT_COLOR = '#1ba957';
/** The pre-MMS-rebrand default accent. Any browser that persisted this value
 *  should migrate to the new MMS green, not keep showing the old terracotta. */
const LEGACY_DEFAULT_ACCENT = '#c96442';
export const ACCENT_SWATCHES = [
  DEFAULT_ACCENT_COLOR, // MMS Approval Green
  '#ff6b1a', // Action Orange
  '#ffc928', // Power Yellow
  '#e94b32', // Cape Red
  '#082a38', // MMS Navy
  '#1b5f77', // Navy-teal
] as const;

export function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function resolveAccentColor(value: unknown): string {
  const normalized = normalizeAccentColor(value);
  if (!normalized || normalized === LEGACY_DEFAULT_ACCENT) return DEFAULT_ACCENT_COLOR;
  return normalized;
}

function accentVars(accentColor: string): Record<(typeof ACCENT_VARS)[number], string> {
  return {
    '--accent': accentColor,
    // Keep these mix ratios in sync with the pre-hydration script in app/layout.tsx.
    '--accent-strong': `color-mix(in srgb, ${accentColor} 86%, var(--text-strong))`,
    '--accent-soft': `color-mix(in srgb, ${accentColor} 22%, var(--bg-panel))`,
    '--accent-tint': `color-mix(in srgb, ${accentColor} 12%, var(--bg-panel))`,
    '--accent-hover': `color-mix(in srgb, ${accentColor} 90%, var(--text-strong))`,
  };
}

/**
 * Mark the document as mid-theme-swap so `base.css` can kill every transition,
 * then clear the mark once the new colours have painted. The forced reflow is
 * the point: it commits the "transitions off" state before the attribute that
 * changes the colours, so nothing has a chance to start animating.
 */
let themeSwapTimer: number | undefined;
function suppressThemeTransitions(root: HTMLElement): void {
  root.setAttribute('data-theme-swapping', '');
  // Read a layout property to flush the style change synchronously.
  void root.offsetHeight;
  if (themeSwapTimer !== undefined) window.clearTimeout(themeSwapTimer);
  const clear = () => {
    root.removeAttribute('data-theme-swapping');
    themeSwapTimer = undefined;
  };
  // Two frames: one for the attribute swap to paint, one before transitions are
  // allowed back, so a slow frame cannot re-introduce the crossfade.
  window.requestAnimationFrame(() => window.requestAnimationFrame(clear));
  // Belt and braces for a backgrounded tab, where rAF does not fire.
  themeSwapTimer = window.setTimeout(clear, 250);
}

/**
 * MMS default theme. Upstream 0.20.0 exports `FORCED_APP_THEME` and coerces
 * every persisted value to it, because upstream ships light-only. The MMS
 * re-skin ships both themes, so this is a DEFAULT, not a forcing value.
 */
export const DEFAULT_APP_THEME = 'light' as const;

/**
 * Validate a persisted theme. Unlike upstream's version this PRESERVES a
 * stored 'dark' / 'system' choice — those are live settings here, not dead data.
 */
export function resolveAppTheme(persisted?: AppTheme | null): AppTheme {
  return persisted === 'light' || persisted === 'dark' || persisted === 'system'
    ? persisted
    : DEFAULT_APP_THEME;
}
export function applyAppearanceToDocument({
  theme,
  accentColor,
}: {
  theme?: AppTheme;
  accentColor?: string;
}): void {
  const root = document.documentElement;
  const nextTheme = theme === 'light' || theme === 'dark' ? theme : null;
  const themeChanged = (root.getAttribute('data-theme') ?? null) !== nextTheme;

  // Flipping the theme repaints every surface at once, but each surface
  // animates on its OWN `transition` — different durations and easings — so the
  // page crossfades block by block and spends a moment half-light, half-dark.
  // Suppressing transitions for the duration of the swap makes it a single
  // instantaneous change everywhere, which is what "the theme switched" should
  // look like. `base.css` owns the suppression rule.
  if (themeChanged) suppressThemeTransitions(root);

  if (nextTheme) {
    root.setAttribute('data-theme', nextTheme);
  } else {
    root.removeAttribute('data-theme');
  }

  // Inline style on <html> outranks every stylesheet, so writing the accent
  // unconditionally would sever `--accent`'s alias to the shared `--mms-action`
  // token and leave the shared header's green a few hex points off the page's.
  // Only a genuine user choice may override the design system; otherwise clear
  // any previously-written override and let the token layer decide.
  const chosen = normalizeAccentColor(accentColor);
  if (!chosen || chosen === LEGACY_DEFAULT_ACCENT) {
    for (const name of ACCENT_VARS) root.style.removeProperty(name);
    root.style.removeProperty('--mms-action');
    return;
  }

  const vars = accentVars(chosen);
  for (const name of ACCENT_VARS) {
    root.style.setProperty(name, vars[name]);
  }
  // Keep the shared token in step so shell chrome follows a custom accent too.
  root.style.setProperty('--mms-action', chosen);
}
