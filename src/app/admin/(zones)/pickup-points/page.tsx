'use client';
// «Точки подачи» (2026-11-24, own block): territories (airports, ports …) with named pickup points.
import { AreaZonesPage } from '@/components/staff/AreaZones';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <AreaZonesPage kind="POINT" />;
}
