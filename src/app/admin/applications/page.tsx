'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

interface Row { id: string; status: string; revision: number; submittedAt: string | null; applicantName: string | null; documents: number }

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <Queue />}</StaffShell>;
}

function Queue() {
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
        <h1 className="text-xl font-bold">Driver applications</h1>
        <span className="chip">{pending} pending</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-1 text-sm">
        {['', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'].map((s) => (
          <button key={s} className={`rounded-full px-3 py-1 ${status === s ? 'bg-accent text-[#10191C]' : 'bg-elevated text-muted'}`} onClick={() => setStatus(s)}>{s || 'All'}</button>
        ))}
      </div>
      <div className="card divide-y divide-edge">
        {rows.length === 0 && <p className="p-4 text-sm text-muted">No applications.</p>}
        {rows.map((a) => (
          <a key={a.id} href={`/admin/applications/${a.id}`} className="flex items-center justify-between p-3 hover:bg-elevated">
            <div>
              <div className="font-medium">{a.applicantName || '(unnamed)'}</div>
              <div className="text-xs text-muted">{a.documents} docs · rev {a.revision} · {a.submittedAt ? new Date(a.submittedAt).toLocaleString('en-GB') : 'not submitted'}</div>
            </div>
            <span className="chip">{a.status.replace(/_/g, ' ')}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
