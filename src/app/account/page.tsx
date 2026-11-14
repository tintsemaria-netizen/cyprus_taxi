'use client';

import { PassengerTopBar } from '@/components/PassengerTopBar';
import { useEffect, useState } from 'react';
import { PlacesInput, Selected } from '@/components/booking/PlacesInput';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { PasswordInput } from '@/components/PasswordInput';
import { ConfirmSheet } from '@/components/ConfirmSheet';

export const dynamic = 'force-dynamic';

interface Me {
  hasPassword?: boolean; phone: string | null; name?: string | null; email?: string | null }

// Passenger profile settings (Task 019). Read-mostly: shows the verified phone + email; the display
// name is editable (phone/email changes need re-verification and are not offered here yet).
export default function Account() {
  const [me, setMe] = useState<Me | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t, tError } = useT();
  // Which settings category is expanded. /account#places (from the menu) opens that one.
  const [openCat, setOpenCat] = useState<string | null>(null);
  useEffect(() => {
    const fromHash = () => { const h = window.location.hash.replace('#', ''); if (h) setOpenCat(h); };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  const toggleCat = (id: string) => setOpenCat((c) => (c === id ? null : id));

  useEffect(() => {
    api<Me>('/passenger/me')
      .then((m) => { setMe(m); setName(m.name ?? ''); setAuthed(true); })
      .catch((e) => { if (e instanceof ApiRequestError && e.status === 401) setAuthed(false); else setAuthed(false); });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { const m = await api<Me>('/passenger/me', { method: 'PATCH', body: { name } }); setMe(m); setMsg(t('auth.account.saved')); }
    catch (err) { setMsg(err instanceof ApiRequestError ? tError(err) : t('auth.account.couldNotSave')); }
    finally { setBusy(false); }
  }
  async function logout() { await api('/passenger/logout', { method: 'POST' }).catch(() => {}); window.location.href = '/'; }

  if (authed === false) {
    return (
      <div>
      <PassengerTopBar />
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="mt-6 text-muted">{t('auth.account.signInPrompt')}</p>
        <a href="/login" className="btn-primary mt-4 inline-block">{t('auth.signIn')}</a>
      </div>
      </div>
    );
  }
  if (!me) return <div><PassengerTopBar /><div className="p-8 text-muted">{t('common.loading')}</div></div>;

  return (
    <div>
    <PassengerTopBar />
    <div className="mx-auto max-w-md space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">{t('auth.account.title')}</h1>

      {/* Settings grouped into collapsible categories (2026-11-14). */}
      <div className="card divide-y divide-edge overflow-hidden !p-0">
      <Category id="personal" icon="👤" title={t('auth.cat.personal')} sub={me.name || me.email || me.phone || ''} open={openCat} onToggle={toggleCat}>
      <form onSubmit={save} className="space-y-3">
        <div>
          <label className="label" htmlFor="account-f1">{t('auth.name')}</label>
          <input id="account-f1" className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="account-f2">{t('auth.phone')}</label>
          <input id="account-f2" className="field mt-1 opacity-70" value={me.phone ?? '—'} readOnly />
          <p className="mt-1 text-xs text-muted">{me.phone ? t('auth.account.phoneVerified') : t('auth.account.noPhone')}</p>
        </div>
        <div>
          <label className="label" htmlFor="account-f3">{t('auth.email')}</label>
          <input id="account-f3" className="field mt-1 opacity-70" value={me.email ?? '—'} readOnly />
          {!me.email && <p className="mt-1 text-xs text-muted">{t('auth.account.noEmail')}</p>}
        </div>
        {msg && <p className="text-sm text-muted">{msg}</p>}
        <button className="btn-primary min-h-[44px] w-full" disabled={busy || !name.trim()}>{busy ? t('auth.saving') : t('auth.account.save')}</button>
      </form>
      </Category>

      <Category id="security" icon="🔒" title={t('auth.cat.security')} sub={me.hasPassword ? t('auth.pw.title') : t('auth.pw.setTitle')} open={openCat} onToggle={toggleCat}>
        <ChangePassword hasPassword={!!me.hasPassword} />
      </Category>

      <Category id="places" icon="📍" title={t('auth.places.title')} sub={t('auth.cat.placesSub')} open={openCat} onToggle={toggleCat}>
        <SavedPlaces />
      </Category>

      <Category id="notifications" icon="🔔" title={t('auth.cat.notifications')} open={openCat} onToggle={toggleCat}>
        <p className="text-sm text-muted">{t('auth.account.notifications')}</p>
      </Category>

      <Category id="data" icon="🛡️" title={t('auth.data.title')} open={openCat} onToggle={toggleCat}>
        <DataRights />
      </Category>
      </div>
      <button onClick={logout} className="btn-ghost w-full !text-danger">{t('auth.logOut')}</button>
    </div>
    </div>
  );
}

interface Place { label: string; lat: number; lng: number }

// Saved places section (Task 019): set/clear Home and Work using the same address search as
// booking. Quick-pick chips for these appear under the destination field on the booking screen.
function SavedPlaces() {
  const [home, setHome] = useState<Place | null>(null);
  const [work, setWork] = useState<Place | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { t } = useT();

  useEffect(() => {
    api<{ home: Place | null; work: Place | null }>('/passenger/places')
      .then((r) => { setHome(r.home); setWork(r.work); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return (
    <section className="space-y-3">
      <p className="text-xs text-muted">{t('auth.places.subtitle')}</p>
      {!loaded ? <p className="text-sm text-muted">{t('common.loading')}</p> : (
        <>
          <PlaceEditor kind="HOME" icon="🏠" title={t('auth.places.home')} current={home} onChange={setHome} />
          <PlaceEditor kind="WORK" icon="💼" title={t('auth.places.work')} current={work} onChange={setWork} />
        </>
      )}
    </section>
  );
}

function PlaceEditor({ kind, icon, title, current, onChange }: { kind: 'HOME' | 'WORK'; icon: string; title: string; current: Place | null; onChange: (p: Place | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<Selected | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { t } = useT();

  async function save() {
    if (!sel) return;
    setBusy(true);
    try {
      const r = await api<{ place: Place }>('/passenger/places', { method: 'PUT', body: { kind, place: { label: sel.label, lat: sel.lat, lng: sel.lng } } });
      onChange(r.place); setEditing(false); setSel(null); setText('');
    } catch { /* keep editing */ } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api('/passenger/places', { method: 'PUT', body: { kind, place: null } }); onChange(null); setEditing(false); } catch { /* ignore */ } finally { setBusy(false); }
  }

  return (
    <div className="rounded-[12px] border border-edge p-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0"><span className="text-sm font-medium">{icon} {title}</span>{current && !editing && <div className="truncate text-xs text-muted">{current.label}</div>}</div>
        {!editing ? (
          <div className="flex gap-2">
            <button onClick={() => setEditing(true)} className="text-xs text-accent">{current ? t('auth.places.change') : t('auth.places.add')}</button>
            {current && <button onClick={remove} disabled={busy} className="text-xs text-danger">{t('auth.places.remove')}</button>}
          </div>
        ) : (
          <button onClick={() => { setEditing(false); setSel(null); setText(''); }} className="text-xs text-muted">{t('common.cancel')}</button>
        )}
      </div>
      {editing && (
        <div className="mt-2 space-y-2">
          <PlacesInput kind="To" value={sel} text={text} onText={setText} onSelect={setSel} />
          <button onClick={save} disabled={busy || !sel} className="btn-primary min-h-[44px] w-full">{busy ? t('auth.saving') : t(kind === 'HOME' ? 'auth.places.saveHome' : 'auth.places.saveWork')}</button>
        </div>
      )}
    </div>
  );
}

// GDPR access/portability + erasure (2026-10-01 audit).
function DataRights() {
  const { t, tError } = useT();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function del() {
    setBusy(true); setErr(null);
    try {
      await api('/passenger/me/delete', { method: 'POST', body: { confirm: 'DELETE' } });
      alertAndLeave(t('auth.data.deleted'));
    } catch (e) { setErr(tError(e)); setAsk(false); } finally { setBusy(false); }
  }
  function alertAndLeave(msg: string) {
    try { sessionStorage.setItem('il-y-flash', msg); } catch { /* ignore */ }
    window.location.href = '/';
  }
  return (
    <section>
      <p className="text-sm text-muted">{t('auth.data.body')}</p>
      {err && <p role="alert" className="mt-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <a href="/api/v1/passenger/me/export" download className="btn-ghost w-full text-center">{t('auth.data.download')}</a>
        <button className="w-full rounded-[12px] border border-danger/40 px-4 py-2.5 text-sm text-danger hover:bg-danger/10" onClick={() => setAsk(true)}>{t('auth.data.delete')}</button>
      </div>
      {ask && <ConfirmSheet title={t('auth.data.confirmTitle')} body={t('auth.data.confirmBody')} confirmLabel={t('auth.data.confirm')} danger busy={busy} onConfirm={del} onCancel={() => setAsk(false)} />}
    </section>
  );
}

// Change (or set) the account password (2026-11-14). An admin-issued temporary password is
// replaced here.
function ChangePassword({ hasPassword }: { hasPassword: boolean }) {
  const { t, tError } = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [has, setHas] = useState(hasPassword);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await api('/passenger/password', { method: 'POST', body: { current, next } });
      setMsg(t('auth.pw.changed')); setCurrent(''); setNext(''); setHas(true);
    } catch (err) { setMsg(err instanceof ApiRequestError ? tError(err) : t('auth.account.couldNotSave')); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      {has && (
        <div>
          <label className="label" htmlFor="pw-current">{t('auth.pw.current')}</label>
          <PasswordInput id="pw-current" className="field mt-1" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
      )}
      <div>
        <label className="label" htmlFor="pw-next">{t('auth.pw.next')}</label>
        <PasswordInput id="pw-next" className="field mt-1" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <p className="mt-1 text-xs text-muted">{t('auth.register.passwordHint')}</p>
      </div>
      {msg && <p className="text-sm text-muted">{msg}</p>}
      <button className="btn-primary min-h-[44px] w-full" disabled={busy || next.length < 8 || (has && !current)}>{busy ? t('auth.saving') : t('auth.pw.save')}</button>
    </form>
  );
}

// One collapsible settings category: icon, title, short summary and a chevron; one open at a time.
function Category({ id, icon, title, sub, open, onToggle, children }: { id: string; icon: string; title: string; sub?: string; open: string | null; onToggle: (id: string) => void; children: React.ReactNode }) {
  const isOpen = open === id;
  return (
    <section id={id}>
      <button type="button" onClick={() => onToggle(id)} aria-expanded={isOpen} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-elevated">
        <span className="text-xl" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{title}</span>
          {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
        </span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}><path d="M9 5l7 7-7 7" /></svg>
      </button>
      {isOpen && <div className="px-4 pb-4 pt-1">{children}</div>}
    </section>
  );
}
