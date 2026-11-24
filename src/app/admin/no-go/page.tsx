'use client';

// Admin «Запретная зона» (2026-11-24, operator): two sections on one map —
//  • «Запретные зоны» (red): no pickup, stop or destination inside (server error NO_GO_ZONE);
//  • «Одна точка подачи» (blue): a territory with ONE pickup point — every pickup inside goes there.
// Server: src/server/no-go.ts.
import { untangle } from '@/lib/ring';
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

export const dynamic = 'force-dynamic';

type Kind = 'NOGO' | 'POINT';
type Pt = { lat: number; lng: number };
interface Zone { id: string; name: string; kind: Kind; polygon: Poly; point: Pt | null; active: boolean }
interface Draft { id: string | null; name: string; kind: Kind; active: boolean; polygon: Poly; point: Pt | null }

const RED = '#FF4D4D';
const BLUE = '#4C9AFF';
const CYPRUS = { lat: 35.0, lng: 33.2 };

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <NoGo />}</StaffShell>;
}

function NoGo() {
  const { t } = useT();
  const [allZones, setZones] = useState<Zone[]>([]);
  const [kind, setKind] = useState<Kind>('NOGO');
  const zones = allZones.filter((z) => z.kind === kind);
  const otherZones = allZones.filter((z) => z.kind !== kind);
  // While a pickup territory is drawn: «Углы» puts corners, «Точка подачи» puts the one pickup point.
  const [pointMode, setPointMode] = useState(false);
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

  const pointLabel = (name: string, p: Pt): RefZone => ({ id: `pt-${name}-${p.lat}`, name, polygon: [], color: BLUE, label: `📍 ${name || t('staff.noGo.point')}`, labelAt: [p.lat, p.lng], strong: true });
  const refZones: RefZone[] = [
    ...otherZones.filter((z) => z.polygon.length >= 3).map((z) => ({ id: z.id, name: z.name, polygon: z.polygon, color: colorOf(z) })),
    ...zones.filter((z) => z.id !== draft?.id && z.polygon.length >= 3).map((z) => ({
      id: z.id, name: z.name, polygon: z.polygon, color: colorOf(z),
      label: z.kind === 'POINT' ? undefined : z.active ? z.name : `${z.name} · ${t('staff.fixed.off')}`, labelAt: centroid(z.polygon), strong: z.active,
    })),
    ...zones.filter((z) => z.id !== draft?.id && z.point).map((z) => pointLabel(z.name, z.point!)),
    // the territory being drawn, shown while its pickup point is placed
    ...(draft && pointMode && draft.polygon.length >= 3 ? [{ id: 'draft', name: draft.name, polygon: draft.polygon, color: BLUE, strong: true }] : []),
    ...(draft?.point ? [pointLabel(draft.name, draft.point)] : []),
  ];

  const fitKey = `${draft ? (draft.id ?? 'new') : ''}|${zones.length}`;
  const fit = useMemo<[number, number, number, number]>(() => {
    const pts = (draft && draft.polygon.length ? draft.polygon : zones.flatMap((z) => z.polygon)) as Poly;
    if (!pts.length) return [34.6, 32.3, 35.7, 34.6];
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  function startNew() { setMsg(null); resetHist(); setDraft({ id: null, name: '', kind, active: true, polygon: [], point: null }); setPointMode(false); }
  function startEdit(z: Zone) { setMsg(null); resetHist(); setDraft({ id: z.id, name: z.name, kind: z.kind, active: z.active, polygon: untangle(z.polygon), point: z.point }); setPointMode(false); }

  async function save() {
    if (!draft) return;
    if (draft.polygon.length < 3) { setMsg(t('staff.noGo.needPoints')); return; }
    if (draft.kind === 'POINT' && !draft.point) { setMsg(t('staff.noGo.needPickup')); setPointMode(true); return; }
    setBusy(true); setMsg(null);
    try {
      const body = { name: draft.name.trim() || `${t(draft.kind === 'POINT' ? 'staff.noGo.pointTitle' : 'staff.noGo.title')} ${zones.length + 1}`, kind: draft.kind, polygon: draft.polygon, point: draft.point, active: draft.active };
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
    await api(`/admin/no-go/${z.id}`, { method: 'PUT', body: { name: z.name, kind: z.kind, polygon: z.polygon, point: z.point, active: !z.active } }).catch(() => null);
    await load();
  }

  return (
    <div className="mx-auto max-w-6xl p-4">
      <h1 className="text-xl font-semibold">{t('staff.noGo.title')}</h1>
      <div className="mt-3 inline-flex rounded-[12px] border border-edge bg-elevated p-1" role="tablist" data-testid="nogo-kinds">
        {(['NOGO', 'POINT'] as Kind[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} disabled={!!draft}
            onClick={() => { setKind(k); setMsg(null); }}
            className={`rounded-[9px] px-3 py-1.5 text-sm font-semibold ${kind === k ? (k === 'NOGO' ? 'bg-danger text-white' : 'bg-[#4C9AFF] text-[#0b0f10]') : 'text-muted'}`}
            data-testid={`nogo-kind-${k}`}>
            {k === 'NOGO' ? t('staff.noGo.kindNoGo') : t('staff.noGo.kindPoint')}
          </button>
        ))}
      </div>
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
            // The point must be inside the territory and on land.
            if (!onCyprusIsland({ lat, lng }) || !pointInPolygon({ lat, lng }, draft.polygon.map(([a, b]) => ({ lat: a, lng: b })))) { setMsg(t('staff.noGo.pointOutside')); return; }
            setMsg(null); setDraft({ ...draft, point: { lat, lng } });
          }} fit={fit} editColor={KCOL} className="h-full w-full" />
          {draft && (
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start gap-2">
              <button type="button" onClick={stepBack} disabled={histLen === 0} aria-label={t('staff.fixed.stepBack')}
                className="pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-[10px] bg-accent px-3 py-2 text-sm font-semibold text-[#0b0f10] shadow-lg disabled:bg-page/90 disabled:text-muted">
                <span className="text-lg leading-none">↶</span>{t('staff.fixed.stepBack')}
              </button>
              <div className="min-w-0 flex-1 rounded-[10px] bg-page/90 px-3 py-2 text-xs text-ink">{pointMode ? t('staff.noGo.pointHint') : t('staff.fixed.hint')}</div>
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
                <div className="grid grid-cols-2 gap-1 rounded-[10px] border border-edge p-1" data-testid="nogo-mode">
                  <button type="button" onClick={() => setPointMode(false)} className={`rounded-[8px] py-1.5 text-sm font-semibold ${!pointMode ? 'bg-[#4C9AFF] text-[#0b0f10]' : 'text-muted'}`}>{t('staff.noGo.modeCorners')}</button>
                  <button type="button" onClick={() => setPointMode(true)} disabled={draft.polygon.length < 3} className={`rounded-[8px] py-1.5 text-sm font-semibold ${pointMode ? 'bg-[#4C9AFF] text-[#0b0f10]' : 'text-muted'} disabled:opacity-40`} data-testid="nogo-mode-point">📍 {t('staff.noGo.modePoint')}</button>
                </div>
              )}
              {draft.kind === 'POINT' && <div className={`text-xs ${draft.point ? 'text-accent' : 'text-warn'}`}>{draft.point ? `📍 ${draft.point.lat.toFixed(5)}, ${draft.point.lng.toFixed(5)}` : t('staff.noGo.needPickup')}</div>}
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
