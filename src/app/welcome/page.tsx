'use client';

// /welcome (2026-11-26, operator «продвигать приложение»): what IL-Y is, for passengers and drivers.
// QR flyers and links point here; «Заказать поездку» opens the booking screen. 8 languages (promo.ts).
import { PassengerTopBar } from '@/components/PassengerTopBar';
import { InstallPrompt } from '@/components/InstallPrompt';
import { LogoMark } from '@/components/Brand';
import { useT } from '@/i18n/I18nProvider';
import { LegalLinks } from '@/components/LegalShell';

const FEATURES = [
  ['✈', 'airport'],
  ['👥', 'share'],
  ['🗓', 'prebook'],
  ['€', 'price'],
  ['📍', 'track'],
  ['🌐', 'lang'],
] as const;

export default function Welcome() {
  const { t } = useT();
  return (
    <div className="min-h-[100dvh]">
      <PassengerTopBar />
      <main className="mx-auto max-w-3xl px-5 pb-16">
        <section className="pt-10 text-center" data-testid="welcome-hero">
          <LogoMark className="mx-auto h-16 w-16" />
          <h1 className="mt-5 text-3xl font-extrabold leading-tight sm:text-4xl">{t('promo.title')}</h1>
          <p className="mx-auto mt-3 max-w-xl text-base text-muted">{t('promo.lead')}</p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <a href="/" className="btn-primary w-full max-w-xs text-center text-lg" data-testid="welcome-book">{t('promo.book')}</a>
            <InstallPrompt app="passenger" className="w-full max-w-xs" />
          </div>
        </section>

        <section className="mt-12 grid gap-3 sm:grid-cols-2" data-testid="welcome-features">
          {FEATURES.map(([icon, k]) => (
            <div key={k} className="flex gap-3 rounded-[16px] border border-edge bg-elevated p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xl font-bold text-accent">{icon}</span>
              <span className="min-w-0">
                <span className="block font-semibold">{t(`promo.${k}T` as 'promo.airportT')}</span>
                <span className="mt-0.5 block text-sm text-muted" dir={k === 'lang' ? 'ltr' : undefined}>{t(`promo.${k}D` as 'promo.airportD')}</span>
              </span>
            </div>
          ))}
        </section>

        <section className="mt-12 rounded-[20px] border border-accent/40 bg-accent/10 p-6" data-testid="welcome-drivers">
          <h2 className="text-2xl font-bold">{t('promo.drvTitle')}</h2>
          <p className="mt-1 text-muted">{t('promo.drvLead')}</p>
          <ul className="mt-4 space-y-2 text-sm">
            {(['drv1', 'drv2', 'drv3'] as const).map((k) => <li key={k} className="flex gap-2"><span className="text-accent">✓</span>{t(`promo.${k}`)}</li>)}
          </ul>
          <a href="/driver/register" className="btn-primary mt-5 inline-flex" data-testid="welcome-driver">{t('promo.drvCta')}</a>
        </section>
        <LegalLinks />
      </main>
    </div>
  );
}
