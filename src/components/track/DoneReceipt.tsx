'use client';

import { useState } from 'react';
import { useT } from '@/i18n/I18nProvider';

// The passenger's receipt on the finished-ride screen (operator 2026-11-26): instead of the rating — «К оплате» with the
// amount and «Поделиться» (the phone's share sheet, or a copy). The amount is
// the server's fare-total (same as «Мои поездки», the e-mail and the driver's «Итого»).
export interface DoneReceiptData {
  totalCents: number | null;
  completedAt: string | null;
  estimateCents: number | null;
  waitingCents: number;
  finalCents: number | null;
  currency: string;
  paymentMethod: string;
}

export function DoneReceipt({ r, reference, from, to, stop }: { r: DoneReceiptData; reference: string; from: string; to: string; stop?: string | null }) {
  const { t, fmt } = useT();
  const [note, setNote] = useState<string | null>(null);
  const money = (c: number) => fmt.money(c, r.currency);
  const total = r.totalCents != null ? money(r.totalCents) : '—';
  const payWord = r.paymentMethod === 'CASH_TO_DRIVER' ? t('track.done.payDriver') : r.paymentMethod;

  async function share() {
    const text = [
      `${t('track.done.receipt')} · #${reference}`,
      r.completedAt ? fmt.dateTime(r.completedAt) : null,
      `${from} → ${stop ? `${stop} → ` : ''}${to}`,
      `${t('track.done.toPay')}: ${total}`,
      payWord,
    ].filter(Boolean).join('\n');
    setNote(null);
    try {
      if (typeof navigator !== 'undefined' && navigator.share) { await navigator.share({ title: t('track.done.receipt'), text }); return; }
    } catch (e) { if ((e as Error)?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); setNote(t('track.done.copied')); } catch { /* nothing to do */ }
  }

  return (
    <div className="mt-3 rounded-[14px] border border-edge-strong bg-elevated p-4" data-testid="done-receipt">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted">{t('track.done.toPay')}</span>
        <span className="text-[28px] font-bold leading-none tabular-nums text-ink" data-testid="done-total">{total}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-muted">
        <span>{payWord}</span>
        <span>#{reference}{r.completedAt ? ` · ${fmt.time(r.completedAt)}` : ''}</span>
      </div>
      {/* «Поделиться» is a plain text link bottom-right; no «Подробнее» (operator 2026-11-26). */}
      <div className="mt-2 flex justify-end">
        <button type="button" onClick={() => void share()} className="text-sm text-muted hover:text-ink hover:underline" data-testid="done-share">↗ {t('track.done.share')}</button>
      </div>
      {note && <p className="mt-2 text-center text-xs text-muted">{note}</p>}
    </div>
  );
}
