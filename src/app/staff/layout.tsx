import type { Metadata } from 'next';

// Staff install their own home-screen app «IL-Y Admin» (2026-11-21, operator: «чтобы мог вывести на экран» —
// passenger, driver and staff each get an icon). It opens /staff, which sends each role to its own side.
export const metadata: Metadata = {
  manifest: '/manifest-staff.webmanifest',
  appleWebApp: { capable: true, title: 'IL-Y Admin', statusBarStyle: 'black' },
  icons: { icon: [{ url: '/icons/admin-192.png?v=2', sizes: '192x192', type: 'image/png' }], apple: [{ url: '/icons/admin-apple-touch-icon.png?v=2', sizes: '180x180' }] },
};

export default function StaffAppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
