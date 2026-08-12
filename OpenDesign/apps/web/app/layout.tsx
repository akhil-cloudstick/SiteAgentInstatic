import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ClientProviders } from './client-providers';
import '@excalidraw/excalidraw/index.css';
import '../src/index.css';
import '../src/styles/home/index.css';

// Next prefixes its OWN assets (`/_next/*`) and `<Link>` hrefs with basePath, but
// NOT plain-string metadata icon URLs — those ship verbatim. Behind the gateway
// that means the browser asks for `<origin>/favicon.ico`, which the gateway hands
// to the CMS catch-all instead of us, so the tab shows no icon. Prefix them here.
const BASE_PATH = (process.env.OD_WEB_BASE_PATH ?? '').replace(/\/$/, '');
const asset = (p: string) => `${BASE_PATH}${p}`;

export const metadata: Metadata = {
  title: 'MMS Design — Map My Shops',
  icons: {
    icon: [
      { url: asset('/favicon.ico') },
      { url: asset('/favicon-32x32.png'), sizes: '32x32', type: 'image/png' },
      { url: asset('/favicon-16x16.png'), sizes: '16x16', type: 'image/png' },
    ],
    apple: asset('/apple-touch-icon.png'),
  },
};

export const viewport: Viewport = {
  themeColor: '#F8F1DF',
};

/**
 * Inline script that runs before React hydrates to apply the saved theme
 * preference without a flash of unstyled content. It reads the same
 * localStorage key used by `state/config.ts` and sets `data-theme` on
 * `<html>` immediately — before any CSS or React paint.
 * Keep the accent variable mix ratios in sync with `accentVars()` in
 * `src/state/appearance.ts`; this script cannot import application modules.
 *
 * It writes the accent variables as INLINE STYLE on `<html>`, which outranks
 * every stylesheet — so it must stay silent unless the user actually chose a
 * custom accent. `--accent` now aliases the shared `--mms-action` token
 * (`@mms/shell/styles/tokens.css`), and unconditionally re-declaring it here
 * would sever that alias and leave the header green and the page green
 * disagreeing by a few hex points. `#c96442` is upstream open-design's default
 * and is treated as "no choice made".
 */
const themeInitScript = `(function(){try{var c=JSON.parse(localStorage.getItem('open-design:config')||'{}');var t=c.theme;if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);var raw=typeof c.accentColor==='string'&&/^#[0-9a-fA-F]{6}$/.test(c.accentColor.trim())?c.accentColor.trim().toLowerCase():'';var a=(raw&&raw!=='#c96442')?raw:'';if(!a)return;var s=document.documentElement.style;s.setProperty('--mms-action',a);s.setProperty('--accent',a);s.setProperty('--accent-strong','color-mix(in srgb, '+a+' 86%, var(--text-strong))');s.setProperty('--accent-soft','color-mix(in srgb, '+a+' 22%, var(--bg-panel))');s.setProperty('--accent-tint','color-mix(in srgb, '+a+' 12%, var(--bg-panel))');s.setProperty('--accent-hover','color-mix(in srgb, '+a+' 90%, var(--text-strong))');}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning>
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: intentional theme-init inline script to prevent FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
