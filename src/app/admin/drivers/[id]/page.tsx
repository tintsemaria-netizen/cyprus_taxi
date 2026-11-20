'use client';

import { use } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { DriverReportScreen } from '@/components/reports/DriverReportScreen';

export const dynamic = 'force-dynamic';

// The admin's per-driver report (2026-11-20): the shared DriverReportScreen fed by /admin/drivers/<id>.
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <StaffShell roles={['ADMIN']}>{() => <DriverReportScreen id={id} base="/admin/drivers" backHref="/admin/drivers" />}</StaffShell>;
}
