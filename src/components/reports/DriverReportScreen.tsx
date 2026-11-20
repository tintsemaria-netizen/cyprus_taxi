'use client';

import { useEffect, useState } from 'react';
import { BackArrow } from '@/components/BackArrow';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { EarningsReport } from './EarningsReport';

// One driver's full report screen (2026-11-20) for the admin and the fleet owner: header with back «‹»,
// then the driver's own earnings / done & not done / hours & km screens. `base` = '/admin/drivers' or '/fleet/drivers'.
interface Head { publicName: string; login: string; phone: string; onDuty: boolean; vehicle: { plate: string; label: string } | null }

export function DriverReportScreen({ id, base, backHref }: { id: string; base: string; backHref: string }) {
  const { t } = useT();
  const [d, setD] = useState<Head | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { api<{ driver: Head }>(`${base}/${id}`).then((r) => setD(r.driver)).catch(() => setMissing(true)); }, [id, base]);
  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6" data-testid="driver-report-screen">
      <div className="flex items-center gap-1">
        <BackArrow fallback={backHref} className="-ms-2" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{d ? d.publicName : missing ? t('staff.drivers.notFound') : '…'}</h1>
          {d && <div className="truncate text-xs text-muted">@{d.login} · {d.phone} · {d.onDuty ? t('staff.drivers.onDuty') : t('staff.drivers.off')} · {d.vehicle ? `${d.vehicle.label} (${d.vehicle.plate})` : t('staff.drivers.noVehicle')}</div>}
        </div>
      </div>
      {!missing && <div className="mt-4"><EarningsReport apiBase={`${base}/${id}/report`} initialRange="today" /></div>}
    </div>
  );
}
