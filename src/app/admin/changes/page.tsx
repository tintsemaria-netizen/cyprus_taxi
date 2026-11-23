'use client';

// «Не ваши изменения» (2026-11-23, operator): every change other admins made, newest first; new ones
// stay red until he checks each one («Проверено») or «Отметить всё проверенным». Superadmin only, no sound.
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
    } catch (e) { setMsg(e instanceof ApiRequestError ? e.body.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useRefreshOnReturn(load);
  async function check(id?: string) {
    try {
      const r = await api<{ unread: number }>('/admin/changes', { method: 'POST', body: id ? { id } : { all: true } });
      setRows((rs) => rs?.map((a) => (!id || a.id === id ? { ...a, seen: true } : a)) ?? rs);
      window.dispatchEvent(new CustomEvent(CHANGES_SEEN, { detail: r.unread }));
    } catch (e) { setMsg(e instanceof ApiRequestError ? e.body.message : String(e)); }
  }
  const unseen = rows?.filter((a) => !a.seen).length ?? 0;
  if (!me.isOwner) return <div className="p-6 text-muted">403</div>;


  return (
    <div className="mx-auto max-w-4xl p-4" data-testid="changes">
      <h1 className="text-xl font-semibold">{t('staff.changes.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('staff.changes.sub')}</p>
      {unseen > 0 && <button type="button" className="btn-primary mt-3 !min-h-[40px] !py-2 text-sm" onClick={() => void check()} data-testid="changes-check-all">{t('staff.changes.checkAll', { n: unseen })}</button>}
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      <div className="mt-3 space-y-2" data-testid="changes-list">
        {rows && rows.length === 0 && <div className="text-sm text-muted">{t('staff.changes.none')}</div>}
        {rows?.map((a) => (
          <div key={a.id} className={`card flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm ${a.seen ? 'opacity-70' : 'border-danger'}`} data-testid="change-row">
            <span className="w-[140px] shrink-0 text-muted">{fmt.date(a.at)} {fmt.time(a.at)}</span>
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{a.actor}</span> {t(`staff.changes.verb.${a.method}`)} · <span className="font-medium">{t(`staff.changes.area.${a.area}` as 'staff.changes.area.misc')}</span>
              <span className="block truncate font-mono text-[11px] text-muted">{a.method} {a.path.replace('/api/v1', '')}</span>
            </span>
            {a.seen
              ? <span className="text-[11px] text-muted">✓ {t('staff.changes.checked')}</span>
              : <button type="button" className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-[#0b0f10]" onClick={() => void check(a.id)} data-testid="change-check">{t('staff.changes.check')}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
