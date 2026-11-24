'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { StaffShell, DOCS_CHANGED } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useDialog } from '@/components/useDialog';
import { useT } from '@/i18n/I18nProvider';
import type { MsgKey } from '@/i18n/I18nProvider';

export const dynamic = 'force-dynamic';

// A new car a driver added in «Мои машины» (2026-11-24): compare every document and photo with the car,
// accept (insurance and taxi licence with their expiry date), then approve — or send back / refuse.
interface Doc { id: string; slot: string; decision: string; decisionNote: string | null; mime: string; scanStatus: string; expiresAt: string | null }
interface Req { id: string; status: string; driverName: string; vehicle: Record<string, string>; note: string | null; duplicate: { by: string; where: string; plate: string } | null; documents: Doc[] }

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <CarReview />}</StaffShell>;
}

function CarReview() {
  const { t, tError, fmt } = useT();
  const id = useParams<{ id: string }>().id;
  const [r, setR] = useState<Req | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dialog, ask] = useDialog();
  const load = useCallback(() => { api<Req>(`/admin/cars/requests/${id}`).then(setR).catch((e) => setErr(String(e))); }, [id]);
  useEffect(() => { load(); }, [load]);
  async function act(fn: () => Promise<unknown>) {
    setErr(null);
    try { await fn(); load(); window.dispatchEvent(new Event(DOCS_CHANGED)); } catch (e) { setErr(e instanceof ApiRequestError ? tError(e) : String(e)); }
  }
  if (!r) return <div className="p-8 text-muted">{err ?? t('staff.loading')}</div>;
  const v = r.vehicle;
  const slotName = (s: string) => t(`staff.cars.slot.${s}` as MsgKey);
  const facts = (photo: boolean) => (
    <div className="space-y-1 text-sm text-ink">
      <div><span className="text-muted">{t('staff.apps.match.plate')}: </span><b className="font-mono">{v.plate}</b></div>
      <div><span className="text-muted">VIN: </span><b className="font-mono">{v.vin}</b></div>
      <div><span className="text-muted">{t('staff.apps.match.car')}: </span>{[v.make, v.model, v.year, v.color].filter(Boolean).join(' · ')} · {v.vClass} · {v.seats}</div>
      <p className="pt-1 text-xs text-muted">{photo ? t('staff.apps.match.hintPhoto') : t('staff.cars.hintDoc')}</p>
    </div>
  );
  async function decideDoc(doc: Doc, decision: 'ACCEPTED' | 'CHANGES') {
    if (decision === 'CHANGES') {
      const note = await ask({ title: t('staff.apps.newDocTitle'), confirmLabel: t('staff.apps.sendToApplicant'), input: { label: t('staff.apps.newDocLabel'), multiline: true, required: true, minLength: 3 } });
      if (note === null) return;
      return act(() => api(`/admin/cars/docs/${doc.id}`, { method: 'POST', body: { decision, note } }));
    }
    const photo = doc.slot.startsWith('vehicle_') && doc.slot !== 'vehicle_reg';
    if (!(await ask({ title: t('staff.apps.match.title'), body: facts(photo), confirmLabel: t('staff.apps.match.confirm') }))) return;
    let expiresAt: string | undefined;
    if (doc.slot === 'insurance' || doc.slot === 'taxi_licence') {
      const dt = await ask({ title: t('staff.apps.acceptDocTitle'), confirmLabel: t('staff.apps.accept'), input: { label: t('staff.apps.expiry'), type: 'date', required: true, hint: t('staff.apps.expiryRequired') } });
      if (dt === null) return;
      expiresAt = new Date(dt).toISOString();
    }
    return act(() => api(`/admin/cars/docs/${doc.id}`, { method: 'POST', body: { decision, expiresAt } }));
  }
  async function decideCar(action: 'APPROVE' | 'RETURN' | 'REJECT') {
    let note: string | undefined;
    if (action !== 'APPROVE') {
      const n = await ask({ title: action === 'RETURN' ? t('staff.cars.returnTitle') : t('staff.cars.rejectTitle'), confirmLabel: t('staff.cars.send'), input: { label: t('staff.cars.noteLabel'), multiline: true, required: true, minLength: 3 } });
      if (n === null) return;
      note = n;
    }
    return act(() => api(`/admin/cars/requests/${r!.id}`, { method: 'POST', body: { action, note } }));
  }
  const allAccepted = r.documents.length >= 5 && r.documents.every((d) => d.decision === 'ACCEPTED');
  return (
    <div className="mx-auto max-w-5xl p-4">
      {dialog}
      <a href="/admin/vehicles" className="mb-3 inline-block text-sm text-muted hover:text-ink">‹ {t('staff.nav.vehicles')}</a>
      <h1 className="mb-1 text-xl font-bold">{t('staff.cars.reviewTitle', { plate: v.plate })}</h1>
      <p className="mb-4 text-sm text-muted">{r.driverName} · {t(`staff.cars.status.${r.status}` as MsgKey)}</p>
      {err && <p role="alert" className="mb-3 text-sm text-danger">{err}</p>}
      {r.duplicate && <p role="alert" className="card mb-3 border-danger p-3 text-sm text-danger">{t('staff.apps.match.dupVehicle', { plate: r.duplicate.plate, by: r.duplicate.by === 'vin' ? 'VIN' : t('staff.apps.match.byPlate') })}</p>}
      <div className="grid gap-4 md:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <section className="card border-warn/50 p-4"><h2 className="label mb-2">{t('staff.apps.match.box')}</h2>{facts(false)}</section>
          <section className="card p-4">
            <h2 className="label mb-2">{t('staff.docs.title')}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {r.documents.map((doc) => (
                <div key={doc.id} className={`rounded-[12px] border p-2 ${doc.decision === 'PENDING' ? 'border-danger/60' : 'border-edge'}`}>
                  <div className="text-xs font-medium">{slotName(doc.slot)}</div>
                  <a href={`/api/v1/admin/cars/docs/${doc.id}`} target="_blank" rel="noreferrer" className="mt-1 block">
                    {doc.mime.startsWith('image/')
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={`/api/v1/admin/cars/docs/${doc.id}`} alt={slotName(doc.slot)} className="h-28 w-full rounded object-cover" />
                      : <div className="flex h-28 items-center justify-center rounded bg-elevated text-xs">PDF</div>}
                  </a>
                  <div className="mt-1 text-xs text-muted">{t('staff.apps.scan', { s: doc.scanStatus })}{doc.expiresAt ? ` · ${t('staff.docs.untilShort', { date: fmt.date(doc.expiresAt) })}` : ''}</div>
                  {doc.scanStatus === 'UNAVAILABLE' && doc.decision !== 'ACCEPTED' && <div className="text-[11px] text-warn">{t('staff.docs.noScan')}</div>}
                  {doc.decisionNote && <div className="text-[11px] text-danger">{doc.decisionNote}</div>}
                  {r.status === 'SUBMITTED' && (
                    <div className="mt-1 flex gap-1">
                      <button className={`flex-1 rounded px-1 py-1 text-xs ${doc.decision === 'ACCEPTED' ? 'bg-accent text-[#10191C]' : 'bg-elevated'}`} onClick={() => decideDoc(doc, 'ACCEPTED')}>{t('staff.apps.accept')}</button>
                      <button className={`flex-1 rounded px-1 py-1 text-xs ${doc.decision === 'CHANGES' ? '!bg-danger/20 text-danger' : 'bg-elevated'}`} onClick={() => decideDoc(doc, 'CHANGES')}>{t('staff.apps.changes')}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
        {r.status === 'SUBMITTED' && (
          <section className="card h-fit space-y-2 p-4">
            <button className="btn-primary w-full" disabled={!allAccepted || !!r.duplicate} onClick={() => decideCar('APPROVE')} data-testid="car-approve">{t('staff.cars.approve')}</button>
            <button className="btn-ghost w-full text-warn" onClick={() => decideCar('RETURN')}>{t('staff.cars.return')}</button>
            <button className="btn-ghost w-full text-danger" onClick={() => decideCar('REJECT')}>{t('staff.cars.reject')}</button>
            <p className="text-xs text-muted">{t('staff.cars.approveHint')}</p>
          </section>
        )}
      </div>
    </div>
  );
}
