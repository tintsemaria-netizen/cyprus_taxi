'use client';

import { useEffect, useRef, useState } from 'react';
import { api, uuid } from '@/lib/api-client';

export interface Selected {
  lat: number;
  lng: number;
  label: string;
}

interface Props {
  kind: 'From' | 'To';
  value: Selected | null;
  text: string;
  onText: (t: string) => void;
  onSelect: (s: Selected | null) => void;
  error?: string;
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

export function PlacesInput({ kind, value, text, onText, onSelect, error }: Props) {
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demo, setDemo] = useState(false);
  const [status, setStatus] = useState<'idle' | 'none' | 'unavailable'>('idle');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (value) { invalidatePending(); setOpen(false); setResults([]); setStatus('idle'); setActive(-1); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          `/places/search?q=${encodeURIComponent(t)}&session=${sessionToken()}`,
          { signal: controller.signal, timeoutMs: 6000 },
        );
        if (my !== reqSeq.current) return; // superseded
        setResults(res.results);
        setDemo(res.demo);
        setStatus(res.unavailable ? 'unavailable' : res.results.length ? 'idle' : 'none');
        setActive(-1);
        setOpen(true);
      } catch {
        if (my === reqSeq.current) { setResults([]); setStatus('unavailable'); setOpen(true); }
      } finally {
        if (my === reqSeq.current) setLoading(false);
      }
    }, 250);
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
      } catch {
        picked = null;
      }
    }
    sessionRef.current = ''; // end the Places session after a resolution attempt
    if (!picked) { setStatus('unavailable'); setOpen(true); return; }
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

  return (
    <div ref={boxRef} className="relative">
      <label className="label">{kind}</label>
      <input
        className={`field mt-1 ${error ? 'border-danger' : value ? 'border-accent/60' : ''}`}
        placeholder={kind === 'From' ? 'Pickup location' : 'Destination'}
        value={text}
        onChange={(e) => handleText(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => results.length && setOpen(true)}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-invalid={!!error}
      />
      {value && (
        <span className="absolute right-3 top-9 text-accent text-sm" aria-hidden>
          ✓
        </span>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {open && (results.length > 0 || loading || status !== 'idle') && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-[12px] border border-edge bg-elevated shadow-card" role="listbox">
          {loading && <div className="px-4 py-3 text-sm text-muted">Searching…</div>}
          {!loading && status === 'none' && <div className="px-4 py-3 text-sm text-muted">No matching places.</div>}
          {!loading && status === 'unavailable' && <div className="px-4 py-3 text-sm text-warn">Address search is unavailable — pan the map to choose instead.</div>}
          {!loading &&
            results.map((r, i) => (
              <button
                key={`${r.placeId ?? r.label}-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                className={`flex w-full items-start gap-2 px-4 py-2.5 text-left ${i === active ? 'bg-panel' : 'hover:bg-panel'}`}
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
          {!loading && demo && results.length > 0 && (
            <div className="border-t border-edge px-4 py-1.5 text-[10px] text-muted">Demo places · Cyprus fixtures</div>
          )}
        </div>
      )}
    </div>
  );
}
