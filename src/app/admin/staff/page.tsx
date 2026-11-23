'use client';

// «Сотрудники» (2026-11-23): the superadmin creates admins / dispatchers, switches them off or on,
// gives a new temporary password, resets two-factor. Superadmin only.
import { useCallback, useEffect, useState } from 'react';
import { StaffShell, type Me } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

export const dynamic = 'force-dynamic';

interface Person { id: string; login: string; displayName: string; role: 'ADMIN' | 'DISPATCHER'; isOwner: boolean; active: boolean; mfa: boolean; lastSignIn: string | null }

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{(me) => <Team me={me} />}</StaffShell>;
}

function Team({ me }: { me: Me }) {
  const { t, fmt } = useT();
  const [rows, setRows] = useState<Person[] | null>(null);
  const [form, setForm] = useState<{ login: string; displayName: string; role: 'ADMIN' | 'DISPATCHER' } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const load = useCallback(async () => { setRows((await api<{ staff: Person[] }>('/admin/staff')).staff); }, []);
  useEffect(() => { void load().catch((e) => setMsg(e instanceof ApiRequestError ? e.body.message : String(e))); }, [load]);
  if (!me.isOwner) return <div className="p-6 text-muted">403</div>;

  async function create() {
    if (!form) return;
    setMsg(null);
    try {
      const r = await api<{ login: string; temporaryPassword: string }>('/admin/staff', { method: 'POST', body: form });
      setSecret(t('staff.team.tempPassword', { login: r.login, password: r.temporaryPassword }));
      setForm(null);
      await load();
    } catch (e) { setMsg(e instanceof ApiRequestError ? e.body.message : String(e)); }
  }
  async function act(p: Person, action: 'disable' | 'enable' | 'resetPassword' | 'resetMfa') {
    const ask = action === 'disable' ? t('staff.team.confirmDisable', { login: p.login }) : action === 'resetPassword' ? t('staff.team.confirmReset', { login: p.login }) : action === 'resetMfa' ? t('staff.team.confirmMfa', { login: p.login }) : null;
    if (ask && !window.confirm(ask)) return;
    setMsg(null);
    try {
      const r = await api<{ temporaryPassword?: string }>(`/admin/staff/${p.id}`, { method: 'PATCH', body: { action } });
      if (r.temporaryPassword) setSecret(t('staff.team.tempPassword', { login: p.login, password: r.temporaryPassword }));
      await load();
    } catch (e) { setMsg(e instanceof ApiRequestError ? e.body.message : String(e)); }
  }

  return (
    <div className="mx-auto max-w-4xl p-4" data-testid="team">
      <h1 className="text-xl font-semibold">{t('staff.team.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('staff.team.sub')}</p>
      {secret && <div className="mt-3 rounded-[12px] border border-accent/50 bg-accent/10 p-3 font-mono text-sm" data-testid="team-secret">{secret}</div>}
      {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}
      <div className="mt-4 flex"><button type="button" className="btn-primary ms-auto !min-h-[40px] !py-2 text-sm" onClick={() => { setSecret(null); setForm({ login: '', displayName: '', role: 'ADMIN' }); }} data-testid="team-add">{t('staff.team.add')}</button></div>
      {form && (
        <div className="card mt-3 space-y-3 p-4" data-testid="team-form">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block text-sm">{t('staff.team.login')}<input className="field mt-1" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} autoCapitalize="none" data-testid="team-login" /></label>
            <label className="block text-sm">{t('staff.team.name')}<input className="field mt-1" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} data-testid="team-name" /></label>
            <label className="block text-sm">{t('staff.team.role')}
              <select className="field mt-1" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'ADMIN' | 'DISPATCHER' })}>
                <option value="ADMIN">{t('staff.role.ADMIN')}</option><option value="DISPATCHER">{t('staff.role.DISPATCHER')}</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost !min-h-[44px] !py-2 text-sm" onClick={() => setForm(null)}>{t('staff.team.cancel')}</button>
            <button type="button" className="btn-primary !min-h-[44px] flex-1 !py-2 text-sm" onClick={() => void create()} data-testid="team-create">{t('staff.team.create')}</button>
          </div>
        </div>
      )}
      <div className="mt-3 space-y-2">
        {rows?.map((p) => (
          <div key={p.id} className={`card flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm ${p.active ? '' : 'opacity-60'}`} data-testid="team-row">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{p.displayName} <span className="font-normal text-muted">· {p.login}{p.id === me.id ? ` · ${t('staff.team.you')}` : ''}</span></div>
              <div className="text-xs text-muted">
                {p.isOwner ? t('staff.role.OWNER') : t(`staff.role.${p.role}`)} · {p.mfa ? t('staff.team.mfaOn') : t('staff.team.mfaOff')} · {p.lastSignIn ? t('staff.team.lastSignIn', { date: fmt.date(p.lastSignIn) }) : t('staff.team.never')}
                {!p.active && <span className="ms-1 text-danger">· {t('staff.team.off')}</span>}
              </div>
            </div>
            {!p.isOwner && (
              <div className="flex flex-wrap gap-3 text-xs">
                {p.active ? <button type="button" className="text-danger" onClick={() => void act(p, 'disable')}>{t('staff.team.disable')}</button> : <button type="button" className="text-accent" onClick={() => void act(p, 'enable')}>{t('staff.team.enable')}</button>}
                <button type="button" className="text-muted hover:text-ink" onClick={() => void act(p, 'resetPassword')}>{t('staff.team.resetPassword')}</button>
                {p.mfa && <button type="button" className="text-muted hover:text-ink" onClick={() => void act(p, 'resetMfa')}>{t('staff.team.resetMfa')}</button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
