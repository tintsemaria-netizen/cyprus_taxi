'use client';

// Admin «Фиксированные цены» (2026-11-17): draw airport fare zones on a map and set their prices.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamicImport from 'next/dynamic';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import type { Poly, RefZone } from '@/components/staff/ZoneEditorMap';
import { centroid, nextBelt, polygonArea, polygonInside } from '@/lib/zone-shapes';

const ZoneEditorMap = dynamicImport(() => import('@/components/staff/ZoneEditorMap'), { ssr: false });

export const dynamic = 'force-dynamic';

interface Zone { id: string; airport: string; name: string; polygon: Poly; comfortCents: number; xlCents: number; active: boolean }
interface Airport { code: string; lat: number; lng: number }
interface Draft { id: string | null; name: string; comfort: string; xl: string; active: boolean; polygon: Poly }

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
  // Smallest first: centre, then each next belt outwards (the price that applies is the smallest zone around the address).
  const mine = zones.filter((z) => z.airport === code).sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon));
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
  const refZones: RefZone[] = others.map((z) => {
    const holes = holesOf(z, others);
    return { id: z.id, name: z.name, polygon: z.polygon, holes, color: z.active ? COLORS[mine.indexOf(z) % COLORS.length] : '#8A969A',
      label: `${z.name} · ${euroS(z.comfortCents)} €`, labelAt: labelAt(z.polygon, holes.length > 0) };
  });
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

  function startNew() { setMsg(null); resetHist(); setDraft({ id: null, name: '', comfort: '35', xl: '50', active: true, polygon: [] }); }
  // «+ Следующий пояс» (2026-11-21, operator): starts exactly on the edge of the outermost zone and goes 3 km further
  // out, with many corners to drag. Inside it the previous zones keep their prices (the smallest zone wins).
  function startBelt() {
    if (!outermost) return;
    setMsg(null); resetHist();
    const n = mine.length + 1;
    setDraft({ id: null, name: t('staff.fixed.beltN', { n }), comfort: euroS(outermost.comfortCents + 1000), xl: euroS(outermost.xlCents + 1500), active: true, polygon: nextBelt(outermost.polygon, 3000) });
  }
  function startEdit(z: Zone) { setMsg(null); resetHist(); setDraft({ id: z.id, name: z.name, comfort: euro(z.comfortCents), xl: euro(z.xlCents), active: z.active, polygon: z.polygon }); }

  async function save() {
    if (!draft) return;
    if (draft.polygon.length < 3) { setMsg(t('staff.fixed.needPoints')); return; }
    const c = cents(draft.comfort), x = cents(draft.xl);
    if (!(c > 0) || !(x > 0)) { setMsg(t('staff.fixed.needPrice')); return; }
    setBusy(true); setMsg(null);
    try {
      const body = { airport: code, name: draft.name.trim() || `Zone ${mine.length + 1}`, polygon: draft.polygon, comfortCents: c, xlCents: x, active: draft.active };
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
    await api(`/admin/fixed-zones/${z.id}`, { method: 'PUT', body: { airport: z.airport, name: z.name, polygon: z.polygon, comfortCents: z.comfortCents, xlCents: z.xlCents, active: !z.active } }).catch(() => null);
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
            {outermost && <button type="button" onClick={startBelt} className="btn-primary !min-h-[40px] !py-2 text-sm" data-testid="belt-new">{t('staff.fixed.nextBelt')}</button>}
            <button type="button" onClick={startNew} className={`${outermost ? 'btn-ghost' : 'btn-primary'} !min-h-[40px] !py-2 text-sm`} data-testid="zone-new">{t('staff.fixed.newZone')}</button>
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="relative h-[62vh] min-h-[380px] overflow-hidden rounded-[14px] border border-edge">
          <ZoneEditorMap center={center} airport={ap} zones={refZones} editing={draft ? draft.polygon : null}
            onChange={setPoly} fit={fit} className="h-full w-full" />
          {draft && (
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
                <input className="field mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Paphos — centre" data-testid="zone-name" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">{t('staff.fixed.comfort')}
                  <input className="field mt-1" inputMode="decimal" value={draft.comfort} onChange={(e) => setDraft({ ...draft, comfort: e.target.value })} data-testid="zone-comfort" />
                </label>
                <label className="block text-sm">{t('staff.fixed.xl')}
                  <input className="field mt-1" inputMode="decimal" value={draft.xl} onChange={(e) => setDraft({ ...draft, xl: e.target.value })} data-testid="zone-xl" />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />{t('staff.fixed.active')}</label>
              <div className="text-xs text-muted">{t('staff.fixed.points', { n: draft.polygon.length })}</div>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost !min-h-[40px] flex-1 !py-2 text-sm" disabled={!draft.polygon.length} onClick={() => { lastChange.current = 0; setPoly(draft.polygon.slice(0, -1)); }} data-testid="zone-undo">{t('staff.fixed.undo')}</button>
                <button type="button" className="btn-ghost !min-h-[40px] !py-2 text-sm" disabled={!draft.polygon.length} onClick={() => { lastChange.current = 0; setPoly([]); }}>{t('staff.fixed.clear')}</button>
              </div>
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
