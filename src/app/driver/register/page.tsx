'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Logo } from '@/components/Brand';
import { compressImageForUpload, UPLOAD_TARGET_BYTES } from '@/lib/image-compress';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

export const dynamic = 'force-dynamic';

interface AppDoc { id: string; slot: string; decision: string; decisionNote: string | null; mime: string }
interface AppData {
  status: string; revision: number; decisionReason: string | null; phone: string;
  identity: Record<string, string>; driving: Record<string, string>; vehicle: Record<string, string>;
  documents: AppDoc[];
}

const STEPS = ['identity', 'driving', 'vehicle', 'photos', 'review'] as const;

export default function Register() {
  const { t } = useT();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [app, setApp] = useState<AppData | null>(null);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const a = await api<AppData>('/applicant/application'); setApp(a); setAuthed(true); }
    catch (e) { if (e instanceof ApiRequestError && e.status === 401) setAuthed(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (authed === null) return <Centered>{t('driverReg.loading')}</Centered>;
  if (!authed) return <PhoneGate onDone={load} />;
  if (!app) return <Centered>{t('driverReg.loadingApplication')}</Centered>;

  if (app.status === 'SUBMITTED' || app.status === 'IN_REVIEW') return <StatusCard app={app} title={t('driverReg.status.underReviewTitle')} body={t('driverReg.status.underReviewBody')} />;
  if (app.status === 'APPROVED') return <StatusCard app={app} title={t('driverReg.status.approvedTitle')} body={t('driverReg.status.approvedBody')} cta={{ href: '/driver/login', label: t('driverReg.status.driverSignIn') }} />;
  if (app.status === 'REJECTED') return <StatusCard app={app} title={t('driverReg.status.rejectedTitle')} body={app.decisionReason || t('driverReg.status.contactSupport')} />;

  // DRAFT or CHANGES_REQUESTED → wizard
  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between"><Logo className="h-8" /><div className="flex items-center gap-2"><LanguageSwitcher /><LogoutBtn /></div></div>
      {app.status === 'CHANGES_REQUESTED' && app.decisionReason && (
        <p className="mb-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{t('driverReg.changesRequested', { reason: app.decisionReason })}</p>
      )}
      <ol className="mb-4 flex gap-1 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex-1 rounded-full px-2 py-1 text-center ${i === step ? 'bg-accent text-[#10191C] font-semibold' : i < step ? 'bg-elevated text-accent' : 'bg-elevated text-muted'}`}>{t(`driverReg.steps.${s}`)}</li>
        ))}
      </ol>
      {err && <p className="mb-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}

      {step === 0 && <IdentityStep app={app} reload={load} />}
      {step === 1 && <DrivingStep app={app} reload={load} />}
      {step === 2 && <VehicleStep app={app} reload={load} />}
      {step === 3 && <PhotosStep app={app} reload={load} />}
      {step === 4 && <ReviewStep app={app} reload={load} setErr={setErr} />}

      <div className="mt-5 flex justify-between">
        <button className="btn-ghost !min-h-0 !py-2 text-sm" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>{t('common.back')}</button>
        {step < STEPS.length - 1 && <button className="btn-primary !min-h-0 !py-2 text-sm" onClick={() => setStep((s) => s + 1)}>{t('driverReg.next')}</button>}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[100dvh] items-center justify-center px-4 text-muted">{children}</div>;
}

function LogoutBtn() {
  const { t } = useT();
  return <button className="text-xs text-muted hover:text-ink" onClick={async () => { await api('/applicant/logout', { method: 'POST' }); location.reload(); }}>{t('driverReg.signOut')}</button>;
}

function StatusCard({ app, title, body, cta }: { app: AppData; title: string; body: string; cta?: { href: string; label: string } }) {
  const { t } = useT();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6 text-center">
        <div className="mb-4 flex justify-end"><LanguageSwitcher /></div>
        <Logo className="mb-4 h-8 justify-center" />
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="mt-2 text-sm text-muted">{body}</p>
        <p className="mt-2 text-xs text-muted">{t('driverReg.status.ref', { phone: app.phone })}</p>
        {cta && <a href={cta.href} className="btn-primary mt-4 w-full">{cta.label}</a>}
        <a href="/" className="mt-3 block text-sm text-muted hover:text-ink">{t('driverReg.status.backToBooking')}</a>
      </div>
    </div>
  );
}

// ---- Phone OTP gate ----
function PhoneGate({ onDone }: { onDone: () => void }) {
  const { t, tError } = useT();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [dev, setDev] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devBefore, devAfter] = t('driverReg.phone.devCode', { code: '\u0000' }).split('\u0000');
  async function req() { setBusy(true); setErr(null); try { const r = await api<{ sent: boolean; devCode?: string }>('/applicant/otp/request', { method: 'POST', body: { phone } }); if (!r.sent) { setErr(t('driverReg.phone.smsUnavailable')); return; } setDev(r.devCode ?? null); setStage('code'); } catch (e) { if (e instanceof ApiRequestError) setErr(tError(e)); } finally { setBusy(false); } }
  async function ver() { setBusy(true); setErr(null); try { await api('/applicant/otp/verify', { method: 'POST', body: { phone, code } }); onDone(); } catch (e) { if (e instanceof ApiRequestError) setErr(tError(e)); } finally { setBusy(false); } }
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="flex items-center justify-between gap-2"><a href="/" className="inline-block"><Logo /></a><LanguageSwitcher /></div>
        <h1 className="mt-6 text-xl font-bold">{t('driverReg.phone.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('driverReg.phone.intro')}</p>
        {err && <p className="mt-4 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
        {stage === 'phone' ? (
          <div className="mt-4 space-y-3">
            <div><label className="label" htmlFor="register-f1">{t('driverReg.phone.label')}</label><input id="register-f1" className="field mt-1" placeholder="+35799123456" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></div>
            <button className="btn-primary w-full" disabled={busy || !phone} onClick={req}>{busy ? t('driverReg.phone.sending') : t('driverReg.phone.sendCode')}</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {dev && <p className="rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{devBefore}<b>{dev}</b>{devAfter}</p>}
            <input className="field text-center font-mono text-lg tracking-widest" inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <button className="btn-primary w-full" disabled={busy || code.length < 4} onClick={ver}>{busy ? t('driverReg.phone.verifying') : t('driverReg.phone.verify')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- shared field + upload helpers ----
function useDraft(section: 'identity' | 'driving' | 'vehicle', app: AppData) {
  const [v, setV] = useState<Record<string, string>>(app[section]);
  const [saved, setSaved] = useState(true);
  const save = async () => { try { await api('/applicant/application', { method: 'PATCH', body: { [section]: v } }); setSaved(true); } catch { /* retried by next change */ } };
  // Debounced autosave so a refresh/close never loses progress.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSaved(false);
    const t = setTimeout(save, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return { v, setV, save, saved };
}
function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (s: string) => void; type?: string }) {
  const id = useId();
  return <div><label className="label" htmlFor={id}>{label}</label><input id={id} type={type} className="field mt-1" value={value || ''} onChange={(e) => onChange(e.target.value)} onBlur={() => { /* saved by step */ }} /></div>;
}
function Upload({ slot, app, reload, label }: { slot: string; app: AppData; reload: () => void; label: string }) {
  const { t, tError } = useT();
  const [busy, setBusy] = useState(false);
  const [e, setE] = useState<string | null>(null);
  const has = app.documents.find((d) => d.slot === slot);
  async function onFile(file: File) {
    setBusy(true); setE(null);
    try {
      const body = await compressImageForUpload(file);
      if (body.size > UPLOAD_TARGET_BYTES) {
        setE(file.type === 'application/pdf' ? t('driverReg.upload.pdfTooLarge') : t('driverReg.upload.fileTooLarge'));
        return;
      }
      const res = await fetch(`/api/v1/applicant/application/documents?slot=${slot}`, { method: 'POST', body, credentials: 'same-origin' });
      if (res.status === 413) { setE(t('driverReg.upload.tooLarge')); return; }
      if (!res.ok) { const j = await res.json().catch(() => ({})); const ae = j?.error; setE((ae?.code && ae.code !== 'VALIDATION' ? tError(new ApiRequestError(res.status, ae)) : null) || ae?.message || ae?.fieldErrors?.file || t('driverReg.upload.failed')); return; }
      reload();
    } catch { setE(t('driverReg.upload.failedRetry')); } finally { setBusy(false); }
  }
  return (
    <div className="rounded-[12px] border border-edge bg-elevated p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm">{label}</span>
        {has ? <span className={`chip ${has.decision === 'ACCEPTED' ? '!text-accent' : has.decision === 'CHANGES' ? '!text-danger' : ''}`}>{has.decision === 'CHANGES' ? t('driverReg.upload.redo') : has.decision === 'ACCEPTED' ? '✓' : t('driverReg.upload.uploaded')}</span> : <span className="text-xs text-muted">{t('driverReg.upload.required')}</span>}
      </div>
      {has?.decisionNote && <p className="mt-1 text-xs text-danger">{has.decisionNote}</p>}
      <label className="mt-2 block">
        <span className="btn-ghost !min-h-0 inline-block cursor-pointer !py-1.5 text-xs">{busy ? t('driverReg.upload.uploading') : has ? t('driverReg.upload.replace') : t('driverReg.upload.uploadOrPhoto')}</span>
        <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(ev) => ev.target.files?.[0] && onFile(ev.target.files[0])} />
      </label>
      {has && <a href={`/api/v1/applicant/documents/${has.id}`} target="_blank" rel="noreferrer" className="ml-2 text-xs text-accent hover:underline">{t('driverReg.upload.view')}</a>}
      {e && <p className="mt-1 text-xs text-danger">{e}</p>}
    </div>
  );
}

function IdentityStep({ app, reload }: { app: AppData; reload: () => void }) {
  const { t } = useT();
  const { v, setV, save } = useDraft('identity', app);
  return (
    <div className="space-y-3" onBlur={save}>
      <Field label={t('driverReg.identity.legalName')} value={v.legalName} onChange={(x) => setV({ ...v, legalName: x })} />
      <Field label={t('driverReg.identity.dateOfBirth')} type="date" value={v.dateOfBirth} onChange={(x) => setV({ ...v, dateOfBirth: x })} />
      <Field label={t('driverReg.identity.address')} value={v.address} onChange={(x) => setV({ ...v, address: x })} />
      <Field label={t('driverReg.identity.country')} value={v.country} onChange={(x) => setV({ ...v, country: x })} />
      <p className="pt-1 text-xs text-muted">{t('driverReg.identity.docsHint')}</p>
      <Upload slot="passport" app={app} reload={reload} label={t('driverReg.identity.passport')} />
      <Upload slot="id_front" app={app} reload={reload} label={t('driverReg.identity.idFront')} />
      <Upload slot="id_back" app={app} reload={reload} label={t('driverReg.identity.idBack')} />
      <Upload slot="selfie" app={app} reload={reload} label={t('driverReg.identity.selfie')} />
      <p className="pt-1 text-xs text-muted">{t('driverReg.identity.rightToWorkHint')}</p>
      <Upload slot="right_to_work" app={app} reload={reload} label={t('driverReg.identity.rightToWork')} />
    </div>
  );
}
function DrivingStep({ app, reload }: { app: AppData; reload: () => void }) {
  const { t } = useT();
  const { v, setV, save } = useDraft('driving', app);
  return (
    <div className="space-y-3" onBlur={save}>
      <Field label={t('driverReg.driving.licenceNumber')} value={v.licenceNumber} onChange={(x) => setV({ ...v, licenceNumber: x })} />
      <Field label={t('driverReg.driving.licenceCountry')} value={v.licenceCountry} onChange={(x) => setV({ ...v, licenceCountry: x })} />
      <Field label={t('driverReg.driving.licenceExpiry')} type="date" value={v.licenceExpiry} onChange={(x) => setV({ ...v, licenceExpiry: x })} />
      <Field label={t('driverReg.driving.taxiLicenceNumber')} value={v.taxiLicenceNumber} onChange={(x) => setV({ ...v, taxiLicenceNumber: x })} />
      <Upload slot="licence_front" app={app} reload={reload} label={t('driverReg.driving.licenceFront')} />
      <Upload slot="licence_back" app={app} reload={reload} label={t('driverReg.driving.licenceBack')} />
      <Upload slot="taxi_licence" app={app} reload={reload} label={t('driverReg.driving.taxiLicence')} />
    </div>
  );
}
function VehicleStep({ app, reload }: { app: AppData; reload: () => void }) {
  const { t } = useT();
  const { v, setV, save } = useDraft('vehicle', app);
  return (
    <div className="space-y-3" onBlur={save}>
      <Field label={t('driverReg.vehicle.plate')} value={v.plate} onChange={(x) => setV({ ...v, plate: x })} />
      <Field label={t('driverReg.vehicle.vin')} value={v.vin} onChange={(x) => setV({ ...v, vin: x })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('driverReg.vehicle.make')} value={v.make} onChange={(x) => setV({ ...v, make: x })} />
        <Field label={t('driverReg.vehicle.model')} value={v.model} onChange={(x) => setV({ ...v, model: x })} />
        <Field label={t('driverReg.vehicle.year')} value={v.year} onChange={(x) => setV({ ...v, year: x })} />
        <Field label={t('driverReg.vehicle.color')} value={v.color} onChange={(x) => setV({ ...v, color: x })} />
        <Field label={t('driverReg.vehicle.seats')} value={v.seats} onChange={(x) => setV({ ...v, seats: x })} />
        <div><label className="label" htmlFor="register-f3">{t('driverReg.vehicle.serviceClass')}</label>
          <select id="register-f3" className="field mt-1" value={v.vClass || ''} onChange={(x) => setV({ ...v, vClass: x.target.value })}>
            <option value="">—</option><option value="COMFORT">{t('driverReg.vehicle.classOption', { name: t('common.vClass.COMFORT'), seats: 4 })}</option><option value="XL">{t('driverReg.vehicle.classOption', { name: t('common.vClass.XL'), seats: 6 })}</option>
          </select></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('driverReg.vehicle.registrationCountry')} value={v.registrationCountry} onChange={(x) => setV({ ...v, registrationCountry: x })} />
        <Field label={t('driverReg.vehicle.operatingArea')} value={v.operatingArea} onChange={(x) => setV({ ...v, operatingArea: x })} />
      </div>
      <Upload slot="vehicle_reg" app={app} reload={reload} label={t('driverReg.vehicle.registration')} />
      <Upload slot="insurance" app={app} reload={reload} label={t('driverReg.vehicle.insurance')} />
      <Upload slot="roadworthiness" app={app} reload={reload} label={t('driverReg.vehicle.roadworthiness')} />
      <Upload slot="fleet_authorization" app={app} reload={reload} label={t('driverReg.vehicle.fleetAuthorization')} />
    </div>
  );
}
function PhotosStep({ app, reload }: { app: AppData; reload: () => void }) {
  const { t } = useT();
  const slots = ['vehicle_front', 'vehicle_rear', 'vehicle_left', 'vehicle_right', 'cabin_front', 'cabin_rear', 'boot', 'taxi_sign'] as const;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{t('driverReg.photos.hint')}</p>
      {slots.map((s) => <Upload key={s} slot={s} app={app} reload={reload} label={t(`driverReg.photos.slots.${s}`)} />)}
    </div>
  );
}
function ReviewStep({ app, reload, setErr }: { app: AppData; reload: () => void; setErr: (s: string | null) => void }) {
  const { t, tp, tError } = useT();
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setErr(null);
    try { await api('/applicant/application/submit', { method: 'POST' }); reload(); }
    catch (e) { if (e instanceof ApiRequestError) setErr(tError(e)); } finally { setBusy(false); }
  }
  const uploaded = app.documents.length;
  return (
    <div className="space-y-3">
      <div className="rounded-[12px] border border-edge bg-elevated p-3 text-sm">
        <div>{app.identity.legalName || '—'} · {app.phone}</div>
        <div className="text-muted">{app.vehicle.make} {app.vehicle.model} · {app.vehicle.plate} · {app.vehicle.vClass}</div>
        <div className="mt-1 text-xs text-muted">{tp('driverReg.review.documentsUploaded', uploaded)}</div>
      </div>
      <label className="flex items-start gap-2 text-xs text-muted"><input type="checkbox" id="ack" className="mt-0.5" /> {t('driverReg.review.declaration')}</label>
      <button className="btn-primary w-full" disabled={busy} onClick={() => { if ((document.getElementById('ack') as HTMLInputElement)?.checked) submit(); else setErr(t('driverReg.review.confirmDeclaration')); }}>
        {busy ? t('driverReg.review.submitting') : t('driverReg.review.submit')}
      </button>
      <p className="text-center text-xs text-muted">{t('driverReg.review.afterSubmit')}</p>
    </div>
  );
}
