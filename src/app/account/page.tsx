'use client';

import { useEffect, useState } from 'react';
import { Logo } from '@/components/Brand';
import { api, ApiRequestError } from '@/lib/api-client';

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

  useEffect(() => {
    api<Me>('/passenger/me')
      .then((m) => { setMe(m); setName(m.name ?? ''); setAuthed(true); })
      .catch((e) => { if (e instanceof ApiRequestError && e.status === 401) setAuthed(false); else setAuthed(false); });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { const m = await api<Me>('/passenger/me', { method: 'PATCH', body: { name } }); setMe(m); setMsg('Saved.'); }
    catch (err) { setMsg(err instanceof ApiRequestError ? err.body.message : 'Could not save.'); }
    finally { setBusy(false); }
  }
  async function logout() { await api('/passenger/logout', { method: 'POST' }).catch(() => {}); window.location.href = '/'; }

  if (authed === false) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <a href="/" className="inline-block"><Logo /></a>
        <p className="mt-6 text-muted">Please sign in to view your account.</p>
        <a href="/login" className="btn-primary mt-4 inline-block">Sign in</a>
      </div>
    );
  }
  if (!me) return <div className="p-8 text-muted">Loading…</div>;

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <a href="/" className="inline-block"><Logo /></a>
        <a href="/rides" className="text-sm text-accent">My rides</a>
      </div>
      <h1 className="text-2xl font-semibold">Profile settings</h1>

      <form onSubmit={save} className="card space-y-3 p-4">
        <div>
          <label className="label">Name</label>
          <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="field mt-1 opacity-70" value={me.phone} readOnly />
          <p className="mt-1 text-[11px] text-muted">Verified. Changing your phone requires re-verification (not available here yet).</p>
        </div>
        <div>
          <label className="label">Email</label>
          <input className="field mt-1 opacity-70" value={me.email ?? '—'} readOnly />
          {!me.email && <p className="mt-1 text-[11px] text-muted">No email on this account (phone sign-in). Register with email to add one.</p>}
        </div>
        {msg && <p className="text-sm text-muted">{msg}</p>}
        <button className="btn-primary min-h-[44px] w-full" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
      </form>

      <div className="card p-4 text-sm text-muted">
        Ride notifications are enabled per trip from the tracking screen after you book.
      </div>

      <button onClick={logout} className="btn-ghost w-full !text-danger">Log out</button>
    </div>
  );
}
