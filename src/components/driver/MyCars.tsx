'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { compressImageForUpload, UPLOAD_TARGET_BYTES } from '@/lib/image-compress';
import { useRefreshOnReturn } from '@/components/useRefreshOnReturn';
import { useSlotName } from '@/components/driver/DriverDocs';

// «Мои машины» (2026-11-24, operator): the driver works only on a car in the system that he is allowed on.
// Here he sees his cars, switches (offline, no ride), asks for a car already in the system (a fleet car —
// the fleet owner decides; another driver's car — that driver and the admin), or adds a new car with its
// documents for the admin to check. Others asking for HIS car are answered here too.

interface CarDoc { slot: string; expiresAt: string | null; daysLeft: number | null; expired: boolean; soon: boolean; waiting: boolean; returned: string | null }
interface Car { id: string; plate: string; make: string; model: string; color: string; vClass: string; seats: number; current: boolean; own: boolean; busy: boolean; expired: string | null; docs: CarDoc[] }
interface Access { id: string; status: string; vehicle: { plate: string; make: string; model: string } | null; waitingFor: string[] }
interface NewCar { id: string; status: string; vehicle: Record<string, string>; note: string | null; documents: { id: string; slot: string; decision: string; note: string | null }[] }
interface Data { online: boolean; onTrip: boolean; cars: Car[]; access: Access[]; newCars: NewCar[]; asks: { id: string; driverName: string; plate: string }[]; granted: { id: string; driverName: string; plate: string }[] }

const SLOTS = ['vehicle_reg', 'insurance', 'taxi_licence', 'vehicle_front', 'vehicle_rear'];

export function MyCars() {
  const { t, tError } = useT();
  const [d, setD] = useState<Data | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mode, setMode] = useState<null | 'existing' | 'new'>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Data>('/driver/cars').then(setD).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  useRefreshOnReturn(load);

  async function run(fn: () => Promise<unknown>, okText?: string) {
    setBusy(true); setMsg(null);
    try { await fn(); if (okText) setMsg({ ok: true, text: okText }); load(); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiRequestError ? tError(e) : t('driver.cars.failed') }); }
    finally { setBusy(false); }
  }
  if (!d) return <p className="p-4 text-sm text-muted">{t('common.loading')}</p>;
  const locked = d.online || d.onTrip;

  return (
    <div className="space-y-4" data-testid="my-cars">
      <h1 className="text-xl font-bold">{t('driver.cars.title')}</h1>
      {msg && <p role="status" className={`rounded-[12px] border px-3 py-2 text-sm ${msg.ok ? 'border-accent/40 text-accent' : 'border-danger/40 text-danger'}`}>{msg.text}</p>}

      {d.asks.length > 0 && (
        <section className="card border-danger/50 p-4" data-testid="car-asks">
          <div className="mb-2 font-medium">{t('driver.cars.asksTitle')}</div>
          {d.asks.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 border-t border-edge py-2 first:border-0">
              <span className="w-full text-sm">{t('driver.cars.asksLine', { who: a.driverName, plate: a.plate })}</span>
              <button className="btn-primary !min-h-0 !py-1.5 text-xs" disabled={busy} onClick={() => run(() => api(`/driver/cars/access/${a.id}`, { method: 'POST', body: { yes: true } }), t('driver.cars.answered'))}>{t('driver.cars.allow')}</button>
              <button className="btn-ghost !min-h-0 !py-1.5 text-xs" disabled={busy} onClick={() => run(() => api(`/driver/cars/access/${a.id}`, { method: 'POST', body: { yes: false } }), t('driver.cars.answered'))}>{t('driver.cars.deny')}</button>
            </div>
          ))}
        </section>
      )}

      <section className="card p-4">
        <div className="mb-1 font-medium">{t('driver.cars.mine')}</div>
        {locked && <p className="mb-2 text-xs text-warn">{d.onTrip ? t('driver.cars.lockedTrip') : t('driver.cars.lockedOnline')}</p>}
        {d.cars.length === 0 ? <p className="text-sm text-muted">{t('driver.cars.none')}</p> : (
          <ul className="divide-y divide-edge">
            {d.cars.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-3" data-testid={`car-${c.plate}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-[6px] border border-edge px-1.5 font-mono text-sm font-bold">{c.plate}</span>
                    {c.current && <span className="text-xs font-semibold text-accent">✓ {t('driver.cars.current')}</span>}
                  </div>
                  <div className="truncate text-sm text-muted">{c.color} {c.make} {c.model} · {t(`common.vClass.${c.vClass}` as never)}</div>
                  {c.busy && !c.current && <div className="text-xs text-warn">{t('driver.cars.busy')}</div>}
                  {c.expired && <div className="text-xs text-danger">{t('driver.cars.expired')}</div>}
                  {c.docs.length > 0 && <CarDocs car={c} onDone={load} />}
                </div>
                {!c.current && (
                  <button className="btn-primary !min-h-0 shrink-0 !py-1.5 text-xs" disabled={busy || locked || c.busy || !!c.expired} data-testid={`car-switch-${c.plate}`}
                    onClick={() => run(() => api('/driver/cars/switch', { method: 'POST', body: { vehicleId: c.id } }), t('driver.cars.switched', { plate: c.plate }))}>{t('driver.cars.workOn')}</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.granted.length > 0 && (
        <section className="card p-4" data-testid="car-granted">
          <div className="mb-1 font-medium">{t('driver.cars.grantedTitle')}</div>
          {d.granted.map((g) => (
            <div key={g.id} className="flex items-center gap-2 border-t border-edge py-2 text-sm first:border-0">
              <span className="min-w-0 flex-1">{g.driverName} · <span className="font-mono font-bold">{g.plate}</span></span>
              <button className="btn-ghost !min-h-0 !py-1.5 text-xs text-danger" disabled={busy} onClick={() => run(() => api(`/driver/cars/access/${g.id}`, { method: 'POST', body: { revoke: true } }), t('driver.cars.revoked'))}>{t('driver.cars.revoke')}</button>
            </div>
          ))}
        </section>
      )}

      {d.access.length > 0 && (
        <section className="card p-4">
          <div className="mb-1 font-medium">{t('driver.cars.requests')}</div>
          {d.access.map((a) => (
            <div key={a.id} className="border-t border-edge py-2 text-sm first:border-0">
              <span className="font-mono font-bold">{a.vehicle?.plate}</span> <span className="text-muted">{a.vehicle?.make} {a.vehicle?.model}</span>
              <div className={`text-xs ${a.status === 'REJECTED' ? 'text-danger' : 'text-muted'}`}>
                {a.status === 'REJECTED' ? t('driver.cars.rejected') : t('driver.cars.waiting', { who: a.waitingFor.map((w) => t(`driver.cars.who.${w}` as never)).join(', ') })}
              </div>
            </div>
          ))}
        </section>
      )}

      {d.newCars.map((n) => <NewCarCard key={n.id} n={n} onChange={load} />)}

      {mode === null && (
        <div className="grid gap-2">
          <button className="btn-ghost" onClick={() => { setMode('existing'); setMsg(null); }} data-testid="car-add-existing">{t('driver.cars.addExisting')}</button>
          <button className="btn-ghost" onClick={() => { setMode('new'); setMsg(null); }} data-testid="car-add-new">{t('driver.cars.addNew')}</button>
        </div>
      )}
      {mode === 'existing' && <ExistingForm busy={busy} onCancel={() => setMode(null)} onSend={(plate) => run(async () => { await api('/driver/cars/access', { method: 'POST', body: { plate } }); setMode(null); }, t('driver.cars.asked'))} />}
      {mode === 'new' && <NewForm busy={busy} onCancel={() => setMode(null)} onSend={(vehicle) => run(async () => { await api('/driver/cars/new', { method: 'POST', body: { vehicle } }); setMode(null); }, t('driver.cars.started'))} />}
    </div>
  );
}

function ExistingForm({ busy, onCancel, onSend }: { busy: boolean; onCancel: () => void; onSend: (plate: string) => void }) {
  const { t } = useT();
  const [plate, setPlate] = useState('');
  return (
    <section className="card space-y-3 p-4">
      <div className="font-medium">{t('driver.cars.addExisting')}</div>
      <p className="text-xs text-muted">{t('driver.cars.existingHint')}</p>
      <div><label className="label" htmlFor="car-plate">{t('driverReg.vehicle.plate')}</label>
        <input id="car-plate" className="field mt-1 font-mono uppercase" value={plate} onChange={(e) => setPlate(e.target.value)} autoCapitalize="characters" /></div>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={busy || plate.trim().length < 2} onClick={() => onSend(plate)}>{t('driver.cars.ask')}</button>
        <button className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </section>
  );
}

function NewForm({ busy, onCancel, onSend }: { busy: boolean; onCancel: () => void; onSend: (v: Record<string, string>) => void }) {
  const { t } = useT();
  const [v, setV] = useState<Record<string, string>>({ vClass: 'COMFORT', seats: '4' });
  const f = (k: string, label: string, mono = false) => (
    <div><label className="label" htmlFor={`nc-${k}`}>{label}</label>
      <input id={`nc-${k}`} className={`field mt-1 ${mono ? 'font-mono uppercase' : ''}`} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></div>
  );
  const ready = ['plate', 'vin', 'make', 'model', 'year', 'color', 'seats', 'vClass'].every((k) => (v[k] ?? '').trim());
  return (
    <section className="card space-y-3 p-4">
      <div className="font-medium">{t('driver.cars.addNew')}</div>
      <p className="text-xs text-muted">{t('driver.cars.newHint')}</p>
      {f('plate', t('driverReg.vehicle.plate'), true)}
      {f('vin', t('driverReg.vehicle.vin'), true)}
      <div className="grid grid-cols-2 gap-3">
        {f('make', t('driverReg.vehicle.make'))}
        {f('model', t('driverReg.vehicle.model'))}
        {f('year', t('driverReg.vehicle.year'))}
        {f('color', t('driverReg.vehicle.color'))}
        {f('seats', t('driverReg.vehicle.seats'))}
        <div><label className="label" htmlFor="nc-vClass">{t('driverReg.vehicle.serviceClass')}</label>
          <select id="nc-vClass" className="field mt-1" value={v.vClass} onChange={(e) => setV({ ...v, vClass: e.target.value })}>
            <option value="COMFORT">{t('driverReg.vehicle.classOption', { name: t('common.vClass.COMFORT'), seats: 4 })}</option>
            <option value="XL">{t('driverReg.vehicle.classOption', { name: t('common.vClass.XL'), seats: 6 })}</option>
          </select></div>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={busy || !ready} onClick={() => onSend(v)}>{t('driver.cars.next')}</button>
        <button className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </section>
  );
}

function NewCarCard({ n, onChange }: { n: NewCar; onChange: () => void }) {
  const { t, tError } = useT();
  const name = useSlotName();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const editable = n.status === 'DRAFT' || n.status === 'CHANGES';
  const doc = (s: string) => n.documents.find((x) => x.slot === s);
  const ready = SLOTS.every((s) => doc(s) && doc(s)!.decision !== 'CHANGES');

  async function upload(slot: string, file: File) {
    setBusy(slot); setErr(null);
    try {
      const body = await compressImageForUpload(file);
      if (body.size > UPLOAD_TARGET_BYTES) { setErr(t('driver.profile.renew.tooLarge')); return; }
      const res = await fetch(`/api/v1/driver/cars/new/${n.id}/documents?slot=${slot}`, { method: 'POST', body, credentials: 'same-origin' });
      if (!res.ok) { setErr(t('driver.profile.renew.failed')); return; }
      onChange();
    } catch { setErr(t('driver.profile.renew.failed')); } finally { setBusy(null); }
  }
  async function submit() {
    setBusy('submit'); setErr(null);
    try { await api(`/driver/cars/new/${n.id}/submit`, { method: 'POST' }); onChange(); }
    catch (e) { setErr(e instanceof ApiRequestError ? tError(e) : t('driver.cars.failed')); } finally { setBusy(null); }
  }
  return (
    <section className="card space-y-2 p-4" data-testid="new-car">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0"><span className="rounded-[6px] border border-edge px-1.5 font-mono text-sm font-bold">{n.vehicle.plate}</span> <span className="text-sm text-muted">{n.vehicle.make} {n.vehicle.model}</span></div>
        <span className={`chip shrink-0 ${n.status === 'REJECTED' || n.status === 'CHANGES' ? '!text-danger' : ''}`}>{t(`driver.cars.status.${n.status}` as never)}</span>
      </div>
      {n.note && <p className="text-xs text-danger">{n.note}</p>}
      {editable && SLOTS.map((s) => {
        const x = doc(s);
        return (
          <div key={s} className="rounded-[12px] border border-edge bg-elevated p-3">
            <div className="flex items-center justify-between text-sm">
              <span>{name(s)}</span>
              {x ? <span className={`chip ${x.decision === 'CHANGES' ? '!text-danger' : x.decision === 'ACCEPTED' ? '!text-accent' : ''}`}>{x.decision === 'CHANGES' ? t('driverReg.upload.redo') : x.decision === 'ACCEPTED' ? '✓' : t('driverReg.upload.uploaded')}</span> : <span className="text-xs text-warn">{t('driverReg.upload.required')}</span>}
            </div>
            {x?.note && <p className="mt-1 text-xs text-danger">{x.note}</p>}
            <label className="mt-2 inline-block cursor-pointer">
              <span className="btn-ghost !min-h-0 inline-block !py-1.5 text-xs">{busy === s ? t('driverReg.upload.uploading') : x ? t('driverReg.upload.replace') : t('driverReg.upload.uploadOrPhoto')}</span>
              <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(s, f); e.target.value = ''; }} />
            </label>
            {x && <a href={`/api/v1/driver/cars/doc/${x.id}`} target="_blank" rel="noreferrer" className="ms-2 text-xs text-accent hover:underline">{t('driverReg.upload.view')}</a>}
          </div>
        );
      })}
      {editable && <button className="btn-primary w-full" disabled={!ready || busy !== null} onClick={submit} data-testid="new-car-submit">{t('driver.cars.send')}</button>}
      {n.status === 'SUBMITTED' && <p className="text-xs text-muted">{t('driver.cars.underReview')}</p>}
      {err && <p className="text-xs text-danger">{err}</p>}
    </section>
  );
}

/** His own added car's documents (2026-11-24): dates, a red marker from 7 days, «Загрузить новый». */
function CarDocs({ car, onDone }: { car: Car; onDone: () => void }) {
  const { t, fmt } = useT();
  const name = useSlotName();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function upload(slot: string, file: File) {
    setBusy(slot); setMsg(null);
    try {
      const body = await compressImageForUpload(file);
      if (body.size > UPLOAD_TARGET_BYTES) { setMsg({ ok: false, text: t('driver.profile.renew.tooLarge') }); return; }
      const res = await fetch(`/api/v1/driver/cars/${car.id}/documents?slot=${slot}`, { method: 'POST', body, credentials: 'same-origin' });
      if (!res.ok) { setMsg({ ok: false, text: t('driver.profile.renew.failed') }); return; }
      setMsg({ ok: true, text: t('driver.profile.renew.sent') }); onDone();
    } catch { setMsg({ ok: false, text: t('driver.profile.renew.failed') }); } finally { setBusy(null); }
  }
  return (
    <div className="mt-2 space-y-1.5" data-testid={`car-docs-${car.plate}`}>
      {car.docs.map((x) => {
        const alarm = !x.waiting && (x.soon || x.expired);
        return (
          <div key={x.slot} className={`rounded-[10px] px-2 py-1.5 text-xs ${alarm ? 'border border-danger/50 bg-danger/10' : 'bg-elevated'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">{alarm && <span className="h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden />}{name(x.slot)}</span>
              {x.expiresAt && <span className={x.expired ? 'text-danger' : x.soon ? 'text-warn' : 'text-muted'}>{x.expired ? t('driver.profile.renew.expiredOn', { date: fmt.date(x.expiresAt) }) : t('driver.profile.renew.until', { date: fmt.date(x.expiresAt) })}</span>}
            </div>
            {x.waiting && <div className="mt-0.5 text-accent">✓ {t('driver.profile.renew.underReview')}</div>}
            {x.returned !== null && <div className="mt-0.5 text-danger">{x.returned ? t('driver.profile.renew.returnedNote', { note: x.returned }) : t('driver.profile.renew.returned')}</div>}
            <label className="mt-1 inline-block cursor-pointer">
              <span className={alarm ? 'font-semibold text-danger underline' : 'text-muted underline'}>{busy === x.slot ? t('driver.profile.renew.uploading') : x.waiting || x.returned !== null ? t('driver.profile.renew.uploadAgain') : t('driver.profile.renew.upload')}</span>
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(x.slot, f); e.target.value = ''; }} />
            </label>
          </div>
        );
      })}
      {msg && <p className={`text-xs ${msg.ok ? 'text-accent' : 'text-danger'}`} role="status">{msg.text}</p>}
    </div>
  );
}
