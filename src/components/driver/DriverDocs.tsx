'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import type { MsgKey } from '@/i18n/I18nProvider';
import { compressImageForUpload, UPLOAD_TARGET_BYTES } from '@/lib/image-compress';
import { useRefreshOnReturn } from '@/components/useRefreshOnReturn';

// The driver's documents (2026-11-24, operator): a marker from 7 days before a document expires, and the
// driver uploads the new one himself. The operator checks the photo and types the new date; until then
// he keeps working (option «б»).

export interface DriverDoc {
  slot: string; status: string; expiresAt: string | null; canRenew: boolean; daysLeft: number | null;
  renewal: { status: 'UNDER_REVIEW' | 'ACTION_NEEDED'; uploadedAt: string; note: string | null } | null;
}
type Docs = { available: boolean; note?: string; documents: DriverDoc[] };

export function useSlotName() {
  const { t } = useT();
  return (slot: string) => {
    const k = `driver.profile.slot.${slot}` as MsgKey;
    const v = t(k);
    if (v !== k) return v;
    if (/^(vehicle_|cabin_|boot)/.test(slot)) return t('driver.profile.slot.photo');
    return slot.replace(/_/g, ' ');
  };
}

/** What needs him first: returned, expired, expiring, waiting — then the rest. */
const attn = (d: DriverDoc) => (d.renewal?.status === 'ACTION_NEEDED' ? 4 : d.renewal ? 1 : d.status === 'EXPIRED' ? 3 : d.status === 'EXPIRING' ? 2 : 0);

export function DriverDocs() {
  const { t } = useT();
  const [docs, setDocs] = useState<Docs | null>(null);
  const load = useCallback(() => { api<Docs>('/driver/documents').then(setDocs).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  useRefreshOnReturn(load);

  return (
    <div className="card p-4" id="driver-docs" data-testid="driver-docs">
      <div className="mb-1 font-medium">{t('driver.profile.documents')}</div>
      {!docs ? <p className="text-sm text-muted">{t('common.loading')}</p> : !docs.available ? <p className="text-sm text-muted">{t('driver.profile.docsLegacy')}</p> : docs.documents.length === 0 ? <p className="text-sm text-muted">{t('driver.profile.noDocuments')}</p> : (
        <ul className="divide-y divide-edge text-sm">{[...docs.documents].sort((a, b) => attn(b) - attn(a)).map((d) => <DocRow key={d.slot} d={d} onDone={load} />)}</ul>
      )}
    </div>
  );
}

function DocRow({ d, onDone }: { d: DriverDoc; onDone: () => void }) {
  const { t, fmt } = useT();
  const name = useSlotName();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const waiting = d.renewal?.status === 'UNDER_REVIEW';
  const returned = d.renewal?.status === 'ACTION_NEEDED';
  // The marker (7 days before, or expired) only while nothing new is waiting.
  const alarm = !waiting && (d.status === 'EXPIRING' || d.status === 'EXPIRED');
  const color = d.status === 'EXPIRED' ? 'text-danger' : d.status === 'EXPIRING' ? 'text-warn' : d.status === 'VALID' ? 'text-accent' : 'text-muted';
  const statusText = d.expiresAt
    ? (d.status === 'EXPIRED' ? t('driver.profile.renew.expiredOn', { date: fmt.date(d.expiresAt) }) : `${t(`driver.profile.docStatus.${d.status}` as MsgKey)} · ${t('driver.profile.renew.until', { date: fmt.date(d.expiresAt) })}`)
    : t(`driver.profile.docStatus.${d.status}` as MsgKey);

  async function onFile(file: File) {
    setBusy(true); setMsg(null);
    try {
      const body = await compressImageForUpload(file);
      if (body.size > UPLOAD_TARGET_BYTES) { setMsg({ ok: false, text: t('driver.profile.renew.tooLarge') }); return; }
      const res = await fetch(`/api/v1/driver/documents?slot=${encodeURIComponent(d.slot)}`, { method: 'POST', body, credentials: 'same-origin' });
      if (res.status === 413) { setMsg({ ok: false, text: t('driver.profile.renew.tooLarge') }); return; }
      if (!res.ok) { setMsg({ ok: false, text: t('driver.profile.renew.failed') }); return; }
      setMsg({ ok: true, text: t('driver.profile.renew.sent') });
      onDone();
    } catch { setMsg({ ok: false, text: t('driver.profile.renew.failed') }); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  return (
    <li className={`py-2.5 ${alarm ? '-mx-2 rounded-[10px] border border-danger/50 bg-danger/10 px-2' : ''}`} data-testid={`doc-${d.slot}`} data-alarm={alarm ? '' : undefined}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-1.5">
          {alarm && <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />}
          {name(d.slot)}
        </span>
        <span className={`text-end ${color}`}>{statusText}</span>
      </div>
      {waiting && <p className="mt-1 text-xs text-accent" data-testid="doc-waiting">✓ {t('driver.profile.renew.underReview')}</p>}
      {returned && <p className="mt-1 text-xs text-danger">{d.renewal?.note ? t('driver.profile.renew.returnedNote', { note: d.renewal.note }) : t('driver.profile.renew.returned')}</p>}
      {d.canRenew && (
        <>
          <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
          {/* Uploading again is always possible: a better photo replaces the one still waiting. */}
          {(alarm || returned || waiting) && (
            <button type="button" disabled={busy} onClick={() => input.current?.click()} data-testid={`doc-upload-${d.slot}`}
              className={`mt-2 w-full ${alarm || returned ? 'btn-primary' : 'btn-ghost !min-h-0 !py-1.5 text-xs'}`}>
              {busy ? t('driver.profile.renew.uploading') : waiting || returned ? t('driver.profile.renew.uploadAgain') : t('driver.profile.renew.upload')}
            </button>
          )}
          {!alarm && !returned && !waiting && (
            <button type="button" disabled={busy} onClick={() => input.current?.click()} className="mt-1 text-xs text-muted underline" data-testid={`doc-upload-${d.slot}`}>
              {busy ? t('driver.profile.renew.uploading') : t('driver.profile.renew.upload')}
            </button>
          )}
        </>
      )}
      {msg && <p className={`mt-1 text-xs ${msg.ok ? 'text-accent' : 'text-danger'}`} role="status">{msg.text}</p>}
    </li>
  );
}
