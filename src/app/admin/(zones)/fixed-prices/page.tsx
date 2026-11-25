'use client';

// Admin «Фиксированные цены» (2026-11-17): draw airport fare zones on a map and set their prices.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamicImport from 'next/dynamic';
import { FoldX, OverMap, PanelHead, useZoneMap } from '@/components/staff/ZoneWorkspace';
import Link from 'next/link';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import type { Poly, RefZone } from '@/components/staff/ZoneEditorMap';
import { untangle } from '@/lib/ring';
import { centroid, growAround, nextBelt, polygonArea, polygonInside, shrinkInto } from '@/lib/zone-shapes';


export const dynamic = 'force-dynamic';

interface Zone { id: string; airport: string; name: string; polygon: Poly; postcodes: string[]; comfortCents: number; xlCents: number; active: boolean }
interface Airport { code: string; lat: number; lng: number; areas?: { name: string; polygon: Poly }[] }
// codes != null → a zone by POSTCODE (no map). inner / outer: the neighbouring zones a belt is bounded by
// (2026-11-21, operator: «пояс регулируется только до куда, а откуда — предыдущим поясом или центром»).
interface Draft { id: string | null; name: string; comfort: string; xl: string; active: boolean; polygon: Poly; codes: string | null; inner: Zone[]; outer: Zone[] }

const COLORS = ['#4C9AFF', '#FFC83D', '#FF7A59', '#B07CFF', '#3DD9C1', '#FF5C93'];
const parseCodes = (v: string) => v.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean);
const AIRPORT_NAMES: Record<string, string> = { PFO: 'Paphos (PFO)', LCA: 'Larnaca (LCA)' };

export default function Page() {
  return <FixedPrices />; // menu + shared map: app/admin/(zones)/layout.tsx
}

function FixedPrices() {
  const { t } = useT();
  const [airports, setAirports] = useState<Airport[]>([]);
  // Pickup territories by name — one is chosen as «the point» of this airport's fixed fares (2026-11-25).
  const [territories, setTerritories] = useState<{ id: string; name: string; airport: string | null }[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [code, setCode] = useState('PFO');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // «↶ Шаг назад» on the map (2026-11-21, operator): every corner change (add, drag, insert, remove, clear) can be
  // undone one step at a time. A continuous drag (many changes in a row) counts as ONE step.
  const hist = useRef<Poly[]>([]);
  const lastChange = useRef(0);
  const [histLen, setHistLen] = useState(0);
  const polyNow = useRef<Poly>([]);
  useEffect(() => { polyNow.current = draft?.polygon ?? []; }, [draft]);
  const setPoly = useCallback((next: Poly) => {
    const now = Date.now();
    if (now - lastChange.current > 600) { hist.current.push(polyNow.current); if (hist.current.length > 100) hist.current.shift(); }
    lastChange.current = now;
    polyNow.current = next;
    setHistLen(hist.current.length);
    setDraft((d) => (d ? { ...d, polygon: next } : d));
  }, []);
  const stepBack = () => {
    const prev = hist.current.pop();
    setHistLen(hist.current.length);
    lastChange.current = 0;
    if (prev) setDraft((d) => (d ? { ...d, polygon: prev } : d));
  };
  const resetHist = () => { hist.current = []; lastChange.current = 0; setHistLen(0); };

  const load = useCallback(async () => {
    const r = await api<{ airports: Airport[]; territories?: { id: string; name: string; airport: string | null }[]; zones: Zone[] }>('/admin/fixed-zones');
    setAirports(r.airports);
    setTerritories(r.territories ?? []);
    setZones(r.zones);
  }, []);
  useEffect(() => { void load().catch((e) => setMsg(e instanceof ApiRequestError ? e.body.message : String(e))); }, [load]);

  const ap = airports.find((a) => a.code === code) ?? { code, lat: 34.718, lng: 32.4857 };
  const center = useMemo(() => ({ lat: ap.lat + 0.04, lng: ap.lng - 0.04 }), [ap.lat, ap.lng]);
  // Smallest first: centre, then each next belt outwards (the price that applies is the smallest zone around the address).
  const mineAll = zones.filter((z) => z.airport === code);
  const mine = mineAll.filter((z) => z.polygon.length >= 3).sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon));
  const byCode = mineAll.filter((z) => z.polygon.length < 3);
  const euroS = (c: number) => (c / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  // A belt is drawn as a band: the zones inside it are cut out (only the direct ones, not zones inside those).
  const holesOf = (z: { id: string; polygon: Poly }, all: { id: string; polygon: Poly }[]) => {
    const inside = all.filter((o) => o.id !== z.id && polygonInside(o.polygon, z.polygon));
    return inside.filter((o) => !inside.some((q) => q.id !== o.id && polygonInside(o.polygon, q.polygon))).map((o) => o.polygon);
  };
  // Price label: on a belt at its top edge (its middle is the zone inside it), otherwise in the middle.
  const labelAt = (poly: Poly, belt: boolean): [number, number] | undefined => {
    if (poly.length < 3) return undefined;
    if (belt) return poly.reduce((a, p) => (p[0] > a[0] ? p : a), poly[0]);
    return centroid(poly);
  };
  const others = mine.filter((z) => z.id !== draft?.id);
  const directInner = (poly: Poly, all: Zone[]) => {
    const inside = all.filter((o) => polygonInside(o.polygon, poly));
    return inside.filter((o) => !inside.some((q) => q.id !== o.id && polygonInside(o.polygon, q.polygon)));
  };
  const directOuter = (poly: Poly, all: Zone[]) => {
    const around = all.filter((o) => polygonInside(poly, o.polygon));
    return around.filter((o) => !around.some((q) => q.id !== o.id && polygonInside(q.polygon, o.polygon)));
  };
  // Neighbours follow the zone being edited (2026-11-21, operator): the belt pulled into the zone inside → that zone
  // shrinks a little there; a zone pulled out over its belt → the belt widens there. Derived only from the edited
  // polygon and the neighbours as they were, so «↶ Шаг назад» brings the neighbours back too.
  const adjusted = useMemo(() => {
    const m = new Map<string, Poly>();
    if (!draft || draft.codes != null || draft.polygon.length < 3) return m;
    for (const z of draft.inner) { const q = shrinkInto(z.polygon, draft.polygon); if (q !== z.polygon) m.set(z.id, q); }
    for (const z of draft.outer) { const q = growAround(z.polygon, draft.polygon); if (q !== z.polygon) m.set(z.id, q); }
    return m;
  }, [draft]);
  const othersNow = others.map((z) => (adjusted.has(z.id) ? { ...z, polygon: adjusted.get(z.id)! } : z));
  // The airport itself (2026-11-25): the pickup territory marked as this airport, in white — no 2.5 km circle any more.
  const airportZones: RefZone[] = (ap.areas ?? []).map((a, i) => ({ id: `airport-${i}`, name: a.name, polygon: a.polygon, color: '#ffffff', label: a.name, labelAt: labelAt(a.polygon, false) }));
  const refZones: RefZone[] = [...airportZones, ...othersNow.map((z) => {
    const holes = holesOf(z, othersNow);
    return { id: z.id, name: z.name, polygon: z.polygon, holes, color: z.active ? COLORS[mine.findIndex((o) => o.id === z.id) % COLORS.length] : '#8A969A',
      strong: adjusted.has(z.id), label: `${z.name} · ${euroS(z.comfortCents)} €`, labelAt: labelAt(z.polygon, holes.length > 0) };
  })];
  // Postcode zones on the map (2026-11-21): the outline of our addresses with that postcode, in pink.
  const [areas, setAreas] = useState<Record<string, Poly | null>>({});
  const draftCodes = draft?.codes != null ? parseCodes(draft.codes).filter((c) => /^\d{4,5}$/.test(c)) : [];
  const wantCodes = [...new Set([...byCode.flatMap((z) => z.postcodes), ...draftCodes])].filter((c) => !(c in areas)).sort().join(',');
  useEffect(() => {
    if (!wantCodes) return;
    const id = setTimeout(() => {
      api<{ areas: Record<string, Poly | null> }>(`/admin/fixed-zones/postcode-areas?codes=${wantCodes}`).then((r) => setAreas((a) => ({ ...a, ...r.areas }))).catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [wantCodes]);
  const PINK = '#F472D0';
  for (const z of byCode) {
    if (z.id === draft?.id) continue;
    for (const c of z.postcodes) {
      const a = areas[c];
      if (a && a.length >= 3) refZones.push({ id: `${z.id}-${c}`, name: z.name, polygon: a, color: z.active ? PINK : '#8A969A', label: `📮 ${c} · ${euroS(z.comfortCents)} €`, labelAt: centroid(a) });
    }
  }
  for (const c of draftCodes) {
    const a = areas[c];
    if (a && a.length >= 3) refZones.push({ id: `draft-${c}`, name: c, polygon: a, color: PINK, strong: true, label: `📮 ${c} · ${draft?.comfort ?? ''} €`, labelAt: centroid(a) });
  }
  // Show all zones of this airport (and the one being drawn) when switching airport or starting a zone.
  const fitMode = `${code}|${draft ? (draft.id ?? 'new') : ''}|${mine.length}`;
  const fit = useMemo<[number, number, number, number]>(() => {
    const pts = [...mine.flatMap((z) => z.polygon), ...(draft?.polygon ?? []), [ap.lat - 0.05, ap.lng - 0.05], [ap.lat + 0.05, ap.lng + 0.05]] as Poly;
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitMode, ap.lat, ap.lng]);
  const outermost = mine.filter((z) => z.active).reduce<Zone | null>((a, z) => (!a || polygonArea(z.polygon) > polygonArea(a.polygon) ? z : a), null);

  const euro = (c: number) => (c / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const cents = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);

  function startNew() { setMsg(null); resetHist(); setDraft({ id: null, name: '', comfort: '35', xl: '50', active: true, polygon: [], codes: null, inner: [], outer: [] }); }
  // «+ По индексу» (2026-11-21, operator): a fixed price for addresses with these postcodes — no drawing.
  function startCodes() { setMsg(null); resetHist(); setDraft({ id: null, name: '', comfort: '45', xl: '65', active: true, polygon: [], codes: '', inner: [], outer: [] }); }
  // «+ Следующий пояс» (2026-11-21, operator): starts exactly on the edge of the outermost zone and goes 3 km further
  // out, with many corners to drag. Inside it the previous zones keep their prices (the smallest zone wins).
  function startBelt() {
    if (!outermost) return;
    setMsg(null); resetHist();
    const n = mine.length + 1;
    setDraft({ id: null, name: t('staff.fixed.beltN', { n }), comfort: euroS(outermost.comfortCents + 1000), xl: euroS(outermost.xlCents + 1500), active: true, polygon: nextBelt(outermost.polygon, 3000), codes: null, inner: [outermost], outer: [] });
  }
  function startEdit(z: Zone) {
    setMsg(null); resetHist();
    const rest = mine.filter((o) => o.id !== z.id);
    const isCode = z.polygon.length < 3;
    setDraft({ id: z.id, name: z.name, comfort: euro(z.comfortCents), xl: euro(z.xlCents), active: z.active, polygon: isCode ? [] : untangle(z.polygon), // an old figure-8 opens as one loop (2026-11-24)
      codes: isCode ? z.postcodes.join(', ') : null, inner: isCode ? [] : directInner(z.polygon, rest), outer: isCode ? [] : directOuter(z.polygon, rest) });
  }


  async function save() {
    if (!draft) return;
    const codes = draft.codes != null ? parseCodes(draft.codes) : null;
    if (codes) {
      if (!codes.length || codes.some((c) => !/^\d{4,5}$/.test(c))) { setMsg(t('staff.fixed.needCodes')); return; }
    } else {
      if (draft.polygon.length < 3) { setMsg(t('staff.fixed.needPoints')); return; }
      // A belt keeps its neighbours: the zone inside must stay inside, and it must stay inside the belt around it.
      const cut = draft.inner.find((o) => !polygonInside(adjusted.get(o.id) ?? o.polygon, draft.polygon));
      if (cut) { setMsg(t('staff.fixed.beltCutsInner', { name: cut.name })); return; }
      const out = draft.outer.find((o) => !polygonInside(draft.polygon, adjusted.get(o.id) ?? o.polygon));
      if (out) { setMsg(t('staff.fixed.zoneLeavesOuter', { name: out.name })); return; }
    }
    const c = cents(draft.comfort), x = cents(draft.xl);
    if (!(c > 0) || !(x > 0)) { setMsg(t('staff.fixed.needPrice')); return; }
    setBusy(true); setMsg(null);
    try {
      const body = { airport: code, name: draft.name.trim() || (codes ? codes.join(', ') : `Zone ${mine.length + 1}`), comfortCents: c, xlCents: x, active: draft.active,
        ...(codes ? { postcodes: codes } : { polygon: draft.polygon, postcodes: [] }) };
      if (draft.id) await api(`/admin/fixed-zones/${draft.id}`, { method: 'PUT', body });
      else await api('/admin/fixed-zones', { method: 'POST', body });
      // The neighbours that moved with it (pulled in / pushed out) are saved too.
      for (const z of [...draft.inner, ...draft.outer]) {
        const q = adjusted.get(z.id);
        if (q) await api(`/admin/fixed-zones/${z.id}`, { method: 'PUT', body: { airport: z.airport, name: z.name, polygon: q, postcodes: [], comfortCents: z.comfortCents, xlCents: z.xlCents, active: z.active } });
      }
      setDraft(null); setMsg(t('staff.fixed.saved'));
      await load();
    } catch (e) { setMsg(e instanceof ApiRequestError ? e.body.message : String(e)); }
    finally { setBusy(false); }
  }

  async function remove(z: Zone) {
    if (!window.confirm(t('staff.fixed.deleteConfirm', { name: z.name }))) return;
    await api(`/admin/fixed-zones/${z.id}`, { method: 'DELETE' }).catch(() => null);
    if (draft?.id === z.id) setDraft(null);
    await load();
  }

  async function toggle(z: Zone) {
    await api(`/admin/fixed-zones/${z.id}`, { method: 'PUT', body: { airport: z.airport, name: z.name, ...(z.polygon.length >= 3 ? { polygon: z.polygon } : {}), postcodes: z.postcodes, comfortCents: z.comfortCents, xlCents: z.xlCents, active: !z.active } }).catch(() => null);
    await load();
  }

  // The tab draws on the shared map of the zone tabs (2026-11-25).
  useZoneMap({ center: center, zones: refZones, editing: draft && draft.codes == null ? draft.polygon : null, editingHoles: draft?.inner.map((o) => adjusted.get(o.id) ?? o.polygon), onChange: setPoly, fit: fit });

  return (
    <div>
      <PanelHead title={t('staff.fixed.title')} info={t('staff.fixed.sub')} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{t('staff.fixed.airport')}:</span>
        {(airports.length ? airports : [{ code: 'PFO' }, { code: 'LCA' }]).map((a) => (
          <button key={a.code} type="button" onClick={() => { setCode(a.code); setDraft(null); }}
            className={`rounded-full border px-3 py-1.5 text-sm ${code === a.code ? 'border-accent bg-accent/15 text-accent' : 'border-edge text-ink'}`}>{AIRPORT_NAMES[a.code] ?? a.code}</button>
        ))}
        {!draft && (
          <div className="ms-auto flex gap-2">
            {outermost && <button type="button" onClick={startBelt} className="btn-primary !min-h-[40px] !py-2 text-sm" data-testid="belt-new">{t('staff.fixed.nextBelt')}</button>}
            <button type="button" onClick={startNew} className={`${outermost ? 'btn-ghost' : 'btn-primary'} !min-h-[40px] !py-2 text-sm`} data-testid="zone-new">{t('staff.fixed.newZone')}</button>
            <button type="button" onClick={startCodes} className="btn-ghost !min-h-[40px] !py-2 text-sm" data-testid="codes-new">{t('staff.fixed.byCode')}</button>
          </div>
        )}
      </div>

      {/* «Выберите точку к этим фикс ценам на выезд и въезд» (operator 2026-11-25): a pickup territory by name. */}
      <label className="mt-3 flex flex-wrap items-center gap-2 text-sm" data-testid="airport-point">
        <span className="text-muted">{t('staff.fixed.point')}:</span>
        <select className="field !min-h-[40px] !w-auto !py-1.5" value={territories.find((x) => x.airport === code)?.id ?? ''} data-testid="airport-point-select"
          onChange={async (e) => {
            setMsg(null);
            try { await api('/admin/fixed-zones/airport-area', { method: 'PUT', body: { airport: code, territoryId: e.target.value || null } }); await load(); }
            catch (err) { setMsg(err instanceof ApiRequestError ? err.body.message : String(err)); }
          }}>
          <option value="">{t('staff.fixed.pointNone')}</option>
          {territories.map((x) => (
            <option key={x.id} value={x.id}>{x.name}{x.airport && x.airport !== code ? ` (${AIRPORT_NAMES[x.airport] ?? x.airport})` : ''}</option>
          ))}
        </select>
        {!territories.length && <Link href="/admin/pickup-points" className="font-semibold text-accent">{t('staff.fixed.toPickupPoints')} ›</Link>}
      </label>
      {airports.length > 0 && !(ap.areas ?? []).length && (
        <p className="mt-2 rounded-[10px] border border-warn/50 bg-warn/10 p-3 text-sm" data-testid="no-airport-area">{t('staff.fixed.noAirportArea')}</p>
      )}

      <div className="mt-3">
        <OverMap>
          
          {draft && draft.codes == null && (
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start gap-2">
              <button type="button" onClick={stepBack} disabled={histLen === 0} data-testid="zone-step-back" aria-label={t('staff.fixed.stepBack')}
                className="pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-[10px] bg-accent px-3 py-2 text-sm font-semibold text-[#0b0f10] shadow-lg disabled:bg-page/90 disabled:text-muted">
                <span className="text-lg leading-none">↶</span>{t('staff.fixed.stepBack')}
              </button>
              <div className="min-w-0 flex-1 rounded-[10px] bg-page/90 px-3 py-2 text-xs text-ink" data-testid="zone-hint">{draft.inner.length
                ? t('staff.fixed.beltHint', { name: draft.inner.map((o) => o.name).join(', ') })
                : t('staff.fixed.hint')}</div>
            </div>
          )}
        
        </OverMap>

        <div className="space-y-3">
          {draft && (
            <div className="card relative space-y-3 p-4" data-testid="zone-form">
              <FoldX />
              <label className="block text-sm">{t('staff.fixed.name')}
                <input className="field mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Paphos — centre" data-testid="zone-name" />
              </label>
              {draft.codes != null && (
                <label className="block text-sm">{t('staff.fixed.codes')}
                  <input className="field mt-1" inputMode="numeric" value={draft.codes} onChange={(e) => setDraft({ ...draft, codes: e.target.value })} placeholder="8560, 8561" data-testid="zone-codes" />
                  <span className="mt-1 block text-xs text-muted">{t('staff.fixed.codesHint')}</span>
                </label>
              )}
              {draft.inner.length > 0 && <p className="text-xs text-muted" data-testid="belt-from">{t('staff.fixed.beltFrom', { name: draft.inner.map((o) => o.name).join(', ') })}</p>}
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">{t('staff.fixed.comfort')}
                  <input className="field mt-1" inputMode="decimal" value={draft.comfort} onChange={(e) => setDraft({ ...draft, comfort: e.target.value })} data-testid="zone-comfort" />
                </label>
                <label className="block text-sm">{t('staff.fixed.xl')}
                  <input className="field mt-1" inputMode="decimal" value={draft.xl} onChange={(e) => setDraft({ ...draft, xl: e.target.value })} data-testid="zone-xl" />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />{t('staff.fixed.active')}</label>
              {draft.codes == null && <div className="text-xs text-muted">{t('staff.fixed.points', { n: draft.polygon.length })}</div>}
              {draft.codes == null && <div className="flex gap-2">
                <button type="button" className="btn-ghost !min-h-[40px] flex-1 !py-2 text-sm" disabled={!draft.polygon.length} onClick={() => { lastChange.current = 0; setPoly(draft.polygon.slice(0, -1)); }} data-testid="zone-undo">{t('staff.fixed.undo')}</button>
                <button type="button" className="btn-ghost !min-h-[40px] !py-2 text-sm" disabled={!draft.polygon.length} onClick={() => { lastChange.current = 0; setPoly([]); }}>{t('staff.fixed.clear')}</button>
              </div>}
              <div className="flex gap-2">
                <button type="button" className="btn-ghost !min-h-[44px] !py-2 text-sm" onClick={() => setDraft(null)}>{t('staff.fixed.cancel')}</button>
                <button type="button" className="btn-primary !min-h-[44px] flex-1 !py-2 text-sm" disabled={busy} onClick={save} data-testid="zone-save">{t('staff.fixed.save')}</button>
              </div>
            </div>
          )}
          {msg && <p className="text-sm text-muted" data-testid="zone-msg">{msg}</p>}

          {mineAll.length === 0 && !draft && <p className="text-sm text-muted">{t('staff.fixed.empty')}</p>}
          {[...byCode, ...mine].map((z) => (
            <div key={z.id} className={`card p-3 ${draft?.id === z.id ? 'border-accent' : ''}`} data-testid="zone-row">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: !z.active ? '#8A969A' : z.polygon.length < 3 ? '#C8FF46' : COLORS[mine.indexOf(z) % COLORS.length] }} />
                <span className="min-w-0 flex-1 truncate font-semibold">{z.name}</span>
                {z.polygon.length < 3 && <span className="shrink-0 text-xs text-muted" data-testid="zone-codes-chip">📮 {z.postcodes.join(', ')}</span>}
                {!z.active && <span className="text-xs text-muted">{t('staff.fixed.off')}</span>}
              </div>
              <div className="mt-1 text-sm tabular-nums">Comfort {euro(z.comfortCents)} € · XL {euro(z.xlCents)} €</div>
              {z.polygon.length < 3 && z.postcodes.some((c) => areas[c] === null) && (
                <div className="mt-1 text-xs text-muted">{t('staff.fixed.codesNoArea', { codes: z.postcodes.filter((c) => areas[c] === null).join(', ') })}</div>
              )}
              <div className="mt-2 flex gap-2 text-sm">
                <button type="button" className="text-accent" onClick={() => startEdit(z)}>{t('staff.fixed.edit')}</button>
                <button type="button" className="text-muted" onClick={() => toggle(z)}>{z.active ? t('staff.deactivate') : t('staff.activate')}</button>
                <button type="button" className="ms-auto text-danger" onClick={() => remove(z)}>{t('staff.fixed.delete')}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
