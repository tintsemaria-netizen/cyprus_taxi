'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { Logo } from '@/components/Brand';
import { PlacesInput, Selected } from './PlacesInput';
import { DemoBanner } from '@/components/DemoBanner';
import AutoMapPicker from './AutoMapPicker';
import { PassengerLoginModal } from './PassengerLoginModal';
import { nicosiaInputValue } from '@/lib/timezone';
import { api, ApiRequestError, uuid } from '@/lib/api-client';

interface PublicConfig {
  demoMode: boolean;
  timezone: string;
  classes: { key: 'COMFORT' | 'XL'; label: string; maxPassengers: number }[];
  schedule: { minMinutes: number; maxDays: number };
  operatorName: string | null;
}

const CLASS_META: Record<string, { seatsLabel: string; blurb: string }> = {
  COMFORT: { seatsLabel: '4 seats', blurb: 'Everyday sedan' },
  XL: { seatsLabel: '6 seats', blurb: 'Extra space / group' },
};

export default function BookingApp() {
  const router = useRouter();
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
  const [submitting, setSubmitting] = useState(false);
  const [picker, setPicker] = useState<'pickup' | 'dropoff' | null>(null);
  // Passenger's detected location (for centring the map + defaulting the pickup).
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [autoPickup, setAutoPickup] = useState(false); // pickup was auto-set from geolocation
  // Task 014: passenger account + mandatory login before booking + destination history.
  const [passenger, setPassenger] = useState<{ phone: string; name?: string } | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [destinations, setDestinations] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const pendingSubmit = useRef<number | undefined>(undefined);
  const pendingSubmitActive = useRef(false);

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
    api<{ phone: string; name?: string }>('/passenger/me')
      .then((p) => {
        setPassenger(p);
        setPhone((cur) => cur || p.phone);
        if (p.name) setName((cur) => cur || p.name!);
        api<{ destinations: { label: string; lat: number; lng: number }[] }>('/passenger/destinations').then((d) => setDestinations(d.destinations)).catch(() => {});
      })
      .catch(() => setPassenger(null));
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
        let label = 'Current location';
        try {
          const r = await api<{ place: { label: string } | null }>(`/places/reverse?lat=${lat}&lng=${lng}`, { timeoutMs: 6000 });
          if (r.place?.label) label = r.place.label;
        } catch { /* keep the generic label */ }
        if (cancelled || pickupRef.current || pickupTextRef.current.trim() !== '') return; // re-check after await
        setPickup({ lat, lng, label });
        setPickupText(label);
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
  interface QuoteBody { quoteId: string; priceType: string; totalCents: number; rangeLowCents: number; rangeHighCents: number; night: boolean; holiday: boolean; routeAvailable: boolean; lines: { code: string; label: string; cents: number }[]; }
  const [quote, setQuote] = useState<QuoteBody | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  useEffect(() => {
    if (!pickup || !dropoff) { setQuote(null); setQuoteErr(null); return; }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setQuoteErr(null);
      try {
        const q = await api<QuoteBody>('/quote', {
          method: 'POST',
          body: {
            pickup: { lat: pickup.lat, lng: pickup.lng }, dropoff: { lat: dropoff.lat, lng: dropoff.lng }, vClass, passengerCount: pax, luggageCount: 0,
            // Price a scheduled ride for its journey time (day/night/holiday + traffic).
            ...(when === 'SCHEDULE' && scheduledAt ? { scheduledAt, scheduleOffsetMin } : {}),
          },
          signal: controller.signal, timeoutMs: 9000,
        });
        setQuote(q);
      } catch (e) {
        if (e instanceof ApiRequestError) setQuoteErr(e.body.message);
        setQuote(null);
      }
    }, 500);
    return () => { clearTimeout(t); controller.abort(); };
  }, [pickup, dropoff, vClass, pax, when, scheduledAt, scheduleOffsetMin]);
  const eur = (c: number) => `€${(c / 100).toFixed(2)}`;

  const maxPax = cfg?.classes.find((c) => c.key === vClass)?.maxPassengers ?? (vClass === 'XL' ? 6 : 4);

  function payloadSignature(offset = scheduleOffsetMin): string {
    return JSON.stringify({ pickup, dropoff, when, scheduledAt, scheduleOffsetMin: offset, vClass, pax, name: name.trim(), phone: phone.trim(), note: note.trim() });
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!pickup) e.pickup = 'Choose a pickup from the list or tap the map.';
    if (!dropoff) e.dropoff = 'Choose a destination from the list or tap the map.';
    if (!name.trim()) e.name = 'Enter a name.';
    if (!phone.trim()) e.phone = 'Enter an international phone number.';
    if (when === 'SCHEDULE' && !scheduledAt) e.scheduledAt = 'Pick a date and time.';
    if (pax < 1 || pax > maxPax) e.pax = `1–${maxPax} passengers for this class.`;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function toReview() {
    if (!validate()) return;
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
        passengerName: name.trim(),
        phone: phone.trim(),
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
          setBanner(err.body.message);
          setSubmitting(false);
          return;
        }
        if (err.body.fieldErrors && Object.keys(err.body.fieldErrors).length) {
          setErrors(err.body.fieldErrors);
          setStep('form');
        }
        setBanner(err.body.message || 'Could not create the booking.');
      } else {
        setBanner('Network problem — your details are safe. Check connection and retry.');
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
        <div className="flex items-center justify-center gap-3 bg-warn/15 border-b border-warn/30 px-3 py-1.5 text-[11px] sm:text-xs text-warn">
          <span>Couldn&apos;t load service settings — booking may be unavailable. The map still works.</span>
          <button className="rounded border border-warn/40 px-2 py-0.5 hover:bg-warn/10" onClick={loadConfig} disabled={cfgLoading}>
            {cfgLoading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}
      <header className="z-20 flex items-center justify-between border-b border-edge bg-page/90 px-4 py-2 backdrop-blur sm:px-6">
        <Logo className="h-10" />
        {/* Segmented nav styled exactly like the Now / Schedule control. */}
        <nav className="hidden gap-2 rounded-[12px] border border-edge bg-elevated p-1 sm:flex">
          {[
            { href: '/', label: 'Book', active: true },
            { href: '/rides', label: 'My rides', active: false },
            { href: '/privacy', label: 'Privacy', active: false },
            { href: '/staff/login', label: 'Login', active: false },
          ].map((n) => (
            <a key={n.href} href={n.href} className={`rounded-[9px] px-3 py-2 text-sm font-medium transition ${n.active ? 'bg-accent text-[#0d1608]' : 'text-muted hover:text-ink'}`}>
              {n.label}
            </a>
          ))}
        </nav>
        <a href="/staff/login" className="btn-ghost !min-h-0 !py-1.5 text-base sm:hidden">Login</a>
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

        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end sm:block">
          <div className="pointer-events-auto w-full sm:absolute sm:left-4 sm:top-4 sm:h-[calc(100%-2rem)] sm:w-[380px]">
            <div className="card flex max-h-[64dvh] flex-col overflow-hidden sm:max-h-full">
              <div className="overflow-y-auto p-4 sm:p-5" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
                {step === 'form' ? (
                  /* ---- FORM (inlined so inputs keep focus across renders) ---- */
                  <div>
                    <p className="label">Let&apos;s get you there</p>
                    <h1 className="mb-4 mt-1 text-2xl font-bold">Where to next?</h1>

                    {banner && <p className="mb-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{banner}</p>}

                    <div className="space-y-3">
                      <PlacesInput kind="From" value={pickup} text={pickupText} onText={(t) => { setPickupText(t); if (autoPickup) setAutoPickup(false); }} onSelect={(s) => { setPickup(s); setAutoPickup(false); }} error={errors.pickup} />
                      {autoPickup && pickup && (
                        <p className="mt-1 text-[11px] text-accent">📍 Using your current location — change it on the map or type an address.</p>
                      )}
                      <div className="flex items-center justify-between">
                        <button type="button" className="chip hover:border-accent/50" onClick={() => setPicker('pickup')}>⌖ Set pickup on map</button>
                        <button
                          type="button"
                          className="chip hover:border-accent/50"
                          onClick={() => {
                            setPickup(dropoff);
                            setDropoff(pickup);
                            setPickupText(dropoffText);
                            setDropoffText(pickupText);
                          }}
                          aria-label="Swap pickup and destination"
                        >
                          ⇅ Swap
                        </button>
                      </div>
                      <PlacesInput kind="To" value={dropoff} text={dropoffText} onText={setDropoffText} onSelect={setDropoff} error={errors.dropoff} />
                      {!dropoff && destinations.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="text-[11px] text-muted">Recent:</span>
                          {destinations.map((d) => (
                            <button key={d.label} type="button" className="chip hover:border-accent/50" onClick={() => { setDropoff({ lat: d.lat, lng: d.lng, label: d.label }); setDropoffText(d.label); }}>{d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label}</button>
                          ))}
                        </div>
                      )}
                      <button type="button" className="chip hover:border-accent/50" onClick={() => setPicker('dropoff')}>⌖ Set destination on map</button>
                    </div>

                    <div className="mt-5">
                      <div className="flex gap-2 rounded-[12px] border border-edge bg-elevated p-1">
                        {(['NOW', 'SCHEDULE'] as const).map((w) => (
                          <button key={w} type="button" onClick={() => setWhen(w)} className={`flex-1 rounded-[9px] px-3 py-2 text-sm font-medium transition ${when === w ? 'bg-accent text-[#0d1608]' : 'text-muted hover:text-ink'}`}>
                            {w === 'NOW' ? 'Now' : 'Schedule'}
                          </button>
                        ))}
                      </div>
                      {when === 'SCHEDULE' && (
                        <div className="mt-2">
                          <input type="datetime-local" className={`field ${errors.scheduledAt ? 'border-danger' : ''}`} value={scheduledAt} min={scheduleMin} onChange={(e) => { setScheduledAt(e.target.value); setScheduleOffsetMin(undefined); setAmbiguous(null); }} />
                          <p className="mt-1 text-xs text-muted">Time is <strong>{cfg?.timezone ?? 'Europe/Nicosia'}</strong> (Cyprus) regardless of your device. A scheduled ride is a request awaiting dispatcher confirmation.</p>
                          {errors.scheduledAt && <p className="mt-1 text-xs text-danger">{errors.scheduledAt}</p>}
                        </div>
                      )}
                    </div>

                    <div className="mt-5">
                      <p className="label mb-2">Choose your ride</p>
                      <div className="space-y-2">
                        {classes.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => {
                              setVClass(c.key);
                              if (pax > c.maxPassengers) setPax(c.maxPassengers);
                            }}
                            className={`flex w-full items-center justify-between rounded-[12px] border px-4 py-3 text-left transition ${vClass === c.key ? 'border-accent bg-accent/10' : 'border-edge bg-elevated hover:border-accent/40'}`}
                          >
                            <span>
                              <span className="block font-semibold">{c.label}</span>
                              <span className="text-xs text-muted">👥 {CLASS_META[c.key]?.seatsLabel} · {CLASS_META[c.key]?.blurb}</span>
                            </span>
                            <span className={vClass === c.key ? 'text-accent' : 'text-muted'}>›</span>
                          </button>
                        ))}
                      </div>
                      {errors.pax && <p className="mt-1 text-xs text-danger">{errors.pax}</p>}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Passengers</label>
                        <div className="mt-1 flex items-center gap-2">
                          <button type="button" className="btn-ghost !min-h-0 !px-3 !py-2" onClick={() => setPax((p) => Math.max(1, p - 1))}>−</button>
                          <span className="w-8 text-center text-lg font-semibold">{pax}</span>
                          <button type="button" className="btn-ghost !min-h-0 !px-3 !py-2" onClick={() => setPax((p) => Math.min(maxPax, p + 1))}>+</button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 space-y-3">
                      <div>
                        <label className="label">Name</label>
                        <input className={`field mt-1 ${errors.name ? 'border-danger' : ''}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Your name" />
                        {errors.name && <p className="mt-1 text-xs text-danger">{errors.name}</p>}
                      </div>
                      <div>
                        <label className="label">Phone (international)</label>
                        <input className={`field mt-1 ${errors.phone ? 'border-danger' : ''}`} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+357 …" inputMode="tel" />
                        {errors.phone && <p className="mt-1 text-xs text-danger">{errors.phone}</p>}
                        <p className="mt-1 text-[11px] text-muted">Collected to coordinate your ride. Not verified in beta.</p>
                      </div>
                      <div>
                        <label className="label">Note (optional)</label>
                        <textarea className="field mt-1 min-h-[44px]" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} placeholder="Flight number, luggage, etc." />
                      </div>
                    </div>

                    {pickup && dropoff && (
                      <div className="mt-4 rounded-[12px] border border-edge bg-elevated px-3 py-2.5 text-xs text-muted">
                        {route?.min != null && (
                          <div>Estimated trip: <span className="text-ink font-medium">≈ {route.min} min · {route.km} km</span> driving.</div>
                        )}
                        {quote ? (
                          <div className="mt-1">
                            Estimated fare: <span className="text-accent font-semibold">{eur(quote.totalCents)}</span>
                            <span className="text-muted"> ({eur(quote.rangeLowCents)}–{eur(quote.rangeHighCents)})</span>
                            {quote.night && <span className="ml-1">· night tariff</span>}
                            {quote.holiday && <span className="ml-1">· holiday</span>}
                            <div className="mt-1 text-[10px] text-muted">Regulated meter estimate — final amount is set by the taximeter. {quote.routeAvailable ? '' : 'Distance approximate (routing unavailable).'}</div>
                          </div>
                        ) : quoteErr ? (
                          <div className="mt-1 text-warn">Couldn&apos;t estimate the fare: {quoteErr}</div>
                        ) : (
                          <div className="mt-1">Estimating fare…</div>
                        )}
                      </div>
                    )}
                    <button className="btn-primary mt-5 w-full" onClick={toReview}>Request a ride</button>
                    <p className="mt-3 text-center text-[11px] text-muted">Metered estimate — the driver settles the final metered fare.</p>
                  </div>
                ) : (
                  /* ---- REVIEW ---- */
                  <div>
                    <button className="mb-3 text-sm text-muted hover:text-ink" onClick={() => setStep('form')}>‹ Edit</button>
                    <h2 className="text-xl font-bold">Review your request</h2>
                    {banner && <p className="my-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{banner}</p>}
                    <div className="mt-4 space-y-3 text-sm">
                      <Row label="Pickup" value={pickup?.label ?? '—'} dot="accent" />
                      <Row label="Destination" value={dropoff?.label ?? '—'} dot="ink" />
                      <Row label="When" value={when === 'NOW' ? 'Now (immediate request)' : `${scheduledAt.replace('T', ' ')} · ${cfg?.timezone}`} />
                      <Row label="Class" value={vClass === 'XL' ? 'XL' : 'Comfort'} />
                      <Row label="Passengers" value={String(pax)} />
                      <Row label="Name" value={name} />
                      <Row label="Phone" value={phone} />
                      {note && <Row label="Note" value={note} />}
                      <Row label="Fare" value="Confirmed by dispatcher" />
                    </div>
                    {ambiguous ? (
                      <div className="mt-4 rounded-[12px] border border-warn/40 bg-warn/10 p-3">
                        <p className="text-sm text-warn">On this night the clocks change and this time occurs twice. Which one do you mean?</p>
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
                                {scheduledAt.replace('T', ' ')} · {hrs >= 3 ? 'earlier (summer time' : 'later (winter time'}, UTC+{hrs})
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <button className="btn-primary mt-5 w-full" onClick={() => submit()} disabled={submitting}>{submitting ? 'Sending…' : 'Confirm request'}</button>
                    )}
                    <p className="mt-2 text-center text-[11px] text-muted">You&apos;ll get a private tracking link. No driver is reserved until a dispatcher assigns one.</p>
                  </div>
                )}
              </div>
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
          onClose={() => { setShowLogin(false); pendingSubmitActive.current = false; }}
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
