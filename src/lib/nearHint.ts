// Where the passenger is (2026-11-18): address search ranks places near this point first.
// Set by the booking screen when the position / pickup is known; read by every address search.
let hint: { lat: number; lng: number } | null = null;
export function setNearHint(p: { lat: number; lng: number } | null | undefined): void { if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) hint = { lat: p.lat, lng: p.lng }; }
export function nearParam(p?: { lat: number; lng: number } | null): string {
  const h = p ?? hint;
  return h ? `&near=${h.lat.toFixed(4)},${h.lng.toFixed(4)}` : '';
}

/** Lower-case, no accents, Greek letters to Latin — «Αγίας» and «agias» match each other. */
export function foldText(s: string): string {
  const gr: Record<string, string> = { α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o' };
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[α-ω]/g, (c) => gr[c] ?? c).replace(/\s+/g, ' ').trim();
}

/** Own places / recent trips whose name or address contains every typed word (instant, no network). */
export function localMatches<T extends { label: string; name?: string }>(items: T[], query: string, max = 4): T[] {
  const words = foldText(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const hay = foldText(`${it.name ?? ''} ${it.label}`);
    if (!words.every((w) => hay.includes(w))) continue;
    const k = foldText(it.label);
    if (seen.has(k)) continue;
    seen.add(k); out.push(it);
    if (out.length >= max) break;
  }
  return out;
}
