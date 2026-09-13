import type { Metadata, Viewport } from 'next';
import './globals.css';

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
