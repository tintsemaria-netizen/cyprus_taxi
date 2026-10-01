'use client';

import { useT } from '@/i18n/I18nProvider';

// Conspicuous banner making it unmistakable this is a test service (SPEC §15).
export function DemoBanner() {
  const { t } = useT();
  return (
    <div className="w-full bg-accent/15 border-b border-accent/30 text-center text-xs sm:text-xs text-accent py-1.5 px-3">
      {t('auth.demoBanner')}
    </div>
  );
}
