'use client';

import type { ReactNode } from 'react';
import { I18nProvider } from '../src/i18n';
import { AnalyticsProvider } from '../src/analytics/provider';

// The real provider tree. Rendered only on the client (see client-providers.tsx),
// so nothing here runs during Next's static generation.
export function ClientProvidersInner({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <AnalyticsProvider>{children}</AnalyticsProvider>
    </I18nProvider>
  );
}
