/**
 * useStudioLayout — the approved prototype's workbench arithmetic, ported
 * verbatim from `prototype-reference/src/StudioScreen.jsx:12-281`.
 *
 * The Studio is five grid tracks: chat │ handle │ canvas │ handle │ files.
 * Only the two panels are user-sized; the canvas is whatever is left, floored
 * at 400px. When the window shrinks past what all three can hold, the files
 * panel gives ground first and the chat panel second — that ordering is the
 * reference's and it is what keeps the canvas usable on a laptop.
 *
 * Widths are published as CSS custom properties rather than a
 * `grid-template-columns` shorthand: the drag path writes them straight onto
 * the element for frame-rate reasons, and an inline shorthand can never be
 * overridden from a stylesheet afterwards.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

export const CHAT_MIN = 345;
export const CHAT_MAX = 720;
export const FILES_MIN = 220;
export const FILES_MAX = 420;
export const CANVAS_MIN = 400;
/** Width of a collapsed panel's vertical rail. */
export const PANEL_RAIL = 44;
export const HANDLE_WIDTH = 8;
/** Below this the workbench stacks and the mobile dock takes over. */
export const COMPACT_BREAKPOINT = 1100;

export type StudioPanel = 'chat' | 'files';

export interface StudioLayout {
  chatWidth: number;
  filesWidth: number;
  chatCollapsed: boolean;
  filesCollapsed: boolean;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/**
 * `StudioScreen.jsx:24-28`. Design Files ships collapsed: the canvas is the
 * reason the screen exists, and the tree is one click away on its rail.
 */
export function layoutDefaults(viewportWidth: number): StudioLayout {
  return viewportWidth > 1399
    ? { chatWidth: 460, filesWidth: 280, chatCollapsed: false, filesCollapsed: true }
    : { chatWidth: 460, filesWidth: 255, chatCollapsed: false, filesCollapsed: true };
}

function storageKeyFor(projectId: string): string {
  return `mms-design:studio-layout:v2:${projectId}`;
}

/**
 * The pre-Studio chat width was a single global number. Read it once so an
 * existing user's chosen width survives the move to per-project storage.
 */
const LEGACY_CHAT_WIDTH_KEY = 'open-design.project.chatPanelWidth';

function readLegacyChatWidth(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_CHAT_WIDTH_KEY);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clamp(parsed, CHAT_MIN, CHAT_MAX) : null;
  } catch {
    return null;
  }
}

export function readStoredLayout(projectId: string, fallback: StudioLayout): StudioLayout {
  if (typeof window === 'undefined') return fallback;
  let stored: unknown = null;
  try {
    stored = JSON.parse(window.localStorage.getItem(storageKeyFor(projectId)) ?? 'null');
  } catch {
    stored = null;
  }
  if (!stored || typeof stored !== 'object') {
    const legacy = readLegacyChatWidth();
    return legacy === null ? fallback : { ...fallback, chatWidth: legacy };
  }
  const value = stored as Partial<StudioLayout>;
  const storedChatWidth =
    typeof value.chatWidth === 'number' && Number.isFinite(value.chatWidth) && value.chatWidth >= CHAT_MIN
      ? clamp(value.chatWidth, CHAT_MIN, CHAT_MAX)
      : fallback.chatWidth;
  const storedFilesWidth =
    typeof value.filesWidth === 'number' && Number.isFinite(value.filesWidth) && value.filesWidth >= FILES_MIN
      ? clamp(value.filesWidth, FILES_MIN, FILES_MAX)
      : fallback.filesWidth;
  return {
    chatWidth: storedChatWidth,
    filesWidth: storedFilesWidth,
    chatCollapsed: Boolean(value.chatCollapsed),
    filesCollapsed: Boolean(value.filesCollapsed),
  };
}

export interface UseStudioLayoutResult {
  layout: StudioLayout;
  /** Live width updates during a drag (no persistence, no announcement). */
  setPanelWidth: (panel: StudioPanel, width: number) => void;
  togglePanel: (panel: StudioPanel) => void;
  /** True while the viewport is narrow enough that the grid stacks. */
  isCompact: boolean;
  /** Per-panel ceiling, recomputed from the live grid width. */
  chatMaximum: number;
  filesMaximum: number;
  defaults: StudioLayout;
  /** Attach to the grid element so its width can be observed. */
  gridRef: React.RefObject<HTMLDivElement>;
  gridStyle: CSSProperties;
  /** Screen-reader announcement for the last layout change. */
  layoutMessage: string;
  announcePanelWidth: (panel: StudioPanel, width: number) => void;
}

export function useStudioLayout(projectId: string): UseStudioLayoutResult {
  const gridRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1400 : window.innerWidth,
  );
  const [gridWidth, setGridWidth] = useState(0);
  const [layoutMessage, setLayoutMessage] = useState('');
  const [layout, setLayout] = useState<StudioLayout>(() => {
    const width = typeof window === 'undefined' ? 1400 : window.innerWidth;
    return readStoredLayout(projectId, layoutDefaults(width));
  });

  const isCompact = viewportWidth <= COMPACT_BREAKPOINT;
  const defaults = layoutDefaults(viewportWidth);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const node = gridRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setGridWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Switching projects loads that project's saved layout.
  useEffect(() => {
    setLayout(
      readStoredLayout(
        projectId,
        layoutDefaults(typeof window === 'undefined' ? 1400 : window.innerWidth),
      ),
    );
  }, [projectId]);

  useEffect(() => {
    if (isCompact) return;
    try {
      window.localStorage.setItem(storageKeyFor(projectId), JSON.stringify(layout));
    } catch {
      // Local storage is optional; the workbench stays fully usable without it.
    }
  }, [isCompact, layout, projectId]);

  // Shrink-to-fit: files first, then chat. `StudioScreen.jsx:216-242`.
  useEffect(() => {
    const minimumDesktopGridWidth = CHAT_MIN + CANVAS_MIN + PANEL_RAIL + HANDLE_WIDTH;
    if (isCompact || gridWidth < minimumDesktopGridWidth) return;
    setLayout((current) => {
      const chatTrack = current.chatCollapsed ? PANEL_RAIL : clamp(current.chatWidth, CHAT_MIN, CHAT_MAX);
      const filesTrack = current.filesCollapsed
        ? PANEL_RAIL
        : clamp(current.filesWidth, FILES_MIN, FILES_MAX);
      const handles =
        (current.chatCollapsed ? 0 : HANDLE_WIDTH) + (current.filesCollapsed ? 0 : HANDLE_WIDTH);
      let overflow = chatTrack + filesTrack + handles + CANVAS_MIN - gridWidth;
      if (overflow <= 0) {
        return {
          ...current,
          chatWidth: current.chatCollapsed ? current.chatWidth : chatTrack,
          filesWidth: current.filesCollapsed ? current.filesWidth : filesTrack,
        };
      }
      let nextFiles = current.filesCollapsed ? current.filesWidth : filesTrack;
      let nextChat = current.chatCollapsed ? current.chatWidth : chatTrack;
      if (!current.filesCollapsed) {
        const reduction = Math.min(overflow, Math.max(0, nextFiles - FILES_MIN));
        nextFiles -= reduction;
        overflow -= reduction;
      }
      if (!current.chatCollapsed && overflow > 0) {
        nextChat -= Math.min(overflow, Math.max(0, nextChat - CHAT_MIN));
      }
      if (nextFiles === current.filesWidth && nextChat === current.chatWidth) return current;
      return { ...current, filesWidth: nextFiles, chatWidth: nextChat };
    });
  }, [gridWidth, isCompact, layout.chatCollapsed, layout.filesCollapsed]);

  const chatMaximum = useMemo(() => {
    if (!gridWidth) return CHAT_MAX;
    const filesTrack = layout.filesCollapsed ? PANEL_RAIL : layout.filesWidth;
    const handles = HANDLE_WIDTH + (layout.filesCollapsed ? 0 : HANDLE_WIDTH);
    return clamp(gridWidth - filesTrack - handles - CANVAS_MIN, CHAT_MIN, CHAT_MAX);
  }, [gridWidth, layout.filesCollapsed, layout.filesWidth]);

  const filesMaximum = useMemo(() => {
    if (!gridWidth) return FILES_MAX;
    const chatTrack = layout.chatCollapsed ? PANEL_RAIL : layout.chatWidth;
    const handles = HANDLE_WIDTH + (layout.chatCollapsed ? 0 : HANDLE_WIDTH);
    return clamp(gridWidth - chatTrack - handles - CANVAS_MIN, FILES_MIN, FILES_MAX);
  }, [gridWidth, layout.chatCollapsed, layout.chatWidth]);

  const setPanelWidth = useCallback((panel: StudioPanel, width: number) => {
    setLayout((current) =>
      panel === 'chat' ? { ...current, chatWidth: width } : { ...current, filesWidth: width },
    );
  }, []);

  const announcePanelWidth = useCallback((panel: StudioPanel, width: number) => {
    const label = panel === 'chat' ? 'Chat' : 'Design Files';
    setLayoutMessage(`${label} width ${Math.round(width)} pixels.`);
  }, []);

  const togglePanel = useCallback((panel: StudioPanel) => {
    setLayout((current) => {
      const key = panel === 'chat' ? 'chatCollapsed' : 'filesCollapsed';
      const nextCollapsed = !current[key];
      const label = panel === 'chat' ? 'Chat' : 'Design Files';
      setLayoutMessage(`${label} ${nextCollapsed ? 'collapsed' : 'expanded'}.`);
      if (nextCollapsed) return { ...current, [key]: true };
      return panel === 'chat'
        ? { ...current, chatCollapsed: false, chatWidth: clamp(current.chatWidth, CHAT_MIN, CHAT_MAX) }
        : {
            ...current,
            filesCollapsed: false,
            filesWidth: clamp(current.filesWidth, FILES_MIN, FILES_MAX),
          };
    });
  }, []);

  const gridStyle = useMemo(
    () =>
      ({
        '--studio-chat-width': isCompact
          ? undefined
          : `${layout.chatCollapsed ? PANEL_RAIL : layout.chatWidth}px`,
        '--studio-chat-handle-width': isCompact || layout.chatCollapsed ? '0px' : `${HANDLE_WIDTH}px`,
        '--studio-files-width': isCompact
          ? undefined
          : `${layout.filesCollapsed ? PANEL_RAIL : layout.filesWidth}px`,
        '--studio-files-handle-width':
          isCompact || layout.filesCollapsed ? '0px' : `${HANDLE_WIDTH}px`,
      }) as CSSProperties,
    [isCompact, layout.chatCollapsed, layout.chatWidth, layout.filesCollapsed, layout.filesWidth],
  );

  return {
    layout,
    setPanelWidth,
    togglePanel,
    isCompact,
    chatMaximum,
    filesMaximum,
    defaults,
    gridRef,
    gridStyle,
    layoutMessage,
    announcePanelWidth,
  };
}
