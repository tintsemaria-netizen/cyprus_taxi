'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { Logo } from '@/components/Brand';

export const dynamic = 'force-dynamic';

// Where the «IL-Y Admin» home-screen icon opens (2026-11-21): signed in → each role to its own side; else → staff sign-in.
export default function StaffHome() {
  const router = useRouter();
  useEffect(() => {
    api<{ role: string; mfa?: { setupRequired?: boolean } }>('/auth/me')
      .then((m) => {
        if (m.mfa?.setupRequired) router.replace('/staff/security');
        else if (m.role === 'DRIVER') router.replace('/driver');
        else if (m.role === 'FLEET_OWNER') router.replace('/fleet');
        else router.replace('/dispatch');
      })
      .catch(() => router.replace('/staff/login'));
  }, [router]);
  return <div className="flex min-h-[100dvh] items-center justify-center"><Logo /></div>;
}
