'use client';

// Legal pages and «Поддержка» (2026-11-26): the operator's details from admin «Настройки», links between the three.
import { useEffect, useState } from 'react';
import { PassengerTopBar } from '@/components/PassengerTopBar';
import { BackArrow } from '@/components/BackArrow';
import { useT, useLocale } from '@/i18n/I18nProvider';
import { api } from '@/lib/api-client';
import { legalDoc, LEGAL_UPDATED } from '@/content/legal';

export interface OperatorInfo { operatorName: string | null; operatorAddress: string | null; supportEmail: string | null; supportPhone: string | null }

export function useOperator(): OperatorInfo | null {
  const [o, setO] = useState<OperatorInfo | null>(null);
  useEffect(() => { api<OperatorInfo>('/public/config', { timeoutMs: 8000 }).then(setO).catch(() => setO({ operatorName: null, operatorAddress: null, supportEmail: null, supportPhone: null })); }, []);
  return o;
}

export function LegalLinks() {
  const { t } = useT();
  return (
    <nav className="mt-10 flex flex-wrap gap-x-4 gap-y-1 border-t border-edge pt-4 text-sm text-muted">
      <a href="/privacy" className="hover:text-ink">{t('promo.privacy')}</a>
      <a href="/terms" className="hover:text-ink">{t('promo.terms')}</a>
      <a href="/support" className="hover:text-ink">{t('promo.support')}</a>
    </nav>
  );
}

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const { t, fmt } = useT();
  const locale = useLocale();
  const o = useOperator();
  const v = { op: o?.operatorName || 'IL-Y', addr: o?.operatorAddress || 'Cyprus', email: o?.supportEmail || '—', phone: o?.supportPhone || '—' };
  const { doc, lang } = legalDoc(kind, locale, v);
  return (
    <div className="min-h-[100dvh]">
      <PassengerTopBar back={false} />
      <main className="mx-auto max-w-2xl px-5 py-8" lang={lang} dir="ltr" data-testid={`legal-${kind}`}>
        {lang !== locale && <p className="mb-4 rounded-[12px] border border-edge px-3 py-2 text-xs text-muted" dir="auto">{t('promo.englishOnly')}</p>}
        <div className="flex items-center gap-1"><BackArrow className="-ms-2" /><h1 className="text-2xl font-bold">{doc.title}</h1></div>
        <p className="mt-1 text-xs text-muted">{doc.updated}: {fmt.date(LEGAL_UPDATED)}</p>
        <div className="mt-6 space-y-6 text-sm leading-relaxed">
          {doc.sections.map((s) => (
            <section key={s.h}>
              <h2 className="mb-2 text-base font-semibold">{s.h}</h2>
              <div className="space-y-2 text-muted">{s.p.map((x, i) => <p key={i}>{x}</p>)}</div>
            </section>
          ))}
        </div>
        <LegalLinks />
      </main>
    </div>
  );
}
