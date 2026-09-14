'use client';

import { useCallback, useEffect, useState } from 'react';
import { Logo } from '@/components/Brand';
import { api, ApiRequestError } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

interface AppDoc { id: string; slot: string; decision: string; decisionNote: string | null; mime: string }
interface AppData {
  status: string; revision: number; decisionReason: string | null; phone: string;
  identity: Record<string, string>; driving: Record<string, string>; vehicle: Record<string, string>;
  documents: AppDoc[];
}

const STEPS = ['Identity', 'Driving', 'Vehicle', 'Photos', 'Review'];

export default function Register() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [app, setApp] = useState<AppData | null>(null);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const a = await api<AppData>('/applicant/application'); setApp(a); setAuthed(true); }
    catch (e) { if (e instanceof ApiRequestError && e.status === 401) setAuthed(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (authed === null) return <Centered>Loading…</Centered>;
  if (!authed) return <PhoneGate onDone={load} />;
  if (!app) return <Centered>Loading application…</Centered>;

  if (app.status === 'SUBMITTED' || app.status === 'IN_REVIEW') return <StatusCard app={app} title="Under review" body="Thanks! Your application is being reviewed. You cannot accept rides until approved." />;
  if (app.status === 'APPROVED') return <StatusCard app={app} title="Approved 🎉" body="Your driver account is active. Sign in to go online." cta={{ href: '/driver/login', label: 'Driver sign in' }} />;
  if (app.status === 'REJECTED') return <StatusCard app={app} title="Application not approved" body={app.decisionReason || 'Please contact support.'} />;

  // DRAFT or CHANGES_REQUESTED → wizard
  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between"><Logo className="h-8" /><LogoutBtn /></div>
      {app.status === 'CHANGES_REQUESTED' && app.decisionReason && (
        <p className="mb-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">Changes requested: {app.decisionReason}</p>
      )}
      <ol className="mb-4 flex gap-1 text-[11px]">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex-1 rounded-full px-2 py-1 text-center ${i === step ? 'bg-accent text-[#10191C] font-semibold' : i < step ? 'bg-elevated text-accent' : 'bg-elevated text-muted'}`}>{s}</li>
        ))}
      </ol>
      {err && <p className="mb-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}

      {step === 0 && <IdentityStep app={app} reload={load} />}
      {step === 1 && <DrivingStep app={app} reload={load} />}
      {step === 2 && <VehicleStep app={app} reload={load} />}
      {step === 3 && <PhotosStep app={app} reload={load} />}
      {step === 4 && <ReviewStep app={app} reload={load} setErr={setErr} />}

      <div className="mt-5 flex justify-between">
        <button className="btn-ghost !min-h-0 !py-2 text-sm" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</button>
        {step < STEPS.length - 1 && <button className="btn-primary !min-h-0 !py-2 text-sm" onClick={() => setStep((s) => s + 1)}>Next</button>}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[100dvh] items-center justify-center px-4 text-muted">{children}</div>;
}

function LogoutBtn() {
  return <button className="text-xs text-muted hover:text-ink" onClick={async () => { await api('/applicant/logout', { method: 'POST' }); location.reload(); }}>Sign out</button>;
}

function StatusCard({ app, title, body, cta }: { app: AppData; title: string; body: string; cta?: { href: string; label: string } }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6 text-center">
        <Logo className="mb-4 h-8 justify-center" />
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="mt-2 text-sm text-muted">{body}</p>
        <p className="mt-2 text-xs text-muted">Ref {app.phone}</p>
        {cta && <a href={cta.href} className="btn-primary mt-4 w-full">{cta.label}</a>}
        <a href="/" className="mt-3 block text-sm text-muted hover:text-ink">Back to booking</a>
      </div>
    </div>
  );
}

// ---- Phone OTP gate ----
function PhoneGate({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [dev, setDev] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function req() { setBusy(true); setErr(null); try { const r = await api<{ sent: boolean; devCode?: string }>('/applicant/otp/request', { method: 'POST', body: { phone } }); if (!r.sent) { setErr('SMS unavailable, try again.'); return; } setDev(r.devCode ?? null); setStage('code'); } catch (e) { if (e instanceof ApiRequestError) setErr(e.body.message); } finally { setBusy(false); } }
  async function ver() { setBusy(true); setErr(null); try { await api('/applicant/otp/verify', { method: 'POST', body: { phone, code } }); onDone(); } catch (e) { if (e instanceof ApiRequestError) setErr(e.body.message); } finally { setBusy(false); } }
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <a href="/" className="inline-block"><Logo /></a>
        <h1 className="mt-6 text-xl font-bold">Register as a driver</h1>
        <p className="mt-1 text-sm text-muted">Verify your phone to start. You&apos;ll add your identity, licence and vehicle documents for admin review. You can save and resume anytime.</p>
        {err && <p className="mt-4 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
        {stage === 'phone' ? (
          <div className="mt-4 space-y-3">
            <div><label className="label">Phone (international)</label><input className="field mt-1" placeholder="+35799123456" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></div>
            <button className="btn-primary w-full" disabled={busy || !phone} onClick={req}>{busy ? 'Sending…' : 'Send code'}</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {dev && <p className="rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">Demo code: <b>{dev}</b></p>}
            <input className="field text-center font-mono text-lg tracking-widest" inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <button className="btn-primary w-full" disabled={busy || code.length < 4} onClick={ver}>{busy ? 'Verifying…' : 'Verify & continue'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- shared field + upload helpers ----
function useDraft(section: 'identity' | 'driving' | 'vehicle', app: AppData) {
  const [v, setV] = useState<Record<string, string>>(app[section]);
  const save = async () => { try { await api('/applicant/application', { method: 'PATCH', body: { [section]: v } }); } catch { /* ignore */ } };
  return { v, setV, save };
}
function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (s: string) => void; type?: string }) {
  return <div><label className="label">{label}</label><input type={type} className="field mt-1" value={value || ''} onChange={(e) => onChange(e.target.value)} onBlur={() => { /* saved by step */ }} /></div>;
}
function Upload({ slot, app, reload, label }: { slot: string; app: AppData; reload: () => void; label: string }) {
  const [busy, setBusy] = useState(false);
  const [e, setE] = useState<string | null>(null);
  const has = app.documents.find((d) => d.slot === slot);
  async function onFile(file: File) {
    setBusy(true); setE(null);
    try {
      const res = await fetch(`/api/v1/applicant/application/documents?slot=${slot}`, { method: 'POST', body: file, credentials: 'same-origin' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setE(j?.error?.message || j?.error?.fieldErrors?.file || 'Upload failed.'); return; }
      reload();
    } catch { setE('Upload failed. Retry.'); } finally { setBusy(false); }
  }
  return (
    <div className="rounded-[12px] border border-edge bg-elevated p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm">{label}</span>
        {has ? <span className={`chip ${has.decision === 'ACCEPTED' ? '!text-accent' : has.decision === 'CHANGES' ? '!text-danger' : ''}`}>{has.decision === 'CHANGES' ? 'Redo' : has.decision === 'ACCEPTED' ? '✓' : 'uploaded'}</span> : <span className="text-xs text-muted">required</span>}
      </div>
      {has?.decisionNote && <p className="mt-1 text-[11px] text-danger">{has.decisionNote}</p>}
      <label className="mt-2 block">
        <span className="btn-ghost !min-h-0 inline-block cursor-pointer !py-1.5 text-xs">{busy ? 'Uploading…' : has ? 'Replace' : 'Upload / take photo'}</span>
        <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(ev) => ev.target.files?.[0] && onFile(ev.target.files[0])} />
      </label>
      {has && <a href={`/api/v1/applicant/documents/${has.id}`} target="_blank" rel="noreferrer" className="ml-2 text-[11px] text-accent hover:underline">view</a>}
      {e && <p className="mt-1 text-[11px] text-danger">{e}</p>}
    </div>
  );
}

function IdentityStep({ app, reload }: { app: AppData; reload: () => void }) {
  const { v, setV, save } = useDraft('identity', app);
  return (
    <div className="space-y-3" onBlur={save}>
      <Field label="Full legal name (as on document)" value={v.legalName} onChange={(x) => setV({ ...v, legalName: x })} />
      <Field label="Date of birth" type="date" value={v.dateOfBirth} onChange={(x) => setV({ ...v, dateOfBirth: x })} />
      <Field label="Residential address" value={v.address} onChange={(x) => setV({ ...v, address: x })} />
      <Field label="Country of residence" value={v.country} onChange={(x) => setV({ ...v, country: x })} />
      <p className="pt-1 text-xs text-muted">Provide EITHER a passport photo page OR an ID card (front + back), plus a clear selfie. Documents are private and reviewed only by an administrator.</p>
      <Upload slot="passport" app={app} reload={reload} label="Passport (photo page) — or use ID card below" />
      <Upload slot="id_front" app={app} reload={reload} label="ID card — front" />
      <Upload slot="id_back" app={app} reload={reload} label="ID card — back" />
      <Upload slot="selfie" app={app} reload={reload} label="Selfie (current portrait)" />
    </div>
  );
}
function DrivingStep({ app, reload }: { app: AppData; reload: () => void }) {
  const { v, setV, save } = useDraft('driving', app);
  return (
    <div className="space-y-3" onBlur={save}>
      <Field label="Driving licence number" value={v.licenceNumber} onChange={(x) => setV({ ...v, licenceNumber: x })} />
      <Field label="Licence issuing country" value={v.licenceCountry} onChange={(x) => setV({ ...v, licenceCountry: x })} />
      <Field label="Licence expiry" type="date" value={v.licenceExpiry} onChange={(x) => setV({ ...v, licenceExpiry: x })} />
      <Field label="Cyprus professional taxi licence number" value={v.taxiLicenceNumber} onChange={(x) => setV({ ...v, taxiLicenceNumber: x })} />
      <Upload slot="licence_front" app={app} reload={reload} label="Driving licence — front" />
      <Upload slot="licence_back" app={app} reload={reload} label="Driving licence — back (optional)" />
      <Upload slot="taxi_licence" app={app} reload={reload} label="Professional taxi driver licence" />
    </div>
  );
}
function VehicleStep({ app, reload }: { app: AppData; reload: () => void }) {
  const { v, setV, save } = useDraft('vehicle', app);
  return (
    <div className="space-y-3" onBlur={save}>
      <Field label="Registration plate" value={v.plate} onChange={(x) => setV({ ...v, plate: x })} />
      <Field label="VIN" value={v.vin} onChange={(x) => setV({ ...v, vin: x })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Make" value={v.make} onChange={(x) => setV({ ...v, make: x })} />
        <Field label="Model" value={v.model} onChange={(x) => setV({ ...v, model: x })} />
        <Field label="Year" value={v.year} onChange={(x) => setV({ ...v, year: x })} />
        <Field label="Color" value={v.color} onChange={(x) => setV({ ...v, color: x })} />
        <Field label="Passenger seats" value={v.seats} onChange={(x) => setV({ ...v, seats: x })} />
        <div><label className="label">Service class</label>
          <select className="field mt-1" value={v.vClass || ''} onChange={(x) => setV({ ...v, vClass: x.target.value })}>
            <option value="">—</option><option value="COMFORT">COMFORT (4)</option><option value="XL">XL (6)</option>
          </select></div>
      </div>
      <Upload slot="vehicle_reg" app={app} reload={reload} label="Vehicle registration certificate" />
      <Upload slot="insurance" app={app} reload={reload} label="Insurance (commercial/taxi cover)" />
    </div>
  );
}
function PhotosStep({ app, reload }: { app: AppData; reload: () => void }) {
  const slots: [string, string][] = [['vehicle_front', 'Front + front plate'], ['vehicle_rear', 'Rear + rear plate'], ['vehicle_left', 'Left side'], ['vehicle_right', 'Right side'], ['cabin_front', 'Front cabin'], ['cabin_rear', 'Rear seats'], ['boot', 'Boot / luggage']];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Clear, current daylight photos of the same vehicle. Avoid bystanders.</p>
      {slots.map(([s, l]) => <Upload key={s} slot={s} app={app} reload={reload} label={l} />)}
    </div>
  );
}
function ReviewStep({ app, reload, setErr }: { app: AppData; reload: () => void; setErr: (s: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setErr(null);
    try { await api('/applicant/application/submit', { method: 'POST' }); reload(); }
    catch (e) { if (e instanceof ApiRequestError) setErr(e.body.message); } finally { setBusy(false); }
  }
  const uploaded = app.documents.length;
  return (
    <div className="space-y-3">
      <div className="rounded-[12px] border border-edge bg-elevated p-3 text-sm">
        <div>{app.identity.legalName || '—'} · {app.phone}</div>
        <div className="text-muted">{app.vehicle.make} {app.vehicle.model} · {app.vehicle.plate} · {app.vehicle.vClass}</div>
        <div className="mt-1 text-xs text-muted">{uploaded} documents uploaded</div>
      </div>
      <label className="flex items-start gap-2 text-xs text-muted"><input type="checkbox" id="ack" className="mt-0.5" /> I confirm this information is accurate and the documents are mine / for the authorized vehicle, and I will report relevant changes.</label>
      <button className="btn-primary w-full" disabled={busy} onClick={() => { if ((document.getElementById('ack') as HTMLInputElement)?.checked) submit(); else setErr('Please confirm the declaration.'); }}>
        {busy ? 'Submitting…' : 'Submit for review'}
      </button>
      <p className="text-center text-[11px] text-muted">After submitting you can&apos;t accept rides until an administrator approves you.</p>
    </div>
  );
}
