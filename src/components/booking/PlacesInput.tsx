'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';

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

interface Result {
  label: string;
  lat: number;
  lng: number;
  kind: string;
}

export function PlacesInput({ kind, value, text, onText, onSelect, error }: Props) {
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demo, setDemo] = useState(false);
  const [status, setStatus] = useState<'idle' | 'none' | 'unavailable'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Invalidate any pending timer/request so no later response can apply. Called on
  // every edit, on selection, and on unmount.
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
      invalidatePending(); // cleanup on unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the parent resolves this field (map pin / swap), close and cancel pending.
  useEffect(() => {
    if (value) { invalidatePending(); setOpen(false); setResults([]); setStatus('idle'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleText(t: string) {
    onText(t);
    // Editing the text invalidates a prior resolved selection (SPEC §3.2) AND any
    // in-flight search — bump request identity FIRST, including when clearing.
    if (value) onSelect(null);
    invalidatePending();
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
        const res = await api<{ demo: boolean; results: Result[]; unavailable?: boolean }>(
          `/places/search?q=${encodeURIComponent(t)}`,
          { signal: controller.signal, timeoutMs: 6000 },
        );
        if (my !== reqSeq.current) return; // superseded
        setResults(res.results);
        setDemo(res.demo);
        setStatus(res.unavailable ? 'unavailable' : res.results.length ? 'idle' : 'none');
        setOpen(true);
      } catch {
        if (my === reqSeq.current) { setResults([]); setStatus('unavailable'); setOpen(true); }
      } finally {
        if (my === reqSeq.current) setLoading(false);
      }
    }, 250);
  }

  return (
    <div ref={boxRef} className="relative">
      <label className="label">{kind}</label>
      <input
        className={`field mt-1 ${error ? 'border-danger' : value ? 'border-accent/60' : ''}`}
        placeholder={kind === 'From' ? 'Pickup location' : 'Destination'}
        value={text}
        onChange={(e) => handleText(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        autoComplete="off"
        aria-invalid={!!error}
      />
      {value && (
        <span className="absolute right-3 top-9 text-accent text-sm" aria-hidden>
          ✓
        </span>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {open && (results.length > 0 || loading || status !== 'idle') && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-[12px] border border-edge bg-elevated shadow-card">
          {loading && <div className="px-4 py-3 text-sm text-muted">Searching…</div>}
          {!loading && status === 'none' && <div className="px-4 py-3 text-sm text-muted">No matching places.</div>}
          {!loading && status === 'unavailable' && <div className="px-4 py-3 text-sm text-warn">Address search is unavailable — pan the map to choose instead.</div>}
          {!loading &&
            results.map((r) => (
              <button
                key={`${r.label}-${r.lat}`}
                type="button"
                className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-panel"
                onClick={() => {
                  invalidatePending(); // no later search response can reopen this
                  onSelect({ lat: r.lat, lng: r.lng, label: r.label });
                  onText(r.label);
                  setOpen(false);
                  setResults([]);
                  setStatus('idle');
                }}
              >
                <span className="mt-0.5 text-accent">◈</span>
                <span className="text-sm text-ink">{r.label}</span>
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
