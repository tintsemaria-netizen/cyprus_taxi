'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { StaffShell, DOCS_CHANGED } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useDialog } from '@/components/useDialog';
import { useT } from '@/i18n/I18nProvider';
import type { MsgKey } from '@/i18n/I18nProvider';

export const dynamic = 'force-dynamic';

// Documents of a car added through «Мои машины» (2026-11-24): the owner uploaded a new insurance / taxi
// licence / photo — compare it with the car, accept with the new date, or send it back.
interface Doc { id: string; slot: string; decision: string; decisionNote: string | null; mime: string; scanStatus: string; expiresAt: string | null; createdAt: string }
interface D { vehicle: { id: string; plate: string; vin: string | null; make: string; model: string; color: string; vClass: string; seats: number; ownerName: string | null }; documents: Doc[] }

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <CarDocs />}</StaffShell>;
}

function CarDocs() {
  const { t, tError, fmt } = useT();
  const id = useParams<{ id: string }>().id;
  const [d, setD] = useState<D | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dialog, ask] = useDialog();
  const load = useCallback(() => { api<D>(`/admin/vehicles/${id}/documents`).then(setD).catch((e) => setErr(String(e))); }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (d && window.location.hash.startsWith('#doc-')) document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'center' }); }, [d]);
  if (!d) return <div className="p-8 text-muted">{err ?? t('staff.loading')}</div>;
  const v = d.vehicle;
  const facts = (photo: boolean) => (
    <div className="space-y-1 text-sm text-ink">
      <div><span className="text-muted">{t('staff.apps.match.plate')}: </span><b className="font-mono">{v.plate}</b></div>
      {v.vin && <div><span className="text-muted">VIN: </span><b className="font-mono">{v.vin}</b></div>}
      <div><span className="text-muted">{t('staff.apps.match.car')}: </span>{[v.make, v.model, v.color].join(' · ')}</div>
      <p className="pt-1 text-xs text-muted">{photo ? t('staff.apps.match.hintPhoto') : t('staff.cars.hintDoc')}</p>
    </div>
  );
  async function decide(doc: Doc, decision: 'ACCEPTED' | 'CHANGES') {
    setErr(null);
    let body: Record<string, unknown> = { decision };
    if (decision === 'CHANGES') {
      const note = await ask({ title: t('staff.apps.newDocTitle'), confirmLabel: t('staff.apps.sendToApplicant'), input: { label: t('staff.apps.newDocLabel'), multiline: true, required: true, minLength: 3 } });
      if (note === null) return;
      body = { decision, note };
    } else {
      if (!(await ask({ title: t('staff.apps.match.title'), body: facts(doc.slot.startsWith('vehicle_')), confirmLabel: t('staff.apps.match.confirm') }))) return;
      if (doc.slot === 'insurance' || doc.slot === 'taxi_licence') {
        const dt = await ask({ title: t('staff.apps.acceptDocTitle'), confirmLabel: t('staff.apps.accept'), input: { label: t('staff.apps.expiry'), type: 'date', required: true, hint: t('staff.apps.expiryRequired') } });
        if (dt === null) return;
        body = { decision, expiresAt: new Date(dt).toISOString() };
      }
    }
    try { await api(`/admin/cars/docs/${doc.id}`, { method: 'POST', body }); load(); window.dispatchEvent(new Event(DOCS_CHANGED)); }
    catch (e) { setErr(e instanceof ApiRequestError ? tError(e) : String(e)); }
  }
  return (
    <div className="mx-auto max-w-4xl p-4">
      {dialog}
      <a href="/admin/vehicles" className="mb-3 inline-block text-sm text-muted hover:text-ink">‹ {t('staff.nav.vehicles')}</a>
      <h1 className="text-xl font-bold">{t('staff.cars.carDocsTitle', { plate: v.plate })}</h1>
      {v.ownerName && <p className="mb-3 text-sm text-muted">{t('staff.cars.owner', { name: v.ownerName })}</p>}
      {err && <p role="alert" className="mb-3 text-sm text-danger">{err}</p>}
      <section className="card mb-4 border-warn/50 p-4"><h2 className="label mb-2">{t('staff.apps.match.box')}</h2>{facts(false)}</section>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {d.documents.map((doc) => (
          <div key={doc.id} id={`doc-${doc.id}`} className={`rounded-[12px] border p-2 ${doc.decision === 'PENDING' ? 'row-alert border-danger' : 'border-edge'}`}>
            <div className="text-xs font-medium">{t(`staff.cars.slot.${doc.slot}` as MsgKey)}</div>
            <div className={`text-[11px] ${doc.decision === 'PENDING' ? 'font-semibold text-danger' : 'text-muted'}`}>
              {doc.decision === 'PENDING' ? t('staff.docs.newLabel', { date: fmt.dateTime(doc.createdAt) }) : doc.expiresAt ? t('staff.docs.currentLabel', { date: fmt.date(doc.expiresAt) }) : ''}
            </div>
            <a href={`/api/v1/admin/cars/docs/${doc.id}`} target="_blank" rel="noreferrer" className="mt-1 block">
              {doc.mime.startsWith('image/')
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={`/api/v1/admin/cars/docs/${doc.id}`} alt="" className="h-28 w-full rounded object-cover" />
                : <div className="flex h-28 items-center justify-center rounded bg-elevated text-xs">PDF</div>}
            </a>
            <div className="mt-1 text-xs text-muted">{t('staff.apps.scan', { s: doc.scanStatus })}</div>
            {doc.scanStatus === 'UNAVAILABLE' && doc.decision === 'PENDING' && <div className="text-[11px] text-warn">{t('staff.docs.noScan')}</div>}
            {doc.decisionNote && <div className="text-[11px] text-danger">{doc.decisionNote}</div>}
            {doc.decision === 'PENDING' && (
              <div className="mt-1 flex gap-1">
                <button className="flex-1 rounded bg-elevated px-1 py-1 text-xs" onClick={() => decide(doc, 'ACCEPTED')}>{t('staff.apps.accept')}</button>
                <button className="flex-1 rounded bg-elevated px-1 py-1 text-xs" onClick={() => decide(doc, 'CHANGES')}>{t('staff.apps.changes')}</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
