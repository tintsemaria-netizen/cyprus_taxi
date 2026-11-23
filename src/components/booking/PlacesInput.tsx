'use client';

import { onCyprusIsland } from '@/lib/cyprus-island';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, uuid, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import AutoMapPicker from './AutoMapPicker';
import { nearParam } from '@/lib/nearHint';

export interface Selected {
  lat: number;
  lng: number;
  label: string;
}

interface Props {
  kind: 'From' | 'To' | 'Stop';
  /** Shown inside the field on the right, e.g. «На карте» (2026-11-15). */
  trailing?: React.ReactNode;
  onFocusInput?: () => void;
  autoFocus?: boolean;
  /** Tap opens the full-screen route editor instead of typing here (2026-11-15). */
  onActivate?: () => void;
  value: Selected | null;
  text: string;
  onText: (t: string) => void;
  onSelect: (s: Selected | null) => void;
  error?: string;
  /** Own label text instead of «Откуда/Куда» (saved places, 2026-11-18). */
  labelText?: string;
  /** «На карте» target button + × clear, like the route editor (default on; off for read-only fields). */
  mapPick?: boolean;
}

// A result may carry coordinates directly (geocoding / demo) or only a placeId
// (Places (New) prediction) that we resolve via /places/details on selection.
interface Result {
  label: string;
  secondary?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  kind?: string;
}

export function PlacesInput({ kind, value, text, onText, onSelect, error, trailing, onFocusInput, autoFocus, onActivate, labelText, mapPick = true }: Props) {
  const [picking, setPicking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Same tools as the route editor everywhere an address is typed (2026-11-18): × wipes the field,
  // the target opens the map to set the point by hand.
  const tools = !onActivate && !trailing;
  const { t } = useT();
  const [results, setResults] = useState<Result[]>([]);
  const [osm, setOsm] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demo, setDemo] = useState(false);
  const [status, setStatus] = useState<'idle' | 'none' | 'unavailable' | 'offIsland'>('idle');
  const [active, setActive] = useState(-1); // keyboard-highlighted row
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // One Places billing session spans the autocomplete keystrokes until a selection is
  // resolved; reset afterwards so the next search starts a fresh session.
  const sessionRef = useRef<string>('');
  function sessionToken() {
    if (!sessionRef.current) sessionRef.current = uuid();
    return sessionRef.current;
  }

  function invalidatePending() {
    reqSeq.current += 1;
    if (timer.current) clearTimeout(timer.current);
    abortRef.current?.abort();
    setLoading(false);
  }

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      invalidatePending();
    };
     
  }, []);

  useEffect(() => {
    if (value) { invalidatePending(); setOpen(false); setResults([]); setStatus('idle'); setActive(-1); }
     
  }, [value]);

  function handleText(t: string) {
    onText(t);
    if (value) onSelect(null);
    invalidatePending();
    setActive(-1);
    if (t.trim().length < 2) {
      setResults([]);
      setOpen(false);
      setStatus('idle');
      return;
    }
    setLoading(true);
    const my = ++reqSeq.current;
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await api<{ demo: boolean; provider?: string; results: Result[]; unavailable?: boolean }>(
          `/places/search?q=${encodeURIComponent(t)}&session=${sessionToken()}${nearParam()}`,
          { signal: controller.signal, timeoutMs: 6000 },
        );
        if (my !== reqSeq.current) return; // superseded
        setResults(res.results);
        setDemo(res.demo);
        setOsm(res.provider === 'osm');
        setStatus(res.unavailable ? 'unavailable' : res.results.length ? 'idle' : 'none');
        setActive(-1);
        setOpen(true);
      } catch {
        if (my === reqSeq.current) { setResults([]); setStatus('unavailable'); setOpen(true); }
      } finally {
        if (my === reqSeq.current) setLoading(false);
      }
    }, 120); // own address base answers in a few ms (2026-11-19): short debounce
  }

  async function choose(r: Result) {
    invalidatePending();
    let picked: Selected | null = null;
    if (typeof r.lat === 'number' && typeof r.lng === 'number') {
      picked = { lat: r.lat, lng: r.lng, label: r.label };
    } else if (r.placeId) {
      // Resolve the prediction to coordinates (same billing session), then reset it.
      try {
        const res = await api<{ place: { lat: number; lng: number; label: string } | null }>(
          `/places/details?placeId=${encodeURIComponent(r.placeId)}&session=${sessionToken()}`,
          { timeoutMs: 6000 },
        );
        if (res.place) picked = { lat: res.place.lat, lng: res.place.lng, label: res.place.label || r.label };
      } catch (e) {
        picked = null;
        if (e instanceof ApiRequestError && e.body.code === 'OFF_ISLAND') { sessionRef.current = ''; setStatus('offIsland'); setOpen(true); return; }
      }
    }
    sessionRef.current = ''; // end the Places session after a resolution attempt
    if (!picked) { setStatus('unavailable'); setOpen(true); return; }
    // Only on the island of Cyprus (2026-11-24, operator).
    if (!onCyprusIsland(picked)) { setStatus('offIsland'); setOpen(true); return; }
    onSelect(picked);
    onText(picked.label);
    setOpen(false);
    setResults([]);
    setStatus('idle');
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); void choose(results[active]); }
    else if (e.key === 'Escape') { setOpen(false); setActive(-1); }
  }

  const inputId = useId();
  return (
    <div ref={boxRef} className="relative">
      <label className="label" htmlFor={inputId}>{labelText ?? (kind === 'From' ? t('booking.places.from') : kind === 'Stop' ? t('booking.places.stop') : t('booking.places.to'))}</label>
      <input
        id={inputId}
        aria-label={kind === 'From' ? t('booking.places.pickupAria') : kind === 'Stop' ? t('booking.places.stopAria') : t('booking.places.destinationAria')}
        ref={inputRef}
        className={`field mt-1 ${trailing ? 'pe-28' : tools ? (mapPick ? 'pe-[84px]' : 'pe-11') : ''} ${error ? 'border-danger' : value ? 'border-accent/60' : ''}`}
        placeholder={kind === 'From' ? t('booking.places.pickupPlaceholder') : kind === 'Stop' ? t('booking.places.stopPlaceholder') : t('booking.places.destinationPlaceholder')}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => handleText(e.target.value)}
        onKeyDown={onKeyDown}
        readOnly={!!onActivate}
        onClick={onActivate}
        onKeyUp={(e) => { if (onActivate && (e.key === 'Enter' || e.key === ' ')) onActivate(); }}
        // Activate on focus too: on a collapsed sheet the tap expands it and moves the field, so
        // the click may never arrive (2026-11-15).
        onFocus={() => { onFocusInput?.(); if (onActivate) onActivate(); else if (results.length) setOpen(true); }}
        autoComplete="off"
        role="combobox"
        aria-controls={`${inputId}-list`}
        aria-expanded={open}
        aria-autocomplete="list"
        aria-invalid={!!error}
      />
      {tools && (text !== '' || mapPick) ? (
        <div className="absolute end-1.5 top-[30px] flex items-center gap-1">
          {text !== '' && (
            <button type="button" aria-label={t('booking.route.clear')} title={t('booking.route.clear')} data-testid="places-clear"
              onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
              onClick={() => { handleText(''); onSelect(null); inputRef.current?.focus({ preventScroll: true }); }}
              className="flex h-9 w-8 shrink-0 items-center justify-center text-muted hover:text-ink">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.35" /><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#0E1513" strokeWidth="2.2" strokeLinecap="round" /></svg>
            </button>
          )}
          {mapPick && (
            <button type="button" onClick={() => { setOpen(false); setPicking(true); }} aria-label={t('booking.form.onMap')} title={t('booking.form.onMap')} data-testid="places-on-map"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-page text-accent">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="6.5" /><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /></svg>
            </button>
          )}
        </div>
      ) : trailing ? (
        <div className="absolute end-1.5 top-[30px] flex items-center">{trailing}</div>
      ) : value && (
        <span className="absolute end-3 top-9 text-accent text-sm" aria-hidden>
          ✓
        </span>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {picking && createPortal(
        <AutoMapPicker kind={kind === 'From' ? 'pickup' : kind === 'Stop' ? 'stop' : 'dropoff'} initial={value} fallback={null}
          onConfirm={(s) => { setPicking(false); onSelect(s); onText(s.label); setOpen(false); }} onCancel={() => setPicking(false)} />,
        document.body,
      )}
      {open && (results.length > 0 || loading || status !== 'idle') && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-[12px] border border-edge bg-elevated shadow-card" role="listbox" id={`${inputId}-list`}>
          {loading && !results.length && <div className="px-4 py-3 text-sm text-muted">{t('booking.places.searching')}</div>}
          {!loading && status === 'none' && <div className="px-4 py-3 text-sm text-muted">{t('booking.places.none')}</div>}
          {!loading && status === 'unavailable' && <div className="px-4 py-3 text-sm text-warn">{t('booking.places.unavailable')}</div>}
          {!loading && status === 'offIsland' && <div className="px-4 py-3 text-sm font-medium text-danger" data-testid="off-island">{t('errors.OFF_ISLAND')}</div>}
          {(!loading || results.length > 0) &&
            results.map((r, i) => (
              <button
                key={`${r.placeId ?? r.label}-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                className={`flex w-full items-start gap-2 px-4 py-2.5 text-start ${i === active ? 'bg-panel' : 'hover:bg-panel'}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => void choose(r)}
              >
                <span className="mt-0.5 text-accent">◈</span>
                <span className="text-sm text-ink">
                  {r.label}
                  {r.secondary && <span className="block text-xs text-muted">{r.secondary}</span>}
                </span>
              </button>
            ))}
          {osm && results.length > 0 && (
            <div className="border-t border-edge px-4 py-1 text-end text-[10px] text-muted/70">© OpenStreetMap</div>
          )}
          {!loading && demo && results.length > 0 && (
            <div className="border-t border-edge px-4 py-1.5 text-xs text-muted">{t('booking.places.demo')}</div>
          )}
        </div>
      )}
    </div>
  );
}
