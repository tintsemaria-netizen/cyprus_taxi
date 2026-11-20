import type { Metadata } from 'next';

// Drivers install their own home-screen app ("IL-Y Driver", opens on /driver) — separate from
// the passenger app, which opens on the booking page.
export const metadata: Metadata = {
  manifest: '/manifest-driver.webmanifest',
  // 'black', not 'black-translucent' (2026-11-20): iOS 27 Home Screen apps blur the top ~100 pt of a
  // page drawn under the status bar, which smeared the logo and the avatar on an iPhone Air. With 'black'
  // the app starts below the status bar, so nothing of ours is under it.
  appleWebApp: { capable: true, title: 'IL-Y Driver', statusBarStyle: 'black' },
};

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
