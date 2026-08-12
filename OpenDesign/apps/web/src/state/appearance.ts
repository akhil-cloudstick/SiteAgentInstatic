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

export function applyAppearanceToDocument({
  theme,
  accentColor,
}: {
  theme?: AppTheme;
  accentColor?: string;
}): void {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
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
