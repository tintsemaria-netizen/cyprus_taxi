'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { PassengerLoginModal } from '@/components/booking/PassengerLoginModal';
import { api, ApiRequestError } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

interface Ride { id: string; reference: string; status: string; active: boolean; at: string; pickup: string; dropoff: string; fareCents: number | null }

export default function Page() {
  const router = useRouter();
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [show, setShow] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api<{ rides: Ride[] }>('/passenger/rides'); setRides(r.rides); setNeedLogin(false); }
    catch (e) { if (e instanceof ApiRequestError && e.status === 401) { setNeedLogin(true); setRides([]); } }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function openTracking(id: string) {
    try {
      const r = await api<{ token: string }>(`/passenger/rides/${id}/track`, { method: 'POST' });
      await api('/tracking/exchange', { method: 'POST', body: { token: r.token } });
      router.push('/track');
    } catch { /* ignore */ }
  }

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      <header className="mb-4 flex items-center justify-between">
        <a href="/"><Logo className="h-8" /></a>
        <a href="/" className="text-sm text-muted hover:text-ink">Book</a>
      </header>
      <h1 className="mb-3 text-xl font-bold">My rides</h1>
      {needLogin ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-muted">Sign in to see your ride history.</p>
          <button className="btn-primary mt-3" onClick={() => setShow(true)}>Sign in</button>
        </div>
      ) : rides === null ? (
        <p className="text-muted">Loading…</p>
      ) : rides.length === 0 ? (
        <p className="text-sm text-muted">No rides yet. <a href="/" className="text-accent hover:underline">Book your first ride →</a></p>
      ) : (
        <div className="card divide-y divide-edge">
          {rides.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{r.pickup} → {r.dropoff}</div>
                <div className="text-xs text-muted">{new Date(r.at).toLocaleString('en-GB')} · {r.fareCents != null ? `≈ €${(r.fareCents / 100).toFixed(2)}` : '—'}</div>
              </div>
              <div className="text-right">
                <div className="chip">{r.status.replace(/_/g, ' ')}</div>
                {r.active && <button className="mt-1 block text-xs text-accent hover:underline" onClick={() => openTracking(r.id)}>Track live ›</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {show && <PassengerLoginModal onClose={() => setShow(false)} onDone={() => { setShow(false); load(); }} />}
    </div>
  );
}
