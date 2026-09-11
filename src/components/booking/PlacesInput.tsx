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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function handleText(t: string) {
    onText(t);
    // Editing the text invalidates a prior resolved selection (SPEC §3.2).
    if (value) onSelect(null);
    if (timer.current) clearTimeout(timer.current);
    if (t.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const my = ++reqSeq.current;
    timer.current = setTimeout(async () => {
      try {
        const res = await api<{ demo: boolean; results: Result[] }>(`/places/search?q=${encodeURIComponent(t)}`);
        if (my !== reqSeq.current) return; // a newer query superseded this one
        setResults(res.results);
        setDemo(res.demo);
        setOpen(true);
      } catch {
        if (my === reqSeq.current) setResults([]);
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
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-[12px] border border-edge bg-elevated shadow-card">
          {loading && <div className="px-4 py-3 text-sm text-muted">Searching…</div>}
          {!loading &&
            results.map((r) => (
              <button
                key={`${r.label}-${r.lat}`}
                type="button"
                className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-panel"
                onClick={() => {
                  onSelect({ lat: r.lat, lng: r.lng, label: r.label });
                  onText(r.label);
                  setOpen(false);
                }}
              >
                <span className="mt-0.5 text-accent">◈</span>
                <span className="text-sm text-ink">{r.label}</span>
              </button>
            ))}
          {!loading && demo && (
            <div className="border-t border-edge px-4 py-1.5 text-[10px] text-muted">Demo places · Cyprus fixtures</div>
          )}
        </div>
      )}
    </div>
  );
}
