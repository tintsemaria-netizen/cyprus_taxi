'use client';

// Admin «Фиксированные цены» (2026-11-17): draw airport fare zones on a map and set their prices.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamicImport from 'next/dynamic';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import type { Poly, RefZone } from '@/components/staff/ZoneEditorMap';
import { circlePolygon } from '@/lib/zone-shapes';
import { haversineMeters } from '@/lib/geo';

const ZoneEditorMap = dynamicImport(() => import('@/components/staff/ZoneEditorMap'), { ssr: false });

export const dynamic = 'force-dynamic';

interface Zone { id: string; airport: string; name: string; polygon: Poly; radiusM: number | null; comfortCents: number; xlCents: number; active: boolean }
interface Airport { code: string; lat: number; lng: number }
// radiusKm set = a price RING around the airport (2026-11-21); null = a zone drawn corner by corner.
interface Draft { id: string | null; name: string; comfort: string; xl: string; active: boolean; polygon: Poly; radiusKm: string | null }

const COLORS = ['#4C9AFF', '#FFC83D', '#FF7A59', '#B07CFF', '#3DD9C1', '#FF5C93'];
const AIRPORT_NAMES: Record<string, string> = { PFO: 'Paphos (PFO)', LCA: 'Larnaca (LCA)' };

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <FixedPrices />}</StaffShell>;
}

function FixedPrices() {
  const { t } = useT();
  const [airports, setAirports] = useState<Airport[]>([]);
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
    const r = await api<{ airports: Airport[]; zones: Zone[] }>('/admin/fixed-zones');
    setAirports(r.airports);
    setZones(r.zones);
  }, []);
  useEffect(() => { void load().catch((e) => setMsg(e instanceof ApiRequestError ? e.body.message : String(e))); }, [load]);

  const ap = airports.find((a) => a.code === code) ?? { code, lat: 34.718, lng: 32.4857 };
  const center = useMemo(() => ({ lat: ap.lat + 0.04, lng: ap.lng - 0.04 }), [ap.lat, ap.lng]);
  // Rings first, smallest → largest, then drawn zones (the list reads «до 5 км, до 10 км, …»).
  const mine = zones.filter((z) => z.airport === code).sort((a, b) => (a.radiusM ?? 1e9) - (b.radiusM ?? 1e9));
  const euroS = (c: number) => (c / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const kmS = (m: number) => (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
  // Price label: on a ring at its top edge, on a drawn zone at its middle.
  const labelAt = (poly: Poly, radiusM: number | null): [number, number] | undefined => {
    if (!poly.length) return undefined;
    if (radiusM) return [ap.lat + radiusM / 111_320, ap.lng];
    return [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
  };
  const zoneLabel = (radiusM: number | null, cents: number, name: string) => (radiusM ? `${t('staff.fixed.upTo', { km: kmS(radiusM) })} · ${euroS(cents)} €` : `${name} · ${euroS(cents)} €`);
  const draftRadiusM = draft?.radiusKm != null ? Math.round(Number(draft.radiusKm.replace(',', '.')) * 1000) : null;
  const draftRingPoly: Poly = draftRadiusM && draftRadiusM >= 500 ? circlePolygon(ap, draftRadiusM) : [];
  const refZones: RefZone[] = [
    ...mine.filter((z) => z.id !== draft?.id).map((z) => ({
      id: z.id, name: z.name, polygon: z.polygon, color: z.active ? COLORS[mine.indexOf(z) % COLORS.length] : '#8A969A',
      label: zoneLabel(z.radiusM, z.comfortCents, z.name), labelAt: labelAt(z.polygon, z.radiusM),
    })),
    ...(draft && draft.radiusKm != null && draftRingPoly.length ? [{
      id: 'draft-ring', name: draft.name, polygon: draftRingPoly, color: '#C8FF46', strong: true,
      label: zoneLabel(draftRadiusM, Math.round(Number(draft.comfort.replace(',', '.')) * 100) || 0, draft.name), labelAt: labelAt(draftRingPoly, draftRadiusM),
    }] : []),
  ];
  // Fit the map to the biggest ring (incl. the one being set) when switching airport or opening a ring — not on
  // every slider move, so the map does not jump while you drag.
  const fitR = Math.max(6000, ...mine.map((z) => z.radiusM ?? 0), draft?.radiusKm != null ? (draftRadiusM ?? 0) : 0) * 1.08;
  const fitMode = `${code}|${draft ? (draft.id ?? 'new') : ''}|${draft?.radiusKm != null}|${mine.length}`;
  const fit = useMemo<[number, number, number, number]>(() => {
    const dLat = fitR / 111_320, dLng = fitR / (111_320 * Math.cos((ap.lat * Math.PI) / 180));
    return [ap.lat - dLat, ap.lng - dLng, ap.lat + dLat, ap.lng + dLng];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitMode, ap.lat, ap.lng]);
  // Ring mode: a click on the map puts the ring's edge through that point.
  const pickRingEdge = (lat: number, lng: number) => {
    if (!draft || draft.radiusKm == null) return;
    const km = Math.max(0.5, Math.min(80, haversineMeters({ lat: ap.lat, lng: ap.lng }, { lat, lng }) / 1000));
    setDraft({ ...draft, radiusKm: (Math.round(km * 10) / 10).toString() });
  };

  const euro = (c: number) => (c / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const cents = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);

  function startNew() { setMsg(null); resetHist(); setDraft({ id: null, name: '', comfort: '35', xl: '50', active: true, polygon: [], radiusKm: null }); }
  function startRing() {
    setMsg(null); resetHist();
    const biggest = Math.max(0, ...mine.map((z) => z.radiusM ?? 0));
    const km = biggest ? Math.min(80, biggest / 1000 + 5) : 5;
    setDraft({ id: null, name: '', comfort: '35', xl: '50', active: true, polygon: [], radiusKm: String(km) });
  }
  function startEdit(z: Zone) { setMsg(null); resetHist(); setDraft({ id: z.id, name: z.name, comfort: euro(z.comfortCents), xl: euro(z.xlCents), active: z.active, polygon: z.radiusM ? [] : z.polygon, radiusKm: z.radiusM ? String(z.radiusM / 1000) : null }); }

  async function save() {
    if (!draft) return;
    if (draft.radiusKm == null && draft.polygon.length < 3) { setMsg(t('staff.fixed.needPoints')); return; }
    if (draft.radiusKm != null && !(draftRadiusM && draftRadiusM >= 500 && draftRadiusM <= 80_000)) { setMsg(t('staff.fixed.needRadius')); return; }
    const c = cents(draft.comfort), x = cents(draft.xl);
    if (!(c > 0) || !(x > 0)) { setMsg(t('staff.fixed.needPrice')); return; }
    setBusy(true); setMsg(null);
    try {
      const ring = draft.radiusKm != null;
      const body = { airport: code, name: draft.name.trim() || (ring ? t('staff.fixed.upTo', { km: kmS(draftRadiusM!) }) : `Zone ${mine.length + 1}`), comfortCents: c, xlCents: x, active: draft.active,
        ...(ring ? { radiusM: draftRadiusM } : { polygon: draft.polygon, radiusM: null }) };
      if (draft.id) await api(`/admin/fixed-zones/${draft.id}`, { method: 'PUT', body });
      else await api('/admin/fixed-zones', { method: 'POST', body });
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
    await api(`/admin/fixed-zones/${z.id}`, { method: 'PUT', body: { airport: z.airport, name: z.name, ...(z.radiusM ? { radiusM: z.radiusM } : { polygon: z.polygon }), comfortCents: z.comfortCents, xlCents: z.xlCents, active: !z.active } }).catch(() => null);
    await load();
  }

  return (
    <div className="mx-auto max-w-6xl p-4">
      <h1 className="text-xl font-semibold">{t('staff.fixed.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('staff.fixed.sub')}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{t('staff.fixed.airport')}:</span>
        {(airports.length ? airports : [{ code: 'PFO' }, { code: 'LCA' }]).map((a) => (
          <button key={a.code} type="button" onClick={() => { setCode(a.code); setDraft(null); }}
            className={`rounded-full border px-3 py-1.5 text-sm ${code === a.code ? 'border-accent bg-accent/15 text-accent' : 'border-edge text-ink'}`}>{AIRPORT_NAMES[a.code] ?? a.code}</button>
        ))}
        {!draft && (
          <div className="ms-auto flex gap-2">
            <button type="button" onClick={startRing} className="btn-primary !min-h-[40px] !py-2 text-sm" data-testid="ring-new">{t('staff.fixed.newRing')}</button>
            <button type="button" onClick={startNew} className="btn-ghost !min-h-[40px] !py-2 text-sm" data-testid="zone-new">{t('staff.fixed.newZone')}</button>
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="relative h-[62vh] min-h-[380px] overflow-hidden rounded-[14px] border border-edge">
          <ZoneEditorMap center={center} airport={ap} zones={refZones} editing={draft && draft.radiusKm == null ? draft.polygon : null}
            onChange={setPoly} onPick={pickRingEdge} fit={fit} className="h-full w-full" />
          {draft && draft.radiusKm != null && (
            <div className="pointer-events-none absolute inset-x-3 top-3 rounded-[10px] bg-page/90 px-3 py-2 text-xs text-ink">{t('staff.fixed.ringHint')}</div>
          )}
          {draft && draft.radiusKm == null && (
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start gap-2">
              <button type="button" onClick={stepBack} disabled={histLen === 0} data-testid="zone-step-back" aria-label={t('staff.fixed.stepBack')}
                className="pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-[10px] bg-accent px-3 py-2 text-sm font-semibold text-[#0b0f10] shadow-lg disabled:bg-page/90 disabled:text-muted">
                <span className="text-lg leading-none">↶</span>{t('staff.fixed.stepBack')}
              </button>
              <div className="min-w-0 flex-1 rounded-[10px] bg-page/90 px-3 py-2 text-xs text-ink">{t('staff.fixed.hint')}</div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {draft && (
            <div className="card space-y-3 p-4" data-testid="zone-form">
              <label className="block text-sm">{t('staff.fixed.name')}
                <input className="field mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={draft.radiusKm != null ? t('staff.fixed.upTo', { km: draft.radiusKm || '…' }) : 'Paphos — centre'} data-testid="zone-name" />
              </label>
              {draft.radiusKm != null && (
                <div data-testid="ring-radius">
                  <label className="block text-sm">{t('staff.fixed.radius')}
                    <div className="mt-1 flex items-center gap-2">
                      <input className="field !w-24" inputMode="decimal" value={draft.radiusKm} onChange={(e) => setDraft({ ...draft, radiusKm: e.target.value })} data-testid="ring-km" />
                      <span className="text-sm text-muted">{t('staff.fixed.kmFromAirport')}</span>
                    </div>
                  </label>
                  <input type="range" min={1} max={60} step={0.5} className="mt-2 w-full accent-[#C8FF46]" value={Number(draft.radiusKm.replace(',', '.')) || 1}
                    onChange={(e) => setDraft({ ...draft, radiusKm: e.target.value })} aria-label={t('staff.fixed.radius')} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">{t('staff.fixed.comfort')}
                  <input className="field mt-1" inputMode="decimal" value={draft.comfort} onChange={(e) => setDraft({ ...draft, comfort: e.target.value })} data-testid="zone-comfort" />
                </label>
                <label className="block text-sm">{t('staff.fixed.xl')}
                  <input className="field mt-1" inputMode="decimal" value={draft.xl} onChange={(e) => setDraft({ ...draft, xl: e.target.value })} data-testid="zone-xl" />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />{t('staff.fixed.active')}</label>
              {draft.radiusKm == null && <div className="text-xs text-muted">{t('staff.fixed.points', { n: draft.polygon.length })}</div>}
              {draft.radiusKm == null && <div className="flex gap-2">
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

          {mine.length === 0 && !draft && <p className="text-sm text-muted">{t('staff.fixed.empty')}</p>}
          {mine.map((z, i) => (
            <div key={z.id} className={`card p-3 ${draft?.id === z.id ? 'border-accent' : ''}`} data-testid="zone-row">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: z.active ? COLORS[i % COLORS.length] : '#8A969A' }} />
                <span className="min-w-0 flex-1 truncate font-semibold">{z.name}</span>
                <span className="shrink-0 text-xs text-muted">{z.radiusM ? `◯ ${t('staff.fixed.upTo', { km: kmS(z.radiusM) })}` : t('staff.fixed.drawn')}</span>
                {!z.active && <span className="text-xs text-muted">{t('staff.fixed.off')}</span>}
              </div>
              <div className="mt-1 text-sm tabular-nums">Comfort {euro(z.comfortCents)} € · XL {euro(z.xlCents)} €</div>
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
