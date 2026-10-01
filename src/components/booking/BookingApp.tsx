'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { Logo } from '@/components/Brand';
import { PlacesInput, Selected } from './PlacesInput';
import { DemoBanner } from '@/components/DemoBanner';
import AutoMapPicker from './AutoMapPicker';
import { PassengerLoginModal } from './PassengerLoginModal';
import { AccountMenu } from './AccountMenu';
import { nicosiaInputValue } from '@/lib/timezone';
import { api, ApiRequestError, uuid } from '@/lib/api-client';
import { useT, MsgKey, translate } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';
import { INTL_TAG } from '@/i18n/config';

interface PublicConfig {
  demoMode: boolean;
  timezone: string;
  classes: { key: 'COMFORT' | 'XL'; label: string; maxPassengers: number }[];
  schedule: { minMinutes: number; maxDays: number };
  operatorName: string | null;
}

const CLASS_META: Record<string, { seatsLabel: MsgKey; blurb: MsgKey }> = {
  COMFORT: { seatsLabel: 'booking.classes.COMFORT.seats', blurb: 'booking.classes.COMFORT.blurb' },
  XL: { seatsLabel: 'booking.classes.XL.seats', blurb: 'booking.classes.XL.blurb' },
};

// Render a translated sentence with one `{slot}` replaced by a React node (keeps styled
// values inside a single translatable string, since word order differs between languages).
function withSlot(template: string, slot: string, node: React.ReactNode): React.ReactNode {
  const [before, after = ''] = template.split(`{${slot}}`);
  return <>{before}{node}{after}</>;
}

export default function BookingApp() {
  const router = useRouter();
  const { t, tp, fmt, tError, locale } = useT();
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [pickup, setPickup] = useState<Selected | null>(null);
  const [pickupText, setPickupText] = useState('');
  const [dropoff, setDropoff] = useState<Selected | null>(null);
  const [dropoffText, setDropoffText] = useState('');
  const [when, setWhen] = useState<'NOW' | 'SCHEDULE'>('NOW');
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduleOffsetMin, setScheduleOffsetMin] = useState<number | undefined>(undefined);
  const [ambiguous, setAmbiguous] = useState<string[] | null>(null);
  const [vClass, setVClass] = useState<'COMFORT' | 'XL'>('COMFORT');
  const [pax, setPax] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  // One-time notice handed over by another page (e.g. "Your account has been deleted").
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    try { const f = sessionStorage.getItem('il-y-flash'); if (f) { setFlash(f); sessionStorage.removeItem('il-y-flash'); } } catch { /* storage blocked */ }
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [picker, setPicker] = useState<'pickup' | 'dropoff' | null>(null);
  // Passenger's detected location (for centring the map + defaulting the pickup).
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [autoPickup, setAutoPickup] = useState(false); // pickup was auto-set from geolocation
  // Task 014: passenger account + mandatory login before booking + destination history.
  const [passenger, setPassenger] = useState<{ phone: string; name?: string; email?: string | null } | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [destinations, setDestinations] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [places, setPlaces] = useState<{ home: { label: string; lat: number; lng: number } | null; work: { label: string; lat: number; lng: number } | null }>({ home: null, work: null });
  const pendingSubmit = useRef<number | undefined>(undefined);
  const pendingSubmitActive = useRef(false);
  const pendingReview = useRef(false);

  // Live mirrors so the async geolocation callback never overwrites a pickup the
  // passenger has already started choosing (typed text or picked a point).
  const pickupRef = useRef<Selected | null>(pickup);
  pickupRef.current = pickup;
  const pickupTextRef = useRef<string>(pickupText);
  pickupTextRef.current = pickupText;

  // Idempotency key persists across retries of the SAME payload; it is only
  // regenerated when the meaningful payload changes (SPEC §3.7).
  const idemKey = useRef<string>('');
  const idemPayloadSig = useRef<string>('');

  const [cfgError, setCfgError] = useState(false);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [scheduleTick, setScheduleTick] = useState(0);

  const loadConfig = useCallback(() => {
    setCfgLoading(true);
    setCfgError(false);
    api<PublicConfig>('/public/config', { timeoutMs: 8000 })
      .then((c) => { setCfg(c); setCfgError(false); })
      .catch(() => setCfgError(true))
      .finally(() => setCfgLoading(false));
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // Restore passenger session (if any) → prefill contact + load destination history.
  const loadPassenger = useCallback(() => {
    api<{ phone: string; name?: string; email?: string | null }>('/passenger/me')
      .then((p) => {
        setPassenger(p);
        setPhone((cur) => cur || p.phone);
        if (p.name) setName((cur) => cur || p.name!);
        api<{ destinations: { label: string; lat: number; lng: number }[] }>('/passenger/destinations').then((d) => setDestinations(d.destinations)).catch(() => {});
        api<{ home: { label: string; lat: number; lng: number } | null; work: { label: string; lat: number; lng: number } | null }>('/passenger/places').then(setPlaces).catch(() => {});
      })
      .catch(() => { setPassenger(null); setPlaces({ home: null, work: null }); });
  }, []);
  useEffect(() => { loadPassenger(); }, [loadPassenger]);

  // On first load, detect the passenger's position: centre the map on it and default the
  // pickup there (reverse-geocoded label). Never overwrite a pickup the passenger has
  // already started choosing — they can still change it via the map or the address box.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (cancelled) return;
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        setMyLoc({ lat, lng });
        if (pickupRef.current || pickupTextRef.current.trim() !== '') return; // passenger already acting
        // The stored label travels with the booking to the driver → language-neutral English; the
        // passenger sees their own language in the field.
        let label: string | null = null;
        try {
          const r = await api<{ place: { label: string } | null }>(`/places/reverse?lat=${lat}&lng=${lng}`, { timeoutMs: 6000 });
          if (r.place?.label) label = r.place.label;
        } catch { /* keep the generic label */ }
        if (cancelled || pickupRef.current || pickupTextRef.current.trim() !== '') return; // re-check after await
        setPickup({ lat, lng, label: label ?? translate('en', 'booking.currentLocation') });
        setPickupText(label ?? t('booking.currentLocation'));
        setAutoPickup(true);
      },
      () => { /* denied / unavailable → keep the island view + manual selection */ },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the schedule minimum fresh (in Cyprus wall time) while scheduling is open.
  useEffect(() => {
    if (when !== 'SCHEDULE') return;
    const t = setInterval(() => setScheduleTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [when]);

  // Fit the overview map into the VISIBLE area (clear of the bottom sheet on mobile /
  // the left panel on desktop) so it never frames empty sea behind the form.
  const [vp, setVp] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const upd = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    upd();
    window.addEventListener('resize', upd);
    window.addEventListener('orientationchange', upd);
    return () => { window.removeEventListener('resize', upd); window.removeEventListener('orientationchange', upd); };
  }, []);
  // Live on-duty cars shown on the booking map (anonymized positions), polled.
  const [fleet, setFleet] = useState<{ lat: number; lng: number; stale?: boolean; state?: 'available' | 'busy' }[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      api<{ vehicles: { lat: number; lng: number; stale?: boolean; state?: 'available' | 'busy' }[] }>('/public/fleet', { timeoutMs: 8000 })
        .then((r) => { if (alive) setFleet(r.vehicles); })
        .catch(() => { /* keep last known; transient */ });
    };
    load();
    const t = setInterval(load, 12000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const fitPadding = useMemo(
    () => (vp.w < 640
      // Mobile: the booking sheet covers most of the screen, so fit the island into
      // the small visible band at the top (large bottom padding).
      ? { top: 16, right: 24, bottom: Math.round(vp.h * 0.62), left: 24 }
      : { top: 40, right: 60, bottom: 40, left: 420 }),
    [vp],
  );

  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    if (pickup) m.push({ id: 'p', lat: pickup.lat, lng: pickup.lng, kind: 'pickup', label: pickup.label });
    if (dropoff) m.push({ id: 'd', lat: dropoff.lat, lng: dropoff.lng, kind: 'dropoff', label: dropoff.label });
    return m;
  }, [pickup, dropoff]);

  // Real driving route (distance + trip duration + geometry) between the two stops.
  // Debounced, aborted on change, stale-guarded — NOT recomputed on every render.
  const [route, setRoute] = useState<{ line: [number, number][]; km: number | null; min: number | null; unavailable?: boolean } | null>(null);
  useEffect(() => {
    if (!pickup || !dropoff) { setRoute(null); return; }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await api<{ available?: boolean; path?: [number, number][]; distanceKm?: number; etaMinutes?: number; reason?: string }>(
          '/routes/estimate',
          { method: 'POST', body: { from: { lat: pickup.lat, lng: pickup.lng }, to: { lat: dropoff.lat, lng: dropoff.lng } }, signal: controller.signal, timeoutMs: 9000 },
        );
        if (r.available === false) { setRoute({ line: [], km: null, min: null, unavailable: true }); return; }
        setRoute({
          line: (r.path ?? []).map(([lat, lng]) => [lng, lat] as [number, number]),
          km: r.distanceKm ?? null,
          min: r.etaMinutes ?? null,
        });
      } catch {
        setRoute(null); // transient/cancelled — clear stale geometry, keep the form
      }
    }, 400);
    return () => { clearTimeout(t); controller.abort(); };
  }, [pickup, dropoff]);

  // Fare estimate (server-issued quote) — recomputed when the trip inputs change.
  interface QuoteBody { quoteId: string; priceType: string; totalCents: number; rangeLowCents: number; rangeHighCents: number; night: boolean; holiday: boolean; routeAvailable: boolean; airport?: boolean; lines: { code: string; label: string; cents: number }[]; }
  // Every class is quoted in parallel so the passenger can compare prices before choosing
  // (2026-10-01 audit). `quote` is the selected class's quote (used for booking + review).
  const [quotes, setQuotes] = useState<Partial<Record<'COMFORT' | 'XL', QuoteBody>>>({});
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const classKeys = (cfg?.classes ?? [{ key: 'COMFORT' as const, maxPassengers: 4 }, { key: 'XL' as const, maxPassengers: 6 }]).map((c) => `${c.key}:${c.maxPassengers}`).join(',');
  useEffect(() => {
    if (!pickup || !dropoff) { setQuotes({}); setQuoteErr(null); return; }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setQuoteErr(null); setQuoting(true);
      const list = classKeys.split(',').map((k) => { const [key, max] = k.split(':'); return { key: key as 'COMFORT' | 'XL', max: Number(max) }; });
      const results = await Promise.all(list.map(async (c) => {
        try {
          const q = await api<QuoteBody>('/quote', {
            method: 'POST',
            body: {
              pickup: { lat: pickup.lat, lng: pickup.lng }, dropoff: { lat: dropoff.lat, lng: dropoff.lng }, vClass: c.key, passengerCount: Math.min(pax, c.max), luggageCount: 0,
              // Price a scheduled ride for its journey time (day/night/holiday + traffic).
              ...(when === 'SCHEDULE' && scheduledAt ? { scheduledAt, scheduleOffsetMin } : {}),
            },
            signal: controller.signal, timeoutMs: 9000,
          });
          return [c.key, q] as const;
        } catch (e) {
          if (e instanceof ApiRequestError) setQuoteErr(tError(e));
          return [c.key, null] as const;
        }
      }));
      if (controller.signal.aborted) return;
      const next: Partial<Record<'COMFORT' | 'XL', QuoteBody>> = {};
      for (const [k, q] of results) if (q) next[k] = q;
      setQuotes(next); setQuoting(false);
    }, 500);
    return () => { clearTimeout(t); controller.abort(); };
  }, [pickup, dropoff, pax, when, scheduledAt, scheduleOffsetMin, classKeys, tError]);
  const quote: QuoteBody | null = quotes[vClass] ?? null;
  const eur = (c: number) => fmt.money(c, 'EUR');

  const maxPax = cfg?.classes.find((c) => c.key === vClass)?.maxPassengers ?? (vClass === 'XL' ? 6 : 4);

  function payloadSignature(offset = scheduleOffsetMin): string {
    return JSON.stringify({ pickup, dropoff, when, scheduledAt, scheduleOffsetMin: offset, vClass, pax, name: name.trim(), phone: phone.trim(), note: note.trim() });
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!pickup) e.pickup = t('booking.validation.pickup');
    if (!dropoff) e.dropoff = t('booking.validation.dropoff');
    if (passenger && !name.trim()) e.name = t('booking.validation.name');
    if (when === 'SCHEDULE' && !scheduledAt) e.scheduledAt = t('booking.validation.scheduledAt');
    if (pax < 1 || pax > maxPax) e.pax = tp('booking.validation.paxRange', maxPax);
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // Resume "Request a ride" once sign-in completes (runs with the fresh `passenger`).
  useEffect(() => {
    if (passenger && pendingReview.current) { pendingReview.current = false; toReview(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passenger]);

  function toReview() {
    if (!validate()) return;
    // Contact details come from the signed-in account, so sign in before the review step.
    if (!passenger) { pendingReview.current = true; setShowLogin(true); return; }
    // Keep the same idempotency key when the payload is unchanged since last time.
    const sig = payloadSignature();
    if (!idemKey.current || sig !== idemPayloadSig.current) {
      idemKey.current = uuid();
      idemPayloadSig.current = sig;
    }
    setBanner(null);
    setStep('review');
  }

  async function submit(offsetOverride?: number) {
    if (!pickup || !dropoff) return;
    const effOffset = offsetOverride ?? scheduleOffsetMin;
    // If the payload changed since the key was minted (e.g. the user just chose a
    // DST occurrence), refresh the key so an edited payload isn't a key conflict.
    const sig = payloadSignature(effOffset);
    if (sig !== idemPayloadSig.current) {
      idemKey.current = uuid();
      idemPayloadSig.current = sig;
    }
    setSubmitting(true);
    setBanner(null);
    try {
      const payload = {
        pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label },
        dropoff: { lat: dropoff.lat, lng: dropoff.lng, label: dropoff.label },
        when,
        // Send the raw wall-clock string; the server interprets it as Europe/Nicosia.
        scheduledAt: when === 'SCHEDULE' ? scheduledAt : undefined,
        scheduleOffsetMin: when === 'SCHEDULE' ? effOffset : undefined,
        vClass,
        passengerCount: pax,
        luggageCount: 0,
        quoteId: quote?.quoteId,
        passengerName: name.trim() || passenger?.name || 'Passenger',
        phone: passenger?.phone ?? phone.trim(),
        note: note.trim() || undefined,
      };
      const res = await api<{ tracking: { token: string } }>('/bookings', {
        method: 'POST',
        body: payload,
        headers: { 'Idempotency-Key': idemKey.current },
      });
      await api('/tracking/exchange', { method: 'POST', body: { token: res.tracking.token } });
      router.push('/track');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.body.code === 'LOGIN_REQUIRED') {
          // Mandatory passenger login/registration (Task 014): open the modal, then resume.
          pendingSubmit.current = effOffset;
          pendingSubmitActive.current = true;
          setShowLogin(true);
          setSubmitting(false);
          return;
        }
        if (err.body.code === 'SCHEDULE_AMBIGUOUS') {
          // Keep the user on review and let them pick which occurrence they meant.
          const opts = (err.body as unknown as { scheduleOptions?: string[] }).scheduleOptions || [];
          setAmbiguous(opts.length ? opts : ['180', '120']);
          setBanner(tError(err));
          setSubmitting(false);
          return;
        }
        if (err.body.fieldErrors && Object.keys(err.body.fieldErrors).length) {
          setErrors(err.body.fieldErrors);
          setStep('form');
        }
        setBanner(err.body.message ? tError(err) : t('booking.review.bookingFailed'));
      } else {
        setBanner(t('booking.review.networkSafe'));
      }
      setSubmitting(false);
    }
  }

  function onPickerConfirm(sel: Selected) {
    // Update ONLY the field being edited; all other inputs are preserved.
    if (picker === 'pickup') {
      setPickup(sel);
      setPickupText(sel.label);
      setAutoPickup(false); // passenger chose a pickup explicitly
    } else if (picker === 'dropoff') {
      setDropoff(sel);
      setDropoffText(sel.label);
    }
    setPicker(null);
  }

  // Minimum scheduled time expressed in Europe/Nicosia wall time (matches the server),
  // regardless of the visitor's own timezone. Refreshes as time advances (scheduleTick).
  const scheduleMin = useMemo(() => {
    return nicosiaInputValue(new Date(Date.now() + (cfg?.schedule.minMinutes ?? 30) * 60000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, scheduleTick]);

  const classes = cfg?.classes ?? [
    { key: 'COMFORT' as const, label: 'Comfort', maxPassengers: 4 },
    { key: 'XL' as const, label: 'XL', maxPassengers: 6 },
  ];

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden">
      {cfg?.demoMode && <DemoBanner />}
      {cfgError && (
        <div className="flex items-center justify-center gap-3 bg-warn/15 border-b border-warn/30 px-3 py-1.5 text-xs sm:text-xs text-warn">
          <span>{t('booking.config.loadFailed')}</span>
          <button className="rounded border border-warn/40 px-2 py-0.5 hover:bg-warn/10" onClick={loadConfig} disabled={cfgLoading}>
            {cfgLoading ? t('booking.config.retrying') : t('common.retry')}
          </button>
        </div>
      )}
      <header className="z-20 flex items-center justify-between border-b border-edge bg-page/90 px-4 py-2 backdrop-blur sm:px-6">
        <Logo className="h-10" />
        <div className="flex items-center gap-2">
          {/* Segmented nav styled exactly like the Now / Schedule control. When signed in the
              trailing "Login" tab is dropped in favour of the account avatar (below). */}
          <nav className="hidden gap-2 rounded-[12px] border border-edge bg-elevated p-1 sm:flex">
            {[
              { href: '/', label: t('common.book'), active: true },
              { href: '/rides', label: t('booking.nav.rides'), active: false },
              { href: '/privacy', label: t('booking.nav.privacy'), active: false },
              ...(passenger ? [] : [{ href: '/login', label: t('booking.nav.login'), active: false }]),
            ].map((n) => (
              <a key={n.href} href={n.href} className={`rounded-[9px] px-3 py-2 text-sm font-medium transition ${n.active ? 'bg-accent text-[#0d1608]' : 'text-muted hover:text-ink'}`}>
                {n.label}
              </a>
            ))}
          </nav>
          <LanguageSwitcher compact />
          {passenger ? (
            <AccountMenu passenger={passenger} onLoggedOut={() => setPassenger(null)} />
          ) : (
            <a href="/login" className="btn-ghost !min-h-0 !py-1.5 text-base sm:hidden">{t('booking.nav.login')}</a>
          )}
        </div>
      </header>

      <div className="relative flex-1">
        <div className="absolute inset-0">
          {/* The full-screen picker is its own map; unmount this background map while it's
              open (frees the WebGL context and avoids two simultaneous map instances). */}
          {picker ? (
            <div className="h-full w-full bg-[#0e1518]" />
          ) : (
            <AutoMapView markers={markers} route={route?.line} fleet={fleet} focus={myLoc} center={myLoc ?? { lat: 34.92, lng: 33.2 }} zoom={myLoc ? 14 : 9} interactive fitPadding={fitPadding} className="h-full w-full" />
          )}
        </div>

        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end sm:block">
          <div className="pointer-events-auto w-full sm:absolute sm:left-4 sm:top-4 sm:h-[calc(100%-2rem)] sm:w-[380px]">
            <div className="card flex max-h-[64dvh] flex-col overflow-hidden sm:max-h-full">
              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5" style={{ paddingBottom: step === 'form' ? '1rem' : 'max(1rem, env(safe-area-inset-bottom))' }}>
                {step === 'form' ? (
                  /* ---- FORM (inlined so inputs keep focus across renders) ---- */
                  <div>
                    <p className="label">{t('booking.form.eyebrow')}</p>
                    <h1 className="mb-4 mt-1 text-2xl font-bold">{t('booking.form.title')}</h1>

                    {flash && <p role="status" className="mb-3 rounded-[12px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">{flash}</p>}
                    {banner && <p className="mb-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{banner}</p>}

                    <div className="space-y-3">
                      <PlacesInput kind="From" value={pickup} text={pickupText} onText={(t) => { setPickupText(t); if (autoPickup) setAutoPickup(false); }} onSelect={(s) => { setPickup(s); setAutoPickup(false); }} error={errors.pickup} />
                      {autoPickup && pickup && (
                        <p className="mt-1 text-xs text-accent">📍 {t('booking.form.usingLocation')}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <button type="button" className="chip hover:border-accent/50" onClick={() => setPicker('pickup')}>⌖ {t('booking.form.setPickupOnMap')}</button>
                        <button
                          type="button"
                          className="chip hover:border-accent/50"
                          onClick={() => {
                            setPickup(dropoff);
                            setDropoff(pickup);
                            setPickupText(dropoffText);
                            setDropoffText(pickupText);
                          }}
                          aria-label={t('booking.form.swapAria')}
                        >
                          ⇅ {t('booking.form.swap')}
                        </button>
                      </div>
                      <PlacesInput kind="To" value={dropoff} text={dropoffText} onText={setDropoffText} onSelect={setDropoff} error={errors.dropoff} />
                      {!dropoff && (places.home || places.work) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {places.home && <button type="button" className="chip hover:border-accent/50" onClick={() => { setDropoff({ lat: places.home!.lat, lng: places.home!.lng, label: places.home!.label }); setDropoffText(places.home!.label); }}>🏠 {t('booking.form.home')}</button>}
                          {places.work && <button type="button" className="chip hover:border-accent/50" onClick={() => { setDropoff({ lat: places.work!.lat, lng: places.work!.lng, label: places.work!.label }); setDropoffText(places.work!.label); }}>💼 {t('booking.form.work')}</button>}
                        </div>
                      )}
                      {!dropoff && destinations.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="text-xs text-muted">{t('booking.form.recent')}</span>
                          {destinations.map((d) => (
                            <button key={d.label} type="button" className="chip hover:border-accent/50" onClick={() => { setDropoff({ lat: d.lat, lng: d.lng, label: d.label }); setDropoffText(d.label); }}>{d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label}</button>
                          ))}
                        </div>
                      )}
                      <button type="button" className="chip hover:border-accent/50" onClick={() => setPicker('dropoff')}>⌖ {t('booking.form.setDestinationOnMap')}</button>
                    </div>

                    <div className="mt-5">
                      <p className="label mb-2" id="ride-class-label">{t('booking.form.chooseRide')}</p>
                      <div className="space-y-2" role="radiogroup" aria-labelledby="ride-class-label">
                        {classes.map((c) => {
                          const q = quotes[c.key as 'COMFORT' | 'XL'];
                          const selected = vClass === c.key;
                          return (
                            <button
                              key={c.key}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => {
                                setVClass(c.key);
                                if (pax > c.maxPassengers) setPax(c.maxPassengers);
                              }}
                              className={`flex w-full items-center justify-between gap-3 rounded-[12px] border px-4 py-3 text-left transition ${selected ? 'border-accent bg-accent/10' : 'border-edge bg-elevated hover:border-accent/40'}`}
                            >
                              <span className="min-w-0">
                                <span className="block font-semibold">{t(`common.vClass.${c.key}`)}</span>
                                <span className="text-xs text-muted">👥 {CLASS_META[c.key] && t(CLASS_META[c.key].seatsLabel)} · {CLASS_META[c.key] && t(CLASS_META[c.key].blurb)}</span>
                              </span>
                              <span className="shrink-0 text-right">
                                {pickup && dropoff ? (
                                  q ? (
                                    <>
                                      <span className={`block font-semibold tabular-nums ${selected ? 'text-accent' : 'text-ink'}`}>≈ {eur(q.totalCents)}</span>
                                      <span className="block text-xs text-muted tabular-nums">{eur(q.rangeLowCents)}–{eur(q.rangeHighCents)}</span>
                                    </>
                                  ) : <span className="text-xs text-muted">{quoting ? t('booking.form.pricing') : '—'}</span>
                                ) : <span className={selected ? 'text-accent' : 'text-muted'} aria-hidden>›</span>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {errors.pax && <p className="mt-1 text-xs text-danger">{errors.pax}</p>}
                    </div>

                    <div className="mt-4">
                      <div className="flex gap-2 rounded-[12px] border border-edge bg-elevated p-1">
                        {(['NOW', 'SCHEDULE'] as const).map((w) => (
                          <button key={w} type="button" aria-pressed={when === w} onClick={() => setWhen(w)} className={`flex-1 rounded-[9px] px-3 py-2 text-sm font-medium transition ${when === w ? 'bg-accent text-[#0d1608]' : 'text-muted hover:text-ink'}`}>
                            {w === 'NOW' ? t('booking.form.now') : t('booking.form.schedule')}
                          </button>
                        ))}
                      </div>
                      {when === 'SCHEDULE' && (
                        <div className="mt-2">
                          <input type="datetime-local" className={`field ${errors.scheduledAt ? 'border-danger' : ''}`} value={scheduledAt} min={scheduleMin} onChange={(e) => { setScheduledAt(e.target.value); setScheduleOffsetMin(undefined); setAmbiguous(null); }} />
                          <p className="mt-1 text-xs text-muted">{withSlot(t('booking.form.timezoneNote'), 'tz', <strong>{cfg?.timezone ?? 'Europe/Nicosia'}</strong>)}</p>
                          {errors.scheduledAt && <p className="mt-1 text-xs text-danger">{errors.scheduledAt}</p>}
                        </div>
                      )}
                    </div>

                    {pickup && dropoff && (
                      <div className="mt-3 rounded-[12px] border border-edge bg-elevated px-3 py-2.5 text-xs text-muted">
                        {route?.min != null && (
                          <div>{withSlot(t('booking.trip.estimate'), 'value', <span className="text-ink font-medium">{t('booking.trip.estimateValue', { min: route.min, km: route.km != null ? new Intl.NumberFormat(INTL_TAG[locale], { maximumFractionDigits: 1 }).format(route.km) : '' })}</span>)}</div>
                        )}
                        {quote ? (
                          <div className="mt-1">
                            {quote.night && <span>{t('booking.trip.night')} · </span>}
                            {quote.holiday && <span>{t('booking.trip.holiday')} · </span>}
                            <span>{t('booking.trip.meterNote')}</span>
                            {!quote.routeAvailable && <span> {t('booking.trip.approxDistance')}</span>}
                            {quote.airport && <AirportFareNote />}
                          </div>
                        ) : quoteErr ? (
                          <div className="mt-1 text-warn">{t('booking.trip.quoteFailed', { error: quoteErr })}</div>
                        ) : null}
                      </div>
                    )}

                    {passenger && (
                      <div className="mt-4 rounded-[12px] border border-edge bg-elevated px-3 py-2.5">
                        <label className="label" htmlFor="bk-name">{t('booking.contact.driverAsksFor')}</label>
                        <input id="bk-name" className={`field mt-1 ${errors.name ? 'border-danger' : ''}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" placeholder={t('booking.contact.namePlaceholder')} />
                        {errors.name && <p className="mt-1 text-xs text-danger">{errors.name}</p>}
                        <p className="mt-2 text-xs text-muted">{withSlot(t('booking.contact.callYou'), 'phone', <span className="text-ink">{passenger.phone}</span>)}</p>
                      </div>
                    )}

                    <details className="mt-4 rounded-[12px] border border-edge bg-elevated px-3 py-2.5" open={pax > 1 || !!note || !!errors.pax}>
                      <summary className="cursor-pointer text-sm font-medium">{t('booking.options.title')} <span className="text-xs font-normal text-muted">· {tp('common.passengers', pax)}{note ? ` · ${t('booking.options.note')}` : ''}</span></summary>
                      <div className="mt-3 space-y-3">
                        <div>
                          <span className="label" id="bk-pax-label">{t('booking.options.passengers')}</span>
                          <div className="mt-1 flex items-center gap-2" role="group" aria-labelledby="bk-pax-label">
                            <button type="button" aria-label={t('booking.options.fewer')} className="btn-ghost !min-h-[44px] !px-4" onClick={() => setPax((p) => Math.max(1, p - 1))}>−</button>
                            <span className="w-8 text-center text-lg font-semibold" aria-live="polite">{pax}</span>
                            <button type="button" aria-label={t('booking.options.more')} className="btn-ghost !min-h-[44px] !px-4" onClick={() => setPax((p) => Math.min(maxPax, p + 1))}>+</button>
                          </div>
                        </div>
                        <div>
                          <label className="label" htmlFor="bk-note">{t('booking.options.noteLabel')}</label>
                          <textarea id="bk-note" className="field mt-1 min-h-[44px]" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} placeholder={t('booking.options.notePlaceholder')} />
                        </div>
                      </div>
                    </details>
                  </div>
                ) : (
                  /* ---- REVIEW ---- */
                  <div>
                    <button className="mb-3 text-sm text-muted hover:text-ink" onClick={() => setStep('form')}>{t('booking.review.edit')}</button>
                    <h2 className="text-xl font-bold">{t('booking.review.title')}</h2>
                    {banner && <p className="my-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{banner}</p>}
                    <div className="mt-4 space-y-3 text-sm">
                      <Row label={t('booking.review.pickup')} value={pickup?.label ?? '—'} dot="accent" />
                      <Row label={t('booking.review.destination')} value={dropoff?.label ?? '—'} dot="ink" />
                      <Row label={t('booking.review.when')} value={when === 'NOW' ? t('booking.review.nowImmediate') : `${scheduledAt.replace('T', ' ')} · ${cfg?.timezone}`} />
                      <Row label={t('booking.review.class')} value={t(`common.vClass.${vClass}`)} />
                      <Row label={t('booking.review.passengers')} value={String(pax)} />
                      <Row label={t('booking.review.driverAsksFor')} value={name || passenger?.name || '—'} />
                      <Row label={t('booking.review.yourPhone')} value={passenger?.phone ?? phone} />
                      {note && <Row label={t('booking.review.note')} value={note} />}
                      <Row label={t('booking.review.fare')} value={quote ? t('booking.review.fareValue', { total: eur(quote.totalCents), low: eur(quote.rangeLowCents), high: eur(quote.rangeHighCents) }) : t('booking.review.fareByMeter')} />
                    </div>
                    {quote?.airport && <AirportFareNote />}
                    {ambiguous ? (
                      <div className="mt-4 rounded-[12px] border border-warn/40 bg-warn/10 p-3">
                        <p className="text-sm text-warn">{t('booking.review.ambiguousPrompt')}</p>
                        <div className="mt-2 grid gap-2">
                          {ambiguous.map((off) => {
                            const hrs = Number(off) / 60;
                            return (
                              <button
                                key={off}
                                className="btn-ghost w-full text-sm"
                                disabled={submitting}
                                onClick={() => { setScheduleOffsetMin(Number(off)); setAmbiguous(null); submit(Number(off)); }}
                              >
                                {t(hrs >= 3 ? 'booking.review.ambiguousEarlier' : 'booking.review.ambiguousLater', { time: scheduledAt.replace('T', ' '), offset: hrs })}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <button className="btn-primary mt-5 w-full" onClick={() => submit()} disabled={submitting}>{submitting ? t('booking.review.sending') : t('booking.review.confirm')}</button>
                    )}
                    <p className="mt-2 text-center text-xs text-muted">{when === 'NOW' ? t('booking.review.autoMatchNow') : t('booking.review.autoMatchScheduled')} {t('booking.review.trackingAndPay')}</p>
                  </div>
                )}
              </div>
              {step === 'form' && (
                // Sticky call to action: always visible without scrolling the form (2026-10-01 audit).
                <div className="border-t border-edge p-3 sm:p-4" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
                  <button className="btn-primary w-full" onClick={toReview}>
                    {pickup && dropoff
                      ? (quote
                        ? t('booking.cta.requestClassPrice', { vClass: t(`common.vClass.${vClass}`), price: eur(quote.totalCents) })
                        : t('booking.cta.requestClass', { vClass: t(`common.vClass.${vClass}`) }))
                      : t('booking.cta.request')}
                  </button>
                  {!passenger && pickup && dropoff && <p className="mt-2 text-center text-xs text-muted">{t('booking.cta.signInFirst')}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {picker && (
        <AutoMapPicker
          kind={picker}
          initial={picker === 'pickup' ? pickup : dropoff}
          fallback={picker === 'pickup' ? (dropoff ?? null) : (pickup ?? null)}
          onConfirm={onPickerConfirm}
          onCancel={() => setPicker(null)}
        />
      )}

      {showLogin && (
        <PassengerLoginModal
          onClose={() => { setShowLogin(false); pendingSubmitActive.current = false; pendingReview.current = false; }}
          onDone={(p) => {
            setShowLogin(false);
            setPassenger(p);
            setPhone((cur) => cur || p.phone);
            if (p.name) setName((cur) => cur || p.name!);
            loadPassenger();
            if (pendingSubmitActive.current) { pendingSubmitActive.current = false; submit(pendingSubmit.current); }

          }}
        />
      )}
    </div>
  );
}

// Airport trips: official fixed fares (Road Transport Department) apply and can differ from the
// meter estimate. Shown until the fixed-fare table is implemented (2026-10-01 audit, Stage 0.7).
function AirportFareNote() {
  const { t } = useT();
  return (
    <p className="mt-2 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
      {t('booking.trip.airportNote')}
    </p>
  );
}

function Row({ label, value, dot }: { label: string; value: string; dot?: 'accent' | 'ink' }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-edge/60 pb-2">
      <span className="flex items-center gap-2 text-muted">
        {dot && <span className={`inline-block h-2 w-2 rounded-full ${dot === 'accent' ? 'bg-accent' : 'bg-ink'}`} />}
        {label}
      </span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
