import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Taxi Cyprus — book a ride',
  description: 'Book and track a taxi across Cyprus. Reliable rides, around the clock.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Taxi Cyprus',
  appleWebApp: { capable: true, title: 'Taxi Cyprus', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: '#111719',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full bg-page text-ink antialiased">{children}</body>
    </html>
  );
}
