'use client';

import { useEffect, useState } from 'react';
import { BackArrow } from '@/components/BackArrow';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { EarningsReport } from './EarningsReport';
import { useSlotName } from '@/components/driver/DriverDocs';

// One driver's full report screen (2026-11-20) for the admin and the fleet owner: header with back «‹»,
// then the driver's own earnings / done & not done / hours & km screens. `base` = '/admin/drivers' or '/fleet/drivers'.
interface Head { publicName: string; login: string; phone: string; onDuty: boolean; vehicle: { plate: string; label: string } | null; documents: ReportDoc[] | null }
interface ReportDoc { slot: string; status: string; expiresAt: string | null; renewal: { status: string; uploadedAt: string } | null }

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
      {d?.documents && d.documents.length > 0 && <ReportDocs docs={d.documents} />}
      {!missing && <div className="mt-4"><EarningsReport apiBase={`${base}/${id}/report`} initialRange="today" /></div>}
    </div>
  );
}

/** His documents and their dates (2026-11-24) — the admin and the fleet owner see the same block. */
function ReportDocs({ docs }: { docs: ReportDoc[] }) {
  const { t, fmt } = useT();
  const name = useSlotName();
  const order = (x: ReportDoc) => (x.status === 'EXPIRED' ? 0 : x.status === 'EXPIRING' ? 1 : x.renewal ? 2 : x.expiresAt ? 3 : 4);
  const list = [...docs].sort((a, b) => order(a) - order(b) || (a.expiresAt ?? '9').localeCompare(b.expiresAt ?? '9'));
  return (
    <div className="card mt-4 p-4" data-testid="report-docs">
      <div className="mb-1 font-medium">{t('staff.docs.title')}</div>
      <ul className="divide-y divide-edge text-sm">
        {list.map((x) => {
          const bad = (x.status === 'EXPIRED' || x.status === 'EXPIRING') && x.renewal?.status !== 'UNDER_REVIEW';
          return (
            <li key={x.slot} className="py-2">
              <div className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-1.5">{bad && <span className="h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />}{name(x.slot)}</span>
                <span className={`text-end ${x.status === 'EXPIRED' ? 'text-danger' : x.status === 'EXPIRING' ? 'text-warn' : 'text-muted'}`}>
                  {x.expiresAt ? (x.status === 'EXPIRED' ? t('staff.docs.expiredShort', { date: fmt.date(x.expiresAt) }) : t('staff.docs.untilShort', { date: fmt.date(x.expiresAt) })) : t('staff.docs.noDate')}
                </span>
              </div>
              {x.renewal && <div className="mt-0.5 text-xs text-accent">{x.renewal.status === 'UNDER_REVIEW' ? t('staff.docs.renewalWaiting', { date: fmt.date(x.renewal.uploadedAt) }) : t('staff.docs.renewalReturned')}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
