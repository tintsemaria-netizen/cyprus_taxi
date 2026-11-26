'use client';

// /welcome (2026-11-26, operator «продвигать приложение»): what IL-Y is, for passengers and drivers.
// QR flyers and links point here; «Заказать поездку» opens the booking screen. 8 languages (promo.ts).
import { PassengerTopBar } from '@/components/PassengerTopBar';
import { InstallPrompt } from '@/components/InstallPrompt';
import { WelcomeAnimation } from '@/components/WelcomeAnimation';
import { useT } from '@/i18n/I18nProvider';
import { LegalLinks } from '@/components/LegalShell';

const FEATURES = [
  ['✈', 'airport'],
  ['👥', 'share'],
  ['🗓', 'prebook'],
  ['📍', 'track'],
] as const;

export default function Welcome() {
  const { t } = useT();
  return (
    <div className="min-h-[100dvh]">
      {/* The first page: no back arrow, no «Войти» (2026-11-26, operator). */}
      <PassengerTopBar back={false} account={false} />
      <main className="mx-auto max-w-3xl px-5 pb-16">
        <section className="pt-10 text-center" data-testid="welcome-hero">
          {/* Animation instead of the still logo (2026-11-26, operator). */}
          <WelcomeAnimation />
          <h1 className="ily-in mt-4 grid text-3xl font-extrabold leading-tight sm:text-4xl">
            {/* When the car arrives the title gives way to the slogan, then comes back (2026-11-26, operator). */}
            <span className="ily-t1 [grid-area:1/1]">{t('promo.title')}</span>
            <span className="ily-t2 [grid-area:1/1]" aria-hidden>{t('promo.slogan')}</span>
          </h1>
          <p className="ily-in mx-auto mt-3 max-w-xl text-base text-muted" style={{ animationDelay: '.15s' }}>{t('promo.lead')}</p>
        </section>

        <section className="mt-10 grid gap-3 sm:grid-cols-2" data-testid="welcome-features">
          {FEATURES.map(([icon, k], i) => (
            <div key={k} className="ily-in flex gap-3 rounded-[16px] border border-edge bg-elevated p-4" style={{ animationDelay: `${0.3 + i * 0.12}s` }}>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xl font-bold text-accent">{icon}</span>
              <span className="min-w-0">
                <span className="block font-semibold">{t(`promo.${k}T` as 'promo.airportT')}</span>
                <span className="mt-0.5 block text-sm text-muted">{t(`promo.${k}D` as 'promo.airportD')}</span>
              </span>
            </div>
          ))}
        </section>

        {/* «Заказать поездку» after the four cards (2026-11-26, operator). */}
        <div className="ily-in mt-6 flex flex-col items-center gap-3" style={{ animationDelay: '.8s' }}>
          <a href="/" className="btn-primary w-full max-w-xs text-center text-lg" data-testid="welcome-book">{t('promo.book')}</a>
          <InstallPrompt app="passenger" className="w-full max-w-xs" />
        </div>

        <section className="mt-12 rounded-[20px] border border-accent/40 bg-accent/10 p-6" data-testid="welcome-drivers">
          <h2 className="text-2xl font-bold">{t('promo.drvTitle')}</h2>
          <p className="mt-1 text-muted">{t('promo.drvLead')}</p>
          <a href="/driver/register" className="btn-primary mt-5 inline-flex" data-testid="welcome-driver">{t('promo.drvCta')}</a>
        </section>
        <LegalLinks />
      </main>
    </div>
  );
}
