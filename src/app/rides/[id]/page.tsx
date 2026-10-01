'use client';

import { use, useEffect, useState } from 'react';
import { Logo } from '@/components/Brand';
import { api, ApiRequestError } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

interface Line { label: string; cents: number }
interface Receipt {
  reference: string;
  completedAt: string | null;
  pickup: string;
  dropoff: string;
  vClass: string;
  passengerCount: number;
  driver: { name: string; vehicle: string; plate: string } | null;
  fare: {
    priceType: string; currency: string; isUpfront: boolean;
    estimateCents: number | null; waitingCents: number; finalCents: number | null;
    lines: Line[]; note: string; paymentMethod: string; paymentStatus: string;
  };
  rating: { stars: number } | null;
}

const eur = (cents: number, ccy: string) => `${ccy === 'EUR' ? '€' : ccy + ' '}${(cents / 100).toFixed(2)}`;
const PAYMENT: Record<string, string> = { CASH_TO_DRIVER: 'Cash to driver' };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try { setReceipt(await api<Receipt>(`/passenger/rides/${id}/receipt`)); }
      catch (e) {
        if (e instanceof ApiRequestError) setError(e.status === 401 ? 'Sign in to view this receipt.' : e.body.message);
        else setError('Could not load the receipt.');
      }
    })();
  }, [id]);

  const f = receipt?.fare;

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      <header className="mb-4 flex items-center justify-between">
        <a href="/"><Logo className="h-8" /></a>
        <a href="/rides" className="text-sm text-muted hover:text-ink">‹ My rides</a>
      </header>

      {error ? (
        <div className="card p-6 text-center text-sm text-muted">{error}</div>
      ) : !receipt ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold">Receipt</h1>
            <span className="text-xs text-muted">#{receipt.reference}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {receipt.completedAt ? new Date(receipt.completedAt).toLocaleString('en-GB') : 'Completed'} · {receipt.vClass} · {receipt.passengerCount} pax
          </p>

          <div className="mt-4 space-y-1 text-sm">
            <div className="flex gap-2"><span className="text-accent">●</span><span className="min-w-0">{receipt.pickup}</span></div>
            <div className="flex gap-2"><span className="text-muted">○</span><span className="min-w-0">{receipt.dropoff}</span></div>
          </div>

          {receipt.driver && (
            <div className="mt-4 border-t border-edge pt-3 text-sm">
              <div className="text-muted">Driver</div>
              <div className="font-medium">{receipt.driver.name}</div>
              <div className="text-xs text-muted">{receipt.driver.vehicle} · {receipt.driver.plate}</div>
            </div>
          )}

          {f && (
            <div className="mt-4 border-t border-edge pt-3">
              <div className="mb-1 text-sm text-muted">{f.isUpfront ? 'Fare' : 'Estimated fare'}</div>
              <div className="space-y-1 text-sm">
                {f.lines.map((l, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span className="min-w-0 text-muted">{l.label}</span>
                    <span className="shrink-0 tabular-nums">{eur(l.cents, f.currency)}</span>
                  </div>
                ))}
                {f.waitingCents > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">Waiting</span>
                    <span className="shrink-0 tabular-nums">{eur(f.waitingCents, f.currency)}</span>
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-baseline justify-between border-t border-edge pt-2">
                <span className="font-semibold">{f.isUpfront ? 'Total' : 'Estimated total'}</span>
                <span className="text-lg font-bold tabular-nums">
                  {f.isUpfront && f.finalCents != null ? eur(f.finalCents, f.currency) : f.estimateCents != null ? eur(f.estimateCents, f.currency) : '—'}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted">{f.note}</p>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-muted">{PAYMENT[f.paymentMethod] ?? f.paymentMethod}</span>
                <span className={f.paymentStatus === 'COLLECTED' ? 'text-accent' : 'text-muted'}>
                  {f.paymentStatus === 'COLLECTED' ? 'Paid' : 'Payment pending'}
                </span>
              </div>
            </div>
          )}

          {receipt.rating && (
            <div className="mt-4 border-t border-edge pt-3 text-sm">
              <span className="text-muted">Your rating: </span>
              <span className="text-accent">{'★'.repeat(receipt.rating.stars)}<span className="text-muted/40">{'★'.repeat(5 - receipt.rating.stars)}</span></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
