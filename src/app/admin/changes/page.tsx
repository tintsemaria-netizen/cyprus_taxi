'use client';

// «Не ваши изменения» (2026-11-23, operator): every change other admins made, newest first; new ones
// are marked and the menu item is red until this page is opened. Superadmin only, no push / sound.
import { useCallback, useEffect, useState } from 'react';
import { StaffShell, CHANGES_SEEN, type Me } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { useRefreshOnReturn } from '@/components/useRefreshOnReturn';

export const dynamic = 'force-dynamic';

interface Action { id: string; at: string; actor: string; method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; area: string; path: string; seen: boolean }

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{(me) => <Changes me={me} />}</StaffShell>;
}

function Changes({ me }: { me: Me }) {
  const { t, fmt } = useT();
  const [rows, setRows] = useState<Action[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api<{ actions: Action[] }>('/admin/changes');
      setRows(r.actions);
      if (r.actions.some((a) => !a.seen)) { await api('/admin/changes', { method: 'POST' }).catch(() => null); window.dispatchEvent(new Event(CHANGES_SEEN)); }
    } catch (e) { setMsg(e instanceof ApiRequestError ? e.body.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useRefreshOnReturn(load);
  if (!me.isOwner) return <div className="p-6 text-muted">403</div>;


  return (
    <div className="mx-auto max-w-4xl p-4" data-testid="changes">
      <h1 className="text-xl font-semibold">{t('staff.changes.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('staff.changes.sub')}</p>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      <div className="mt-3 space-y-2" data-testid="changes-list">
        {rows && rows.length === 0 && <div className="text-sm text-muted">{t('staff.changes.none')}</div>}
        {rows?.map((a) => (
          <div key={a.id} className={`card flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm ${a.seen ? '' : 'border-accent/60'}`} data-testid="change-row">
            <span className="w-[140px] shrink-0 text-muted">{fmt.date(a.at)} {fmt.time(a.at)}</span>
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{a.actor}</span> {t(`staff.changes.verb.${a.method}`)} · <span className="font-medium">{t(`staff.changes.area.${a.area}` as 'staff.changes.area.misc')}</span>
              <span className="block truncate font-mono text-[11px] text-muted">{a.method} {a.path.replace('/api/v1', '')}</span>
            </span>
            {!a.seen && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-[#0b0f10]">{t('staff.changes.newMark')}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
