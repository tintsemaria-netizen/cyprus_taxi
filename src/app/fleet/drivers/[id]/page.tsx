'use client';

import { use } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { DriverReportScreen } from '@/components/reports/DriverReportScreen';

export const dynamic = 'force-dynamic';

// The fleet owner's per-driver report (2026-11-20): the same screen as the admin's, only his drivers.
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <StaffShell roles={['FLEET_OWNER', 'DRIVER']}>{() => <DriverReportScreen id={id} base="/fleet/drivers" backHref="/fleet" />}</StaffShell>;
}
