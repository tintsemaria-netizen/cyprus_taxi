'use client';

import { useEffect, useRef, useState } from 'react';
import { api, uuid } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import type { Selected } from './PlacesInput';

// Full-screen route editor (2026-11-15). Opens when the passenger starts typing an address.
// A clean full screen (app dark theme) so the addresses and suggestions are easy to read: the route box at the top
// (from → [stop] → to, joined by a line), «+» (add a stop) and «⇅» (swap), then a compact list —
// saved/recent places with their distance while the field is empty, search results while typing.
// Own IL-Y design (lime dots, graphite text); not a copy of any other app.

export type RouteSlot = 'p' | 's' | 'd';
interface Row { slot: RouteSlot; sel: Selected | null; text: string }
interface Place { label: string; lat: number; lng: number }
interface Result { label: string; secondary?: string; lat?: number; lng?: number; placeId?: string }

interface Props {
  rows: Row[]; // in route order: p, [s], d
  initial: RouteSlot;
  origin: { lat: number; lng: number } | null; // for the distance next to each place
  recent: Place[];
  home: Place | null;
  work: Place | null;
  canAddStop: boolean;
  onText: (slot: RouteSlot, text: string) => void;
  onSelect: (slot: RouteSlot, sel: Selected | null) => void;
  onAddStop: () => void;
  onRemoveStop: () => void;
  onSwap: () => void;
  /** Move a point from one position to another (drag by ≡ when there is a stop). */
  onReorder: (from: number, to: number) => void;
  onPickOnMap: (slot: RouteSlot) => void;
  onClose: () => void;
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): string {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  const d = 2 * R * Math.asin(Math.sqrt(h));
  return d < 10 ? d.toFixed(1) : String(Math.round(d));
}

// Split "Main name, rest of the address" into two lines like a place card.
function twoLines(label: string): [string, string] {
  const i = label.indexOf(',');
  return i > 0 ? [label.slice(0, i), label.slice(i + 1).trim()] : [label, ''];
}

// Dark IL-Y theme (2026-11-15: the user asked to drop the white background).
const LIME = '#C8FF46';

export function RouteEditor(p: Props) {
  const { t, locale } = useT();
  const [active, setActive] = useState<RouteSlot>(p.initial);
  // With a stop (3 points) the rows are reordered by dragging ≡; with 2 points ⇅ swaps them.
  const ROW_H = 53;
  const [drag, setDrag] = useState<{ index: number; startY: number; dy: number } | null>(null);
  const endDrag = () => {
    const d = drag; setDrag(null);
    if (!d || Math.abs(d.dy) < 8) return;
    const to = Math.max(0, Math.min(p.rows.length - 1, Math.round(d.index + d.dy / ROW_H)));
    p.onReorder(d.index, to);
  };
  const inputs = useRef<Partial<Record<RouteSlot, HTMLInputElement | null>>>({});
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'none' | 'unavailable'>('idle');
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const session = useRef('');
  const token = () => (session.current ||= uuid());

  // Focus the requested field (the booking sheet already focused a proxy input inside the tap,
  // so iOS keeps the keyboard open while focus moves here).
  useEffect(() => {
    const el = inputs.current[active];
    if (el && document.activeElement !== el) { el.focus({ preventScroll: true }); const n = el.value.length; try { el.setSelectionRange(n, n); } catch { /* ignore */ } }
  }, [active]);

  const activeRow = p.rows.find((r) => r.slot === active) ?? p.rows[p.rows.length - 1];
  const query = activeRow.sel ? '' : activeRow.text.trim();

  function search(text: string) {
    if (timer.current) clearTimeout(timer.current);
    const my = ++seq.current;
    if (text.trim().length < 2) { setResults([]); setStatus('idle'); return; }
    setStatus('loading');
    timer.current = setTimeout(async () => {
      try {
        const r = await api<{ results: Result[]; unavailable?: boolean }>(`/places/search?q=${encodeURIComponent(text)}&session=${token()}`, { timeoutMs: 6000 });
        if (my !== seq.current) return;
        setResults(r.results);
        setStatus(r.unavailable ? 'unavailable' : r.results.length ? 'idle' : 'none');
      } catch { if (my === seq.current) { setResults([]); setStatus('unavailable'); } }
    }, 250);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function nextEmpty(after: RouteSlot): RouteSlot | null {
    const order = p.rows.map((r) => r.slot);
    const start = order.indexOf(after);
    for (const s of [...order.slice(start + 1), ...order.slice(0, start)]) {
      const row = p.rows.find((r) => r.slot === s)!;
      if (!row.sel) return s;
    }
    return null;
  }

  async function pick(place: Result | Place) {
    let sel: Selected | null = null;
    if (typeof place.lat === 'number' && typeof place.lng === 'number') sel = { lat: place.lat, lng: place.lng, label: place.label };
    else if ('placeId' in place && place.placeId) {
      try {
        const r = await api<{ place: { lat: number; lng: number; label: string } | null }>(`/places/details?placeId=${encodeURIComponent(place.placeId)}&session=${token()}`, { timeoutMs: 6000 });
        if (r.place) sel = { lat: r.place.lat, lng: r.place.lng, label: r.place.label || place.label };
      } catch { sel = null; }
    }
    session.current = '';
    if (!sel) { setStatus('unavailable'); return; }
    p.onSelect(active, sel);
    p.onText(active, sel.label);
    setResults([]); setStatus('idle');
    // Next empty field, or done (back to the booking sheet with the prices).
    const nxt = nextEmpty(active);
    if (nxt) setActive(nxt); else p.onClose();
  }

  const showSaved = query.length < 2;
  const saved: (Place & { icon: 'home' | 'work' | 'recent'; name?: string })[] = showSaved
    ? [
        ...(p.home ? [{ ...p.home, icon: 'home' as const, name: t('booking.form.home') }] : []),
        ...(p.work ? [{ ...p.work, icon: 'work' as const, name: t('booking.form.work') }] : []),
        ...p.recent.map((r) => ({ ...r, icon: 'recent' as const })),
      ]
    : [];

  const dot = (slot: RouteSlot) => slot === 'p'
    ? <span className="block h-3.5 w-3.5 rounded-full border-[3px] bg-page" style={{ borderColor: LIME }} />
    : slot === 's'
      ? <span className="block h-3 w-3 rounded-[3px]" style={{ background: '#FFC83D' }} />
      : <span className="block h-3.5 w-3.5 rounded-full" style={{ background: LIME }} />;

  const icon = (k: 'home' | 'work' | 'recent' | 'pin') => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" className="text-muted" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {k === 'recent' && (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>)}
      {k === 'home' && (<path d="M4 11.5 12 5l8 6.5M6.5 10v8.5h11V10" />)}
      {k === 'work' && (<><rect x="4" y="8" width="16" height="11" rx="2" /><path d="M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8" /></>)}
      {k === 'pin' && (<><path d="M12 20s6-5.4 6-10a6 6 0 0 0-12 0c0 4.6 6 10 6 10z" /><circle cx="12" cy="10" r="2.2" /></>)}
    </svg>
  );

  const placeholder = (s: RouteSlot) => s === 'p' ? t('booking.places.pickupPlaceholder') : s === 's' ? t('booking.places.stopPlaceholder') : t('booking.places.destinationPlaceholder');
  const aria = (s: RouteSlot) => s === 'p' ? t('booking.places.pickupAria') : s === 's' ? t('booking.places.stopAria') : t('booking.places.destinationAria');

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-page text-ink sm:inset-auto sm:bottom-4 sm:start-4 sm:top-4 sm:w-[380px] sm:overflow-hidden sm:rounded-[18px] sm:border sm:border-edge sm:shadow-2xl" style={{ paddingTop: 'env(safe-area-inset-top)' }}
      role="dialog" aria-modal="true" aria-label={t('booking.route.title')} data-testid="route-editor">
      {/* Top bar */}
      <div className="relative flex h-14 shrink-0 items-center justify-center px-3">
        <button type="button" onClick={p.onClose} aria-label={t('booking.route.close')}
          className="absolute start-2 flex h-11 w-11 items-center justify-center rounded-full text-[30px] leading-none text-ink hover:bg-white/5">×</button>
        <h2 className="text-lg font-bold">{t('booking.route.title')}</h2>
      </div>

      {/* Route box + side actions */}
      <div className="flex shrink-0 items-stretch gap-2 px-3 pb-2">
        <div className="relative min-w-0 flex-1 rounded-[16px] border border-edge-strong bg-elevated px-3">
          {/* connector line between the dots */}
          <span aria-hidden className="absolute start-[19px] w-[2px]" style={{ top: 26, height: (p.rows.length - 1) * 53, background: 'rgba(200,255,70,0.45)' }} />
          {p.rows.map((r, i) => (
            <div key={r.slot} className={`relative flex items-center gap-3 ${drag?.index === i ? 'z-20 rounded-[10px] bg-panel opacity-95' : ''}`}
              style={{ borderTop: i ? '1px solid rgba(255,255,255,0.08)' : undefined, transform: drag?.index === i ? `translateY(${drag.dy}px)` : undefined }}>
              <span className="relative z-10 flex w-4 justify-center">{dot(r.slot)}</span>
              <input
                ref={(el) => { inputs.current[r.slot] = el; }}
                value={r.text}
                onChange={(e) => { p.onText(r.slot, e.target.value); if (r.sel) p.onSelect(r.slot, null); search(e.target.value); }}
                onFocus={() => { setActive(r.slot); if (!r.sel) search(r.text); else { setResults([]); setStatus('idle'); } }}
                placeholder={placeholder(r.slot)}
                aria-label={aria(r.slot)}
                autoComplete="off"
                enterKeyHint="search"
                className="h-[52px] min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-muted"
                style={{ fontWeight: active === r.slot ? 600 : 400, outline: 'none', boxShadow: 'none', border: 0 }}
              />
              {/* Small × to wipe what was typed in the active field (2026-11-16) — instead of deleting
                  it letter by letter. Keeps the keyboard open (no blur on press). */}
              {active === r.slot && r.text !== '' && (
                <button type="button" aria-label={t('booking.route.clear')} title={t('booking.route.clear')} data-testid={`route-clear-${r.slot}`}
                  onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { p.onText(r.slot, ''); if (r.sel) p.onSelect(r.slot, null); search(''); inputs.current[r.slot]?.focus({ preventScroll: true }); }}
                  className="flex h-9 w-7 shrink-0 items-center justify-center text-muted hover:text-ink">
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.35" /><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#0E1513" strokeWidth="2.2" strokeLinecap="round" /></svg>
                </button>
              )}
              {active === r.slot && (
                <button type="button" onClick={() => p.onPickOnMap(r.slot)} aria-label={t('booking.form.onMap')} title={t('booking.form.onMap')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-page text-accent">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="6.5" /><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /></svg>
                </button>
              )}
              {r.slot === 's' && (
                <button type="button" onClick={() => { p.onRemoveStop(); setActive('d'); }} aria-label={t('booking.form.removeStop')}
                  className="flex h-9 w-8 shrink-0 items-center justify-center text-[22px] text-muted hover:text-danger">×</button>
              )}
              {p.rows.length > 2 && (
                <button type="button" aria-label={t('booking.form.dragToReorder')}
                  onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag({ index: i, startY: e.clientY, dy: 0 }); }}
                  onPointerMove={(e) => setDrag((d) => (d ? { ...d, dy: e.clientY - d.startY } : d))}
                  onPointerUp={endDrag} onPointerCancel={endDrag}
                  className="flex h-9 w-7 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-[8px] text-xl text-muted">≡</button>
              )}
            </div>
          ))}
        </div>
        {(p.canAddStop || p.rows.length === 2) && <div className="flex w-10 shrink-0 flex-col items-center justify-around">
          {p.canAddStop && (
            <button type="button" onClick={() => { p.onAddStop(); setActive('s'); }} aria-label={t('booking.form.addStop')} title={t('booking.form.addStop')}
              className="flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-white/5">
              <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
            </button>
          )}
          {p.rows.length === 2 && <button type="button" onClick={p.onSwap} aria-label={t('booking.route.swap')} title={t('booking.route.swap')}
            className="flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-white/5">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M8 4v15M4.5 7.5 8 4l3.5 3.5M16 20V5M12.5 16.5 16 20l3.5-3.5" /></svg>
          </button>}
        </div>}
      </div>

      {/* Suggestions */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6" role="listbox" aria-label={t('booking.route.suggestions')}>
        {status === 'loading' && <p className="px-2 py-3 text-sm text-muted">{t('booking.places.searching')}</p>}
        {status === 'none' && <p className="px-2 py-3 text-sm text-muted">{t('booking.places.none')}</p>}
        {status === 'unavailable' && <p className="px-2 py-3 text-sm text-warn">{t('booking.places.unavailable')}</p>}
        {(showSaved ? saved : results).map((r, i) => {
          const [main, sub] = 'name' in r && r.name ? [r.name, r.label] : twoLines(r.label);
          const second = 'secondary' in r && r.secondary ? r.secondary : sub;
          const dist = p.origin && typeof r.lat === 'number' && typeof r.lng === 'number' ? km(p.origin, { lat: r.lat, lng: r.lng }) : null;
          return (
            <button key={`${r.label}-${i}`} type="button" role="option" aria-selected={false} onClick={() => void pick(r)}
              className="flex w-full items-center gap-3 border-b border-edge px-2 py-3 text-start hover:bg-white/5 active:bg-white/5">
              <span className="shrink-0">{icon('icon' in r ? r.icon : 'pin')}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-medium text-ink">{main}</span>
                {second && <span className="block truncate text-[14px] text-muted">{second}</span>}
              </span>
              {dist && <span className="shrink-0 text-[14px] text-muted">{Number(dist).toLocaleString(locale)} {t('booking.route.km')}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
