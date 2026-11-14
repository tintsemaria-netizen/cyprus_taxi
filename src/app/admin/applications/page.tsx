'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { statusLabel } from '@/components/staff/StatusBadge';

export const dynamic = 'force-dynamic';

interface Row { id: string; status: string; revision: number; submittedAt: string | null; applicantName: string | null; documents: number }

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <Queue />}</StaffShell>;
}

function Queue() {
  const { t, fmt } = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ pending: number; applications: Row[] }>(`/admin/applications${status ? `?status=${status}` : ''}`);
    setRows(r.applications); setPending(r.pending);
  }, [status]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('staff.apps.title')}</h1>
        <span className="chip">{t('staff.apps.pending', { n: pending })}</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-1 text-sm">
        {['', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'].map((s) => (
          <button key={s} className={`rounded-full px-3 py-1 ${status === s ? 'bg-accent text-[#10191C]' : 'bg-elevated text-muted'}`} onClick={() => setStatus(s)}>{s ? statusLabel(t, s) : t('staff.all')}</button>
        ))}
      </div>
      <div className="card divide-y divide-edge">
        {rows.length === 0 && <p className="p-4 text-sm text-muted">{t('staff.apps.empty')}</p>}
        {rows.map((a) => (
          <a key={a.id} href={`/admin/applications/${a.id}`} className="flex items-center justify-between p-3 hover:bg-elevated">
            <div>
              <div className="font-medium">{a.applicantName || t('staff.apps.unnamed')}</div>
              <div className="text-xs text-muted">{t('staff.apps.docs', { n: a.documents })} · {t('staff.rev', { n: a.revision })} · {a.submittedAt ? fmt.dateTime(a.submittedAt) : t('staff.apps.notSubmitted')}</div>
            </div>
            <span className="chip">{statusLabel(t, a.status)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
