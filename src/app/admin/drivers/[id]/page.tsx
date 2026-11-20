'use client';

import { use, useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { BackArrow } from '@/components/BackArrow';
import { EarningsReport } from '@/components/reports/EarningsReport';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

export const dynamic = 'force-dynamic';

// The admin's per-driver report (2026-11-20, operator): the very same earnings / done & not done /
// hours & km screens the driver sees on his phone, built once (components/reports) and fed by
// /admin/drivers/<id>/report/*. A fleet owner will get the same screen for his own drivers.
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <StaffShell roles={['ADMIN']}>{() => <DriverReport id={id} />}</StaffShell>;
}

interface Head { publicName: string; login: string; phone: string; onDuty: boolean; vehicle: { plate: string; label: string } | null }

function DriverReport({ id }: { id: string }) {
  const { t } = useT();
  const [d, setD] = useState<Head | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { api<{ driver: Head }>(`/admin/drivers/${id}`).then((r) => setD(r.driver)).catch(() => setMissing(true)); }, [id]);
  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6" data-testid="admin-driver-report">
      <div className="flex items-center gap-1">
        <BackArrow fallback="/admin/drivers" className="-ms-2" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{d ? d.publicName : missing ? t('staff.drivers.notFound') : '…'}</h1>
          {d && <div className="truncate text-xs text-muted">@{d.login} · {d.phone} · {d.onDuty ? t('staff.drivers.onDuty') : t('staff.drivers.off')} · {d.vehicle ? `${d.vehicle.label} (${d.vehicle.plate})` : t('staff.drivers.noVehicle')}</div>}
        </div>
      </div>
      {!missing && <div className="mt-4"><EarningsReport apiBase={`/admin/drivers/${id}/report`} initialRange="today" /></div>}
    </div>
  );
}
