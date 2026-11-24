'use client';

// Shared map editor for two admin blocks (2026-11-24, operator: «точки подачи — отдельный блок»):
//  • /admin/no-go «Запретная зона» (red): no pickup, stop or destination inside (server error NO_GO_ZONE);
//  • /admin/pickup-points «Точки подачи» (blue): a territory (rounded outline, the way passengers see it) with one or more named
//    pickup points (airport exits, port gates …) — every pickup inside goes to the nearest one.
// Server: src/server/no-go.ts.
import { smoothRing, untangle } from '@/lib/ring';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamicImport from 'next/dynamic';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import type { Poly, RefZone } from '@/components/staff/ZoneEditorMap';
import { centroid } from '@/lib/zone-shapes';
import { onCyprusIsland } from '@/lib/cyprus-island';
import { pointInPolygon } from '@/lib/geo';

const ZoneEditorMap = dynamicImport(() => import('@/components/staff/ZoneEditorMap'), { ssr: false });

export type Kind = 'NOGO' | 'POINT';
type Pt = { lat: number; lng: number };
interface Spot { lat: number; lng: number; name: string }
interface Zone { id: string; name: string; kind: Kind; polygon: Poly; points: Spot[]; dropPoints?: Spot[]; active: boolean }
interface Draft { id: string | null; name: string; kind: Kind; active: boolean; polygon: Poly; points: Spot[]; dropPoints: Spot[] }
// What a tap on the map adds while editing a territory: corners, pickup points or drop-off points (2026-11-24).
type Mode = 'corners' | 'pick' | 'drop';
const DROP = '#FFC83D';
const MIN_PICK_DROP_M = 15;
const metres = (a: Pt, b: Pt) => Math.hypot((a.lat - b.lat) * 110540, (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180));

const RED = '#FF4D4D';
const BLUE = '#4C9AFF';
const CYPRUS = { lat: 35.0, lng: 33.2 };

export function AreaZonesPage({ kind }: { kind: Kind }) {
  return <StaffShell roles={['ADMIN']}>{() => <AreaZones kind={kind} />}</StaffShell>;
}

function AreaZones({ kind }: { kind: Kind }) {
  const { t } = useT();
  const [allZones, setZones] = useState<Zone[]>([]);
  const zones = allZones.filter((z) => z.kind === kind);
  const otherZones = allZones.filter((z) => z.kind !== kind);
  // While a pickup territory is drawn: «Углы» puts corners, «Точка подачи» puts the one pickup point.
  const [mode, setMode] = useState<Mode>('corners');
  const pointMode = mode !== 'corners';
  const KCOL = kind === 'NOGO' ? RED : BLUE;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // «↶ Шаг назад»: every corner change can be undone; a continuous drag counts as one step.
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
    const r = await api<{ zones: Zone[] }>('/admin/no-go');
    setZones(r.zones);
  }, []);
  useEffect(() => { void load().catch((e) => setMsg(e instanceof ApiRequestError ? e.body.message : String(e))); }, [load]);

  // Every zone is red; a switched-off one is grey.
  const colorOf = (z: Zone) => (!z.active ? '#8A9499' : z.kind === 'NOGO' ? RED : BLUE);

  // Pickup territories are shown rounded — exactly as passengers will see them.
  const shape = (z: { kind: Kind; polygon: Poly }) => (z.kind === 'POINT' ? smoothRing(z.polygon) : z.polygon);
  const pointLabel = (name: string, p: Pt, i: number): RefZone => ({ id: `pt-${i}-${p.lat}-${p.lng}`, name, polygon: [], color: BLUE, label: name || `${t('staff.noGo.point')} ${i + 1}`, labelAt: [p.lat, p.lng], strong: true, pin: true }); // the logo passengers see there
  const dropLabel = (name: string, p: Pt, i: number): RefZone => ({ id: `dp-${i}-${p.lat}-${p.lng}`, name, polygon: [], color: DROP, label: `🏁 ${name || `${t('staff.noGo.dropPoint')} ${i + 1}`}`, labelAt: [p.lat, p.lng], strong: true });
  const refZones: RefZone[] = [
    // the other block's zones, faint, for orientation
    ...otherZones.filter((z) => z.polygon.length >= 3).map((z) => ({ id: z.id, name: z.name, polygon: shape(z), color: colorOf(z) })),
    ...zones.filter((z) => z.id !== draft?.id && z.polygon.length >= 3).map((z) => ({
      id: z.id, name: z.name, polygon: shape(z), color: colorOf(z),
      label: z.kind === 'POINT' ? undefined : z.active ? z.name : `${z.name} · ${t('staff.fixed.off')}`, labelAt: centroid(z.polygon), strong: z.active,
    })),
    ...zones.filter((z) => z.id !== draft?.id).flatMap((z) => [...z.points.map((p, i) => pointLabel(p.name, p, i)), ...(z.dropPoints ?? []).map((p, i) => dropLabel(p.name, p, i))]),
    // the territory being drawn: its rounded outline (faint behind the corners; solid while points are placed)
    ...(draft?.kind === 'POINT' && draft.polygon.length >= 3 ? [{ id: 'draft-round', name: draft.name, polygon: smoothRing(draft.polygon), color: BLUE, strong: pointMode }] : []),
    ...(draft ? draft.points.map((p, i) => pointLabel(p.name, p, i)) : []),
    ...(draft ? draft.dropPoints.map((p, i) => dropLabel(p.name, p, i)) : []),
  ];

  const fitKey = `${draft ? (draft.id ?? 'new') : ''}|${zones.length}`;
  const fit = useMemo<[number, number, number, number]>(() => {
    const pts = (draft && draft.polygon.length ? draft.polygon : zones.flatMap((z) => z.polygon)) as Poly;
    if (!pts.length) return [34.6, 32.3, 35.7, 34.6];
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  function startNew() { setMsg(null); resetHist(); setDraft({ id: null, name: '', kind, active: true, polygon: [], points: [], dropPoints: [] }); setMode('corners'); }
  function startEdit(z: Zone) { setMsg(null); resetHist(); setDraft({ id: z.id, name: z.name, kind: z.kind, active: z.active, polygon: untangle(z.polygon), points: z.points, dropPoints: z.dropPoints ?? [] }); setMode('corners'); }

  async function save() {
    if (!draft) return;
    if (draft.polygon.length < 3) { setMsg(t('staff.noGo.needPoints')); return; }
    if (draft.kind === 'POINT' && !draft.points.length) { setMsg(t('staff.noGo.needPickup')); setMode('pick'); return; }
    setBusy(true); setMsg(null);
    try {
      const body = { name: draft.name.trim() || `${t(draft.kind === 'POINT' ? 'staff.noGo.pointTitle' : 'staff.noGo.title')} ${zones.length + 1}`, kind: draft.kind, polygon: draft.polygon, points: draft.points, dropPoints: draft.dropPoints, active: draft.active };
      if (draft.id) await api(`/admin/no-go/${draft.id}`, { method: 'PUT', body });
      else await api('/admin/no-go', { method: 'POST', body });
      setDraft(null); setMsg(t('staff.noGo.saved'));
      await load();
    } catch (e) { setMsg(e instanceof ApiRequestError ? e.body.message : String(e)); }
    finally { setBusy(false); }
  }

  async function remove(z: Zone) {
    if (!window.confirm(t('staff.noGo.deleteConfirm', { name: z.name }))) return;
    await api(`/admin/no-go/${z.id}`, { method: 'DELETE' }).catch(() => null);
    if (draft?.id === z.id) setDraft(null);
    await load();
  }

  async function toggle(z: Zone) {
    setMsg(null);
    await api(`/admin/no-go/${z.id}`, { method: 'PUT', body: { name: z.name, kind: z.kind, polygon: z.polygon, points: z.points, dropPoints: z.dropPoints ?? [], active: !z.active } }).catch(() => null);
    await load();
  }

  return (
    <div className="mx-auto max-w-6xl p-4">
      <h1 className="text-xl font-semibold">{t(kind === 'NOGO' ? 'staff.noGo.title' : 'staff.noGo.kindPoint')}</h1>
      <p className="mt-2 text-sm text-muted">{t(kind === 'NOGO' ? 'staff.noGo.sub' : 'staff.noGo.subPoint')}</p>

      {!draft && (
        <div className="mt-4 flex">
          <button type="button" onClick={startNew} className={`ms-auto rounded-[12px] px-4 !min-h-[40px] !py-2 text-sm font-semibold ${kind === 'NOGO' ? 'bg-danger text-white' : 'bg-[#4C9AFF] text-[#0b0f10]'}`} data-testid="nogo-new">{t(kind === 'NOGO' ? 'staff.noGo.newZone' : 'staff.noGo.newPoint')}</button>
        </div>
      )}

      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="relative h-[62vh] min-h-[380px] overflow-hidden rounded-[14px] border border-edge">
          <ZoneEditorMap center={CYPRUS} airport={null} zones={refZones} editing={draft && !pointMode ? draft.polygon : null} onChange={setPoly} onPick={(lat, lng) => {
            if (!draft || !pointMode) return;
            // Each click adds a point; it must be inside the rounded territory and on land.
            if (!onCyprusIsland({ lat, lng }) || !pointInPolygon({ lat, lng }, smoothRing(draft.polygon).map(([a, b]) => ({ lat: a, lng: b })))) { setMsg(t('staff.noGo.pointOutside')); return; }
            const pt = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, name: '' };
            // Pickup and drop-off points do not mix: at least 15 m apart (operator: «чтобы не переплетались»).
            if ((mode === 'pick' ? draft.dropPoints : draft.points).some((q) => metres(q, pt) < MIN_PICK_DROP_M)) { setMsg(t('staff.noGo.tooClose', { m: MIN_PICK_DROP_M })); return; }
            if (mode === 'drop') { if (draft.dropPoints.length < 20) { setMsg(null); setDraft({ ...draft, dropPoints: [...draft.dropPoints, pt] }); } return; }
            if (draft.points.length >= 20) return;
            setMsg(null); setDraft({ ...draft, points: [...draft.points, pt] });
          }} fit={fit} editColor={KCOL} className="h-full w-full" />
          {draft && (
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start gap-2">
              <button type="button" onClick={stepBack} disabled={histLen === 0} aria-label={t('staff.fixed.stepBack')}
                className="pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-[10px] bg-accent px-3 py-2 text-sm font-semibold text-[#0b0f10] shadow-lg disabled:bg-page/90 disabled:text-muted">
                <span className="text-lg leading-none">↶</span>{t('staff.fixed.stepBack')}
              </button>
              <div className="min-w-0 flex-1 rounded-[10px] bg-page/90 px-3 py-2 text-xs text-ink">{mode === 'drop' ? t('staff.noGo.dropHint') : pointMode ? t('staff.noGo.pointHint') : t('staff.fixed.hint')}</div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {draft && (
            <div className="card space-y-3 p-4" data-testid="nogo-form">
              <label className="block text-sm">{t('staff.noGo.name')}
                <input className="field mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('staff.noGo.placeholder')} data-testid="nogo-name" />
              </label>
              {draft.kind === 'POINT' && (
                <div className="grid grid-cols-3 gap-1 rounded-[10px] border border-edge p-1" data-testid="nogo-mode">
                  <button type="button" onClick={() => setMode('corners')} className={`rounded-[8px] px-1 py-1.5 text-xs font-semibold ${mode === 'corners' ? 'bg-[#4C9AFF] text-[#0b0f10]' : 'text-muted'}`}>{t('staff.noGo.modeCorners')}</button>
                  <button type="button" onClick={() => setMode('pick')} disabled={draft.polygon.length < 3} className={`rounded-[8px] px-1 py-1.5 text-xs font-semibold ${mode === 'pick' ? 'bg-[#4C9AFF] text-[#0b0f10]' : 'text-muted'} disabled:opacity-40`} data-testid="nogo-mode-point">📍 {t('staff.noGo.modePoint')}</button>
                  <button type="button" onClick={() => setMode('drop')} disabled={draft.polygon.length < 3} className={`rounded-[8px] px-1 py-1.5 text-xs font-semibold ${mode === 'drop' ? 'bg-[#FFC83D] text-[#0b0f10]' : 'text-muted'} disabled:opacity-40`} data-testid="nogo-mode-drop">🏁 {t('staff.noGo.modeDrop')}</button>
                </div>
              )}
              {draft.kind === 'POINT' && (['pick', 'drop'] as const).map((which) => {
                const list = which === 'pick' ? draft.points : draft.dropPoints;
                const key = which === 'pick' ? 'points' : 'dropPoints';
                const col = which === 'pick' ? 'text-[#4C9AFF]' : 'text-[#FFC83D]';
                return (
                  <div key={which} className="space-y-1.5" data-testid={which === 'pick' ? 'nogo-points' : 'nogo-drop-points'}>
                    <div className={`text-xs font-semibold ${col}`}>{which === 'pick' ? `📍 ${t('staff.noGo.modePoint')}` : `🏁 ${t('staff.noGo.modeDrop')}`}</div>
                    {list.length === 0 && <div className={`text-xs ${which === 'pick' ? 'text-warn' : 'text-muted'}`}>{t(which === 'pick' ? 'staff.noGo.needPickup' : 'staff.noGo.noDrop')}</div>}
                    {list.map((p, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className={`w-5 shrink-0 text-center text-xs font-semibold ${col}`}>{i + 1}</span>
                        <input className="field !min-h-[36px] flex-1 !py-1 text-sm" value={p.name} placeholder={t(which === 'pick' ? 'staff.noGo.pointName' : 'staff.noGo.dropName')} data-testid={which === 'pick' ? 'nogo-point-name' : 'nogo-drop-name'}
                          onChange={(e) => setDraft({ ...draft, [key]: list.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)) })} />
                        {/* Deleting a point asks first (operator 2026-11-24). */}
                        <button type="button" aria-label={t('staff.fixed.delete')} className="px-2 text-danger"
                          onClick={() => { if (window.confirm(t('staff.noGo.deletePoint', { name: p.name || `${i + 1}` }))) setDraft({ ...draft, [key]: list.filter((_, j) => j !== i) }); }}>✕</button>
                      </div>
                    ))}
                  </div>
                );
              })}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />{t('staff.fixed.active')}</label>
              <div className="text-xs text-muted">{t('staff.fixed.points', { n: draft.polygon.length })}</div>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost !min-h-[40px] flex-1 !py-2 text-sm" disabled={!draft.polygon.length} onClick={() => { lastChange.current = 0; setPoly(draft.polygon.slice(0, -1)); }}>{t('staff.fixed.undo')}</button>
                <button type="button" className="btn-ghost !min-h-[40px] !py-2 text-sm" disabled={!draft.polygon.length} onClick={() => { lastChange.current = 0; setPoly([]); }}>{t('staff.fixed.clear')}</button>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost !min-h-[44px] !py-2 text-sm" onClick={() => setDraft(null)}>{t('staff.fixed.cancel')}</button>
                <button type="button" className="btn-primary !min-h-[44px] flex-1 !py-2 text-sm" disabled={busy} onClick={save} data-testid="nogo-save">{t('staff.fixed.save')}</button>
              </div>
            </div>
          )}
          {msg && <p className="text-sm text-muted" data-testid="nogo-msg">{msg}</p>}

          {zones.length === 0 && !draft && <p className="text-sm text-muted">{t('staff.noGo.empty')}</p>}
          {zones.map((z) => (
            <div key={z.id} className={`card p-3 ${draft?.id === z.id ? 'border-accent' : ''}`} data-testid="nogo-row">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorOf(z) }} />
                <span className="min-w-0 flex-1 truncate font-semibold">{z.name}</span>
                {!z.active && <span className="text-xs text-muted">{t('staff.fixed.off')}</span>}
              </div>
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
