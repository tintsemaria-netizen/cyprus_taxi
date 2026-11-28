'use client';

// Driver profile parts (2026-11-27, operator): «Мои данные» (phone and e-mail change with a code), the emergency
// contact, payout details (IBAN), the new-order sound and «Моя надёжность». 8 languages (driver.me.*).
import { useEffect, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { formatIban } from '@/lib/iban';
import { readOfferSound, writeOfferSound, previewOfferSound, type OfferSoundPrefs } from '@/lib/driver-alerts';
import { OFFER_TONES } from '@/lib/offer-tones';

interface Profile { name: string; phone: string; email: string | null; emergencyName: string | null; emergencyPhone: string | null; iban: string | null; ibanHolder: string | null; emailEditable: boolean }

const input = 'w-full rounded-[10px] border border-edge bg-page px-3 py-2 text-sm text-ink outline-none focus:border-accent';
const smallBtn = 'rounded-full border border-edge px-3 py-1 text-xs font-semibold';

function useProfile() {
  const [p, setP] = useState<Profile | null>(null);
  useEffect(() => { api<Profile>('/driver/profile').then(setP).catch(() => {}); }, []);
  return [p, setP] as const;
}

/** One row «label · value · Изменить» that opens a two-step change with a code (phone or e-mail). */
function CodeChange({ kind, value, onDone }: { kind: 'phone' | 'email'; value: string | null; onDone: (v: string) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const reset = () => { setOpen(false); setV(''); setCode(''); setSent(false); setMsg(null); };
  const err = (e: unknown) => {
    const c = e instanceof ApiRequestError ? e.body.code : '';
    const f = e instanceof ApiRequestError ? e.body.fieldErrors ?? {} : {};
    setMsg(c === 'PHONE_TAKEN' ? t('driver.me.phoneTaken') : c === 'BAD_CODE' ? t('driver.me.badCode') : c === 'RATE_LIMITED' ? t('driver.me.tooMany')
      : f.phone === 'SAME' ? t('driver.me.same') : f.phone || f.email ? t(kind === 'phone' ? 'driver.me.badPhone' : 'driver.me.badEmail') : t('driver.me.failed'));
  };
  async function send() {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ sent: boolean; unavailable?: boolean; devCode?: string }>(`/driver/profile/${kind}`, { method: 'POST', body: { [kind]: v } });
      if (!r.sent) setMsg(t(kind === 'phone' ? 'driver.me.smsUnavailable' : 'driver.me.emailUnavailable'));
      else { setSent(true); if (r.devCode) setCode(r.devCode); }
    } catch (e) { err(e); }
    setBusy(false);
  }
  async function confirm() {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ phone?: string; email?: string }>(`/driver/profile/${kind}`, { method: 'POST', body: { [kind]: v, code } });
      onDone((kind === 'phone' ? r.phone : r.email) ?? v); reset();
    } catch (e) { err(e); }
    setBusy(false);
  }
  return (
    <div className="py-2.5" data-testid={`me-${kind}`}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted">{t(kind === 'phone' ? 'driver.me.phone' : 'driver.me.email')}</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium" dir="ltr">{value || '—'}</span>
          {!open && <button type="button" className={smallBtn} onClick={() => setOpen(true)} data-testid={`me-${kind}-change`}>{t('driver.me.change')}</button>}
        </span>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <input className={input} dir="ltr" inputMode={kind === 'phone' ? 'tel' : 'email'} autoComplete={kind === 'phone' ? 'tel' : 'email'}
            placeholder={kind === 'phone' ? '+357 99 123456' : 'name@example.com'} value={v} onChange={(e) => setV(e.target.value)} disabled={sent} />
          {sent && <input className={input} dir="ltr" inputMode="numeric" autoComplete="one-time-code" placeholder={t('driver.me.codePh')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />}
          {sent && <p className="text-xs text-muted">{t(kind === 'phone' ? 'driver.me.codeSentSms' : 'driver.me.codeSentEmail')}</p>}
          {kind === 'phone' && !sent && <p className="text-xs text-muted">{t('driver.me.phoneNote')}</p>}
          {msg && <p className="text-xs text-danger" role="alert">{msg}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-primary flex-1 py-2 text-sm" disabled={busy || !v || (sent && code.length < 4)} onClick={() => void (sent ? confirm() : send())}>
              {sent ? t('driver.me.confirm') : t('driver.me.sendCode')}
            </button>
            <button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={reset}>{t('driver.me.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** «Мои данные»: name, phone, e-mail. */
export function MyDataSection() {
  const { t } = useT();
  const [p, setP] = useProfile();
  if (!p) return <p className="text-sm text-muted">…</p>;
  return (
    <div className="divide-y divide-edge" data-testid="me-data">
      <div className="flex items-center justify-between gap-3 pb-2.5 text-sm">
        <span className="text-muted">{t('driver.me.name')}</span>
        <span className="font-medium">{p.name}</span>
      </div>
      <CodeChange kind="phone" value={p.phone} onDone={(phone) => setP({ ...p, phone })} />
      {p.emailEditable && <CodeChange kind="email" value={p.email} onDone={(email) => setP({ ...p, email })} />}
      <EmergencyAndPayout p={p} setP={setP} />
    </div>
  );
}

/** Emergency contact and payout details (IBAN) — plain fields, saved with one button each. */
function EmergencyAndPayout({ p, setP }: { p: Profile; setP: (p: Profile) => void }) {
  const { t } = useT();
  const [em, setEm] = useState({ name: p.emergencyName ?? '', phone: p.emergencyPhone ?? '' });
  const [pay, setPay] = useState({ iban: p.iban ? formatIban(p.iban) : '', holder: p.ibanHolder ?? '' });
  const [state, setState] = useState<{ which: 'em' | 'pay'; ok: boolean; text: string } | null>(null);
  async function save(which: 'em' | 'pay') {
    setState(null);
    const body = which === 'em' ? { emergencyName: em.name, emergencyPhone: em.phone } : { iban: pay.iban, ibanHolder: pay.holder };
    try {
      const r = await api<Profile>('/driver/profile', { method: 'PATCH', body });
      setP(r); setState({ which, ok: true, text: t('driver.me.saved') });
      if (which === 'pay' && r.iban) setPay({ iban: formatIban(r.iban), holder: r.ibanHolder ?? '' });
    } catch (e) {
      const f = e instanceof ApiRequestError ? e.body.fieldErrors ?? {} : {};
      setState({ which, ok: false, text: f.iban ? t('driver.me.badIban') : f.emergencyPhone ? t('driver.me.badPhone') : t('driver.me.failed') });
    }
  }
  const note = (w: 'em' | 'pay') => state?.which === w && <p className={`text-xs ${state.ok ? 'text-accent' : 'text-danger'}`} role="status">{state.text}</p>;
  return (
    <>
      <div className="space-y-2 py-3" data-testid="me-emergency">
        <div className="text-sm font-semibold">{t('driver.me.emergency')}</div>
        <p className="text-xs text-muted">{t('driver.me.emergencyHint')}</p>
        <input className={input} placeholder={t('driver.me.emergencyName')} value={em.name} onChange={(e) => setEm({ ...em, name: e.target.value })} />
        <input className={input} dir="ltr" inputMode="tel" placeholder="+357 99 123456" value={em.phone} onChange={(e) => setEm({ ...em, phone: e.target.value })} />
        {note('em')}
        <button type="button" className={smallBtn} onClick={() => void save('em')}>{t('driver.me.save')}</button>
      </div>
      <div className="space-y-2 pt-3" data-testid="me-payout">
        <div className="text-sm font-semibold">{t('driver.me.payout')}</div>
        <p className="text-xs text-muted">{t('driver.me.payoutHint')}</p>
        <input className={`${input} font-mono`} dir="ltr" autoCapitalize="characters" placeholder="CY17 0020 0128 0000 0012 0052 7600" value={pay.iban} onChange={(e) => setPay({ ...pay, iban: e.target.value })} />
        <input className={input} placeholder={t('driver.me.payoutHolder')} value={pay.holder} onChange={(e) => setPay({ ...pay, holder: e.target.value })} />
        {note('pay')}
        <button type="button" className={smallBtn} onClick={() => void save('pay')}>{t('driver.me.save')}</button>
      </div>
    </>
  );
}

/** «Звук нового заказа»: tone, volume, vibration, «Прослушать». On this phone. */
export function OrderSoundSetting() {
  const { t } = useT();
  const [p, setP] = useState<OfferSoundPrefs | null>(null);
  useEffect(() => { setP(readOfferSound()); }, []);
  if (!p) return null;
  const save = (n: OfferSoundPrefs) => { setP(n); writeOfferSound(n); };
  return (
    <div className="space-y-3" data-testid="order-sound">
      <div className="text-sm">{t('driver.me.sound')}</div>
      <div className="grid grid-cols-3 gap-2">
        {OFFER_TONES.map((k) => (
          <button key={k} type="button" onClick={() => { const n = { ...p, tone: k }; save(n); previewOfferSound(n); }} data-testid={`tone-${k}`}
            className={`rounded-full border px-2 py-1.5 text-xs font-semibold ${p.tone === k ? 'border-accent bg-accent/15 text-accent' : 'border-edge text-muted'}`}>
            {t(`driver.me.tone.${k}` as 'driver.me.tone.chime')}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3 text-xs text-muted">
        <span className="w-20 shrink-0">{t('driver.me.volume')}</span>
        <input type="range" min={0} max={100} step={10} value={Math.round(p.volume * 100)} onChange={(e) => save({ ...p, volume: Number(e.target.value) / 100 })} className="flex-1 accent-[#C8FF46]" data-testid="sound-volume" />
        <span className="w-9 text-end tabular-nums">{Math.round(p.volume * 100)}%</span>
      </label>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{t('driver.me.vibrate')}</span>
        <button type="button" role="switch" aria-checked={p.vibrate} onClick={() => save({ ...p, vibrate: !p.vibrate })} data-testid="sound-vibrate"
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${p.vibrate ? 'bg-accent' : 'bg-edge-strong'}`}>
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${p.vibrate ? 'start-[22px]' : 'start-0.5'}`} />
        </button>
      </div>
      <button type="button" className={smallBtn} onClick={() => previewOfferSound(p)} data-testid="sound-preview">▶ {t('driver.me.preview')}</button>
    </div>
  );
}

interface Rel {
  days: number;
  offers: { total: number; accepted: number; missed: number; acceptancePct: number | null; missedPct: number | null };
  trips: { completed: number; preCancels: number };
  prebook: { taken: number; lateReleases: number };
  rating: { average: number | null; count: number };
  flags: string[];
  rules: { lowAcceptance: { minOffers: number; belowPct: number }; missedOffers: { abovePct: number }; lateReleases: { atLeast: number }; lowRating: { minRatings: number; below: number }; preCancels: { atLeast: number } };
}

/** «Рейтинг и надёжность»: the same 30-day figures and limits for the driver, the admin's and the fleet owner's
 *  driver card (one server function, one component). `path`: the API; `staff`: wording for the admin / fleet owner. */
export function ReliabilityCard({ path = '/driver/reliability', staff = false }: { path?: string; staff?: boolean } = {}) {
  const { t } = useT();
  const [r, setR] = useState<Rel | null>(null);
  useEffect(() => { api<Rel>(path).then(setR).catch(() => {}); }, [path]);
  if (!r) return <p className="text-sm text-muted">…</p>;
  const R = r.rules;
  const row = (label: string, value: string, bad: boolean, hint: string, id: string) => (
    <div className="py-2.5" data-testid={`rel-${id}`}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className={`font-semibold tabular-nums ${bad ? 'text-danger' : 'text-accent'}`}>{value}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  );
  const pct = (n: number | null) => (n == null ? '—' : `${n}%`);
  return (
    <div data-testid="reliability">
      <p className="pb-1 text-xs text-muted">{t(staff ? 'driver.me.relPeriodStaff' : 'driver.me.relPeriod', { days: r.days })}</p>
      <div className="divide-y divide-edge">
        {row(t('driver.me.relAccepted'), r.offers.total ? `${r.offers.accepted}/${r.offers.total} · ${pct(r.offers.acceptancePct)}` : '—', r.flags.includes('LOW_ACCEPTANCE'), t('driver.me.relAcceptedHint', { pct: R.lowAcceptance.belowPct, n: R.lowAcceptance.minOffers }), 'accepted')}
        {row(t('driver.me.relMissed'), r.offers.total ? `${r.offers.missed} · ${pct(r.offers.missedPct)}` : '—', r.flags.includes('MISSED_OFFERS'), t(staff ? 'driver.me.relMissedHintStaff' : 'driver.me.relMissedHint', { pct: R.missedOffers.abovePct }), 'missed')}
        {row(t('driver.me.relPreCancels'), String(r.trips.preCancels), r.flags.includes('PRE_PICKUP_CANCELS'), t('driver.me.relPreCancelsHint', { n: R.preCancels.atLeast }), 'precancels')}
        {row(t('driver.me.relLate'), String(r.prebook.lateReleases), r.flags.includes('LATE_RELEASES'), t('driver.me.relLateHint', { n: R.lateReleases.atLeast }), 'late')}
        {row(t('driver.me.relRating'), r.rating.average != null ? `★ ${r.rating.average.toFixed(1)} · ${r.rating.count}` : '—', r.flags.includes('LOW_RATING'), t('driver.me.relRatingHint', { min: R.lowRating.below.toFixed(1), n: R.lowRating.minRatings }), 'rating')}
      </div>
      <p className={`mt-2 rounded-[10px] px-3 py-2 text-xs ${r.flags.length ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`} data-testid="rel-summary">
        {r.flags.length ? t(staff ? 'driver.me.relAttentionStaff' : 'driver.me.relAttention') : t(staff ? 'driver.me.relGoodStaff' : 'driver.me.relGood')}
      </p>
    </div>
  );
}
