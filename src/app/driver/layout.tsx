import type { Metadata } from 'next';

// Drivers install their own home-screen app ("IL-Y Driver", opens on /driver) — separate from
// the passenger app, which opens on the booking page.
export const metadata: Metadata = {
  manifest: '/manifest-driver.webmanifest',
  // 'black', not 'black-translucent' (2026-11-20): iOS 27 Home Screen apps blur the top ~100 pt of a
  // page drawn under the status bar, which smeared the logo and the avatar on an iPhone Air. With 'black'
  // the app starts below the status bar, so nothing of ours is under it.
  appleWebApp: { capable: true, title: 'IL-Y Driver', statusBarStyle: 'black' },
  // Own icon with a «DRIVER» band (2026-11-21), so it is told apart from the passenger «IL-Y» on the home screen.
  icons: { icon: [{ url: '/icons/driver-192.png', sizes: '192x192', type: 'image/png' }], apple: [{ url: '/icons/driver-apple-touch-icon.png', sizes: '180x180' }] },
};

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
