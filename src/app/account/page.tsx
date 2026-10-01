'use client';

import { useEffect, useState } from 'react';
import { Logo } from '@/components/Brand';
import { PlacesInput, Selected } from '@/components/booking/PlacesInput';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

export const dynamic = 'force-dynamic';

interface Me { phone: string; name?: string | null; email?: string | null }

// Passenger profile settings (Task 019). Read-mostly: shows the verified phone + email; the display
// name is editable (phone/email changes need re-verification and are not offered here yet).
export default function Account() {
  const [me, setMe] = useState<Me | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t, tError } = useT();

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
      <div className="mx-auto max-w-md p-6 text-center">
        <div className="flex justify-end"><LanguageSwitcher /></div>
        <a href="/" className="inline-block"><Logo /></a>
        <p className="mt-6 text-muted">{t('auth.account.signInPrompt')}</p>
        <a href="/login" className="btn-primary mt-4 inline-block">{t('auth.signIn')}</a>
      </div>
    );
  }
  if (!me) return <div className="p-8 text-muted">{t('common.loading')}</div>;

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <a href="/" className="inline-block"><Logo /></a>
        <div className="flex items-center gap-3"><a href="/rides" className="text-sm text-accent">{t('auth.myRides')}</a><LanguageSwitcher /></div>
      </div>
      <h1 className="text-2xl font-semibold">{t('auth.account.title')}</h1>

      <form onSubmit={save} className="card space-y-3 p-4">
        <div>
          <label className="label" htmlFor="account-f1">{t('auth.name')}</label>
          <input id="account-f1" className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="account-f2">{t('auth.phone')}</label>
          <input id="account-f2" className="field mt-1 opacity-70" value={me.phone} readOnly />
          <p className="mt-1 text-xs text-muted">{t('auth.account.phoneVerified')}</p>
        </div>
        <div>
          <label className="label" htmlFor="account-f3">{t('auth.email')}</label>
          <input id="account-f3" className="field mt-1 opacity-70" value={me.email ?? '—'} readOnly />
          {!me.email && <p className="mt-1 text-xs text-muted">{t('auth.account.noEmail')}</p>}
        </div>
        {msg && <p className="text-sm text-muted">{msg}</p>}
        <button className="btn-primary min-h-[44px] w-full" disabled={busy || !name.trim()}>{busy ? t('auth.saving') : t('auth.account.save')}</button>
      </form>

      <SavedPlaces />

      <div className="card p-4 text-sm text-muted">
        {t('auth.account.notifications')}
      </div>

      <button onClick={logout} className="btn-ghost w-full !text-danger">{t('auth.logOut')}</button>
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
    <section id="places" className="card space-y-3 p-4">
      <h2 className="font-medium">{t('auth.places.title')}</h2>
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
