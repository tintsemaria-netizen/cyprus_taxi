import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/i18n/I18nProvider';
import { getRequestLocale } from '@/i18n/server';
import { RTL_LOCALES } from '@/i18n/config';
import { PortraitLock } from '@/components/PortraitLock';
import { IosViewportFix } from '@/components/IosViewportFix';
import { SamsungDarkHint } from '@/components/SamsungDarkHint';
import { ErrorFocus } from '@/components/ErrorFocus';

export const metadata: Metadata = {
  title: 'IL-Y — book a ride',
  description: 'Book and track a ride across Cyprus with IL-Y.',
  applicationName: 'IL-Y',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'IL-Y', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/icons/favicon.ico', sizes: 'any' },
      { url: '/icons/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    title: 'IL-Y — book a ride',
    description: 'Book and track a ride across Cyprus with IL-Y.',
    siteName: 'IL-Y',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#10191C',
  // The app is dark by design (2026-11-18): tell browsers so Samsung Internet's forced dark mode
  // does not recolor it (it turned the orange «Уйти с линии» red with white text on a Z Fold 7).
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} dir={RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr'}>
      <body className="min-h-full bg-page text-ink antialiased">
        <I18nProvider locale={locale}>{children}<PortraitLock /><IosViewportFix /><SamsungDarkHint />
        <ErrorFocus /></I18nProvider>
      </body>
    </html>
  );
}
