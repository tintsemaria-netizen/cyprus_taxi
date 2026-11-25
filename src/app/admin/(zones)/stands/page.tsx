'use client';
// «Стоянки с очередью» (2026-11-25): airport stands whose drivers get the airport's orders in queue order.
import { AreaZonesPage } from '@/components/staff/AreaZones';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <AreaZonesPage kind="STAND" />;
}
