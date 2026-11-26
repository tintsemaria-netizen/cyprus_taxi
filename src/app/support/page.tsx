'use client';

// «Поддержка» (2026-11-26): who runs IL-Y and how to reach them (EU trader information, app-store support link),
// how to delete an account, links to the privacy policy and terms. Details come from admin «Настройки».
import { PassengerTopBar } from '@/components/PassengerTopBar';
import { LegalLinks, useOperator } from '@/components/LegalShell';
import { useT } from '@/i18n/I18nProvider';

export default function Support() {
  const { t } = useT();
  const o = useOperator();
  const any = !!(o && (o.operatorName || o.operatorAddress || o.supportEmail || o.supportPhone));
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3 border-b border-edge py-3 last:border-0"><span className="w-28 shrink-0 text-muted">{label}</span><span className="min-w-0 break-words">{value}</span></div>
  );
  return (
    <div className="min-h-[100dvh]">
      <PassengerTopBar />
      <main className="mx-auto max-w-2xl px-5 py-8" data-testid="support-page">
        <h1 className="text-2xl font-bold">{t('promo.supportTitle')}</h1>
        <p className="mt-2 text-muted">{t('promo.supportLead')}</p>
        <div className="card mt-6 px-4 text-sm">
          {!o ? <p className="py-3 text-muted">…</p> : !any ? <p className="py-3 text-muted">{t('promo.notSet')}</p> : (
            <>
              {o.operatorName && row(t('promo.operator'), o.operatorName)}
              {o.operatorAddress && row(t('promo.address'), o.operatorAddress)}
              {o.supportPhone && row(t('promo.phoneL'), <a href={`tel:${o.supportPhone}`} className="text-accent">{o.supportPhone}</a>)}
              {o.supportEmail && row(t('promo.emailL'), <a href={`mailto:${o.supportEmail}`} className="text-accent">{o.supportEmail}</a>)}
            </>
          )}
        </div>
        <p className="mt-6 text-sm text-muted">{t('promo.deleteHint')}</p>
        <LegalLinks />
      </main>
    </div>
  );
}
