import type { Metadata } from 'next';

// Drivers install their own home-screen app ("IL-Y Driver", opens on /driver) — separate from
// the passenger app, which opens on the booking page.
export const metadata: Metadata = {
  manifest: '/manifest-driver.webmanifest',
  appleWebApp: { capable: true, title: 'IL-Y Driver', statusBarStyle: 'black-translucent' },
};

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
