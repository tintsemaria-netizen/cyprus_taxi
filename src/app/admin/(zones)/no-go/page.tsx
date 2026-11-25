'use client';
// «Запретная зона» — red zones where taxis do not go. Editor shared with /admin/pickup-points.
import { AreaZonesPage } from '@/components/staff/AreaZones';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <AreaZonesPage kind="NOGO" />;
}
