'use client';

// Admin «Минимум предзаказа» (2026-11-22, operator): areas on the map — one per town / district — with the
// minimum price of a PRE-BOOKED ride inside the area, Comfort and XL separately. Above it the meter counts.
import { untangle } from '@/lib/ring';
import { Switch } from '@/components/staff/Switch';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamicImport from 'next/dynamic';
import { FormClose, OverMap, PanelHead, useDirty, useZoneMap } from '@/components/staff/ZoneWorkspace';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import type { Poly, RefZone } from '@/components/staff/ZoneEditorMap';
import { centroid } from '@/lib/zone-shapes';


export const dynamic = 'force-dynamic';

interface Zone { id: string; name: string; polygon: Poly; comfortCents: number; xlCents: number; active: boolean }
interface Draft { id: string | null; name: string; comfort: string; xl: string; active: boolean; polygon: Poly }

const COLORS = ['#C8FF46', '#4C9AFF', '#FFC83D', '#FF7A59', '#B07CFF', '#3DD9C1', '#FF5C93'];
const CYPRUS = { lat: 35.0, lng: 33.2 };

export default function Page() {
  return <MinFares />; // menu + shared map: app/admin/(zones)/layout.tsx
}

function MinFares() {
  const { t } = useT();
  const [zones, setZones] = useState<Zone[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const { dirty, reset: resetDirty } = useDirty(draft); // ✕ and «Отмена» do not drop unsaved changes silently
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
    const r = await api<{ zones: Zone[] }>('/admin/min-fares');
    setZones(r.zones);
  }, []);
  useEffect(() => { void load().catch((e) => setMsg(e instanceof ApiRequestError ? e.body.message : String(e))); }, [load]);

  const euro = (c: number) => (c / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const cents = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);
  // Every area keeps its own colour (2026-11-22, operator: «выдели область городов»); a switched-off one is drawn too.
  const colorOf = (z: Zone) => COLORS[zones.indexOf(z) % COLORS.length];

  const refZones: RefZone[] = zones.filter((z) => z.id !== draft?.id && z.polygon.length >= 3).map((z) => ({
    id: z.id, name: z.name, polygon: z.polygon, color: colorOf(z),
    label: z.active ? `${z.name} · Comfort ${euro(z.comfortCents)} € · XL ${euro(z.xlCents)} €` : `${z.name} · ${t('staff.fixed.off')}`, labelAt: centroid(z.polygon),
  }));
  const fitKey = `${draft ? (draft.id ?? 'new') : ''}|${zones.length}`;
  const fit = useMemo<[number, number, number, number]>(() => {
    const pts = (draft && draft.polygon.length ? draft.polygon : zones.flatMap((z) => z.polygon)) as Poly;
    if (!pts.length) return [34.6, 32.3, 35.7, 34.6];
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  function startNew() { if (dirty) { setMsg(t('staff.zoneMap.saveFirst')); return; } resetDirty(); setMsg(null); resetHist(); setDraft({ id: null, name: '', comfort: '20', xl: '28', active: true, polygon: [] }); }
  function startEdit(z: Zone) { if (dirty) { setMsg(t('staff.zoneMap.saveFirst')); return; } resetDirty(); setMsg(null); resetHist(); setDraft({ id: z.id, name: z.name, comfort: euro(z.comfortCents), xl: euro(z.xlCents), active: z.active, polygon: untangle(z.polygon) }); } // an old figure-8 opens as one loop (2026-11-24)

  async function save() {
    if (!draft) return;
    if (draft.polygon.length < 3) { setMsg(t('staff.minFare.needPoints')); return; }
    const c = cents(draft.comfort), x = cents(draft.xl);
    if (!(c > 0) || !(x > 0)) { setMsg(t('staff.minFare.needPrice')); return; }
    setBusy(true); setMsg(null);
    try {
      const body = { name: draft.name.trim() || `Zone ${zones.length + 1}`, polygon: draft.polygon, comfortCents: c, xlCents: x, active: draft.active };
      if (draft.id) await api(`/admin/min-fares/${draft.id}`, { method: 'PUT', body });
      else await api('/admin/min-fares', { method: 'POST', body });
      setDraft(null); setMsg(t('staff.minFare.saved'));
      await load();
    } catch (e) { setMsg(e instanceof ApiRequestError ? e.body.message : String(e)); }
    finally { setBusy(false); }
  }

  async function remove(z: Zone) {
    if (!window.confirm(t('staff.minFare.deleteConfirm', { name: z.name }))) return;
    await api(`/admin/min-fares/${z.id}`, { method: 'DELETE' }).catch(() => null);
    if (draft?.id === z.id) setDraft(null);
    await load();
  }

  async function toggle(z: Zone) {
    setMsg(null);
    await api(`/admin/min-fares/${z.id}`, { method: 'PUT', body: { name: z.name, polygon: z.polygon, comfortCents: z.comfortCents, xlCents: z.xlCents, active: !z.active } }).catch(() => null);
    await load();
  }

  // The tab draws on the shared map of the zone tabs (2026-11-25).
  useZoneMap({ center: CYPRUS, zones: refZones, editing: draft ? draft.polygon : null, onChange: setPoly, fit: fit });

  return (
    <div>
      <PanelHead title={t('staff.minFare.title')} info={t('staff.minFare.sub')} />

      {!draft && (
        <div className="mt-4 flex">
          <button type="button" onClick={startNew} className="btn-primary ms-auto !min-h-[40px] !py-2 text-sm" data-testid="minfare-new">{t('staff.minFare.newZone')}</button>
        </div>
      )}

      <div className="mt-3">
        <OverMap>
          
          {draft && (
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start gap-2">
              <button type="button" onClick={stepBack} disabled={histLen === 0} aria-label={t('staff.fixed.stepBack')}
                className="pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-[10px] bg-accent px-3 py-2 text-sm font-semibold text-[#0b0f10] shadow-lg disabled:bg-page/90 disabled:text-muted">
                <span className="text-lg leading-none">↶</span>{t('staff.fixed.stepBack')}
              </button>
              <div className="min-w-0 flex-1 rounded-[10px] bg-page/90 px-3 py-2 text-xs text-ink">{t('staff.fixed.hint')}</div>
            </div>
          )}
        
        </OverMap>

        <div className="space-y-3">
          {draft && (
            <div className="card relative space-y-3 p-4" data-testid="minfare-form">
              <FormClose dirty={dirty} onClose={() => setDraft(null)} />
              <label className="block text-sm">{t('staff.minFare.name')}
                <input className="field mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Limassol" data-testid="minfare-name" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">{t('staff.minFare.comfort')}
                  <input className="field mt-1" inputMode="decimal" value={draft.comfort} onChange={(e) => setDraft({ ...draft, comfort: e.target.value })} data-testid="minfare-comfort" />
                </label>
                <label className="block text-sm">{t('staff.minFare.xl')}
                  <input className="field mt-1" inputMode="decimal" value={draft.xl} onChange={(e) => setDraft({ ...draft, xl: e.target.value })} data-testid="minfare-xl" />
                </label>
              </div>
              <Switch checked={draft.active} onChange={(on) => setDraft({ ...draft, active: on })} label={t('staff.fixed.active')} testid="zone-active"
                confirmOn={t('staff.confirm.on', { name: draft.name || '—' })} confirmOff={t('staff.confirm.off', { name: draft.name || '—' })} />
              <div className="text-xs text-muted">{t('staff.fixed.points', { n: draft.polygon.length })}</div>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost !min-h-[40px] flex-1 !py-2 text-sm" disabled={!draft.polygon.length} onClick={() => { lastChange.current = 0; setPoly(draft.polygon.slice(0, -1)); }}>{t('staff.fixed.undo')}</button>
                <button type="button" className="btn-ghost !min-h-[40px] !py-2 text-sm" disabled={!draft.polygon.length} onClick={() => { lastChange.current = 0; setPoly([]); }}>{t('staff.fixed.clear')}</button>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost !min-h-[44px] !py-2 text-sm" onClick={() => { if (dirty && !window.confirm(t('staff.zoneMap.discard'))) return; setDraft(null); }}>{t('staff.fixed.cancel')}</button>
                <button type="button" className="btn-primary !min-h-[44px] flex-1 !py-2 text-sm" disabled={busy} onClick={save} data-testid="minfare-save">{t('staff.fixed.save')}</button>
              </div>
            </div>
          )}
          {msg && <p className="text-sm text-muted" data-testid="minfare-msg">{msg}</p>}

          {zones.length === 0 && !draft && <p className="text-sm text-muted">{t('staff.minFare.empty')}</p>}
          {zones.map((z) => (
            <div key={z.id} className={`card p-3 ${draft?.id === z.id ? 'border-accent' : ''}`} data-testid="minfare-row">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorOf(z) }} />
                <span className="min-w-0 flex-1 truncate font-semibold">{z.name}</span>
                {!z.active && <span className="text-xs text-muted">{t('staff.fixed.off')}</span>}
              </div>
              <PriceRow z={z} onSaved={load} />
              <div className="mt-2 flex gap-2 text-sm">
                <button type="button" className="text-accent" onClick={() => startEdit(z)}>{t('staff.fixed.edit')}</button>
                <button type="button" className="text-muted" onClick={() => { if (window.confirm(t(z.active ? 'staff.confirm.deactivate' : 'staff.confirm.activate', { name: z.name }))) void toggle(z); }}>{z.active ? t('staff.deactivate') : t('staff.activate')}</button>
                <button type="button" className="ms-auto text-danger" onClick={() => remove(z)}>{t('staff.fixed.delete')}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Prices right in the list (2026-11-22, operator: «цены на комфорт и xl можно было менять самому») — no map needed.
function PriceRow({ z, onSaved }: { z: Zone; onSaved: () => Promise<void> }) {
  const { t } = useT();
  const euro = (c: number) => (c / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const [c, setC] = useState(euro(z.comfortCents));
  const [x, setX] = useState(euro(z.xlCents));
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle');
  useEffect(() => { setC(euro(z.comfortCents)); setX(euro(z.xlCents)); }, [z.comfortCents, z.xlCents]);
  const toCents = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);
  const changed = toCents(c) !== z.comfortCents || toCents(x) !== z.xlCents;
  async function save() {
    const cc = toCents(c), xx = toCents(x);
    if (!(cc >= 100) || !(xx >= 100)) { setState('error'); return; }
    setState('busy');
    try {
      await api(`/admin/min-fares/${z.id}`, { method: 'PUT', body: { name: z.name, polygon: z.polygon, comfortCents: cc, xlCents: xx, active: z.active } });
      setState('saved'); await onSaved();
    } catch { setState('error'); }
  }
  return (
    <div className="mt-2" data-testid="minfare-prices">
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 text-xs text-muted">Comfort, €
          <input className="field mt-1 !min-h-[38px] !py-1.5 tabular-nums" inputMode="decimal" value={c} onChange={(e) => { setC(e.target.value); setState('idle'); }} data-testid="row-comfort" />
        </label>
        <label className="min-w-0 flex-1 text-xs text-muted">XL, €
          <input className="field mt-1 !min-h-[38px] !py-1.5 tabular-nums" inputMode="decimal" value={x} onChange={(e) => { setX(e.target.value); setState('idle'); }} data-testid="row-xl" />
        </label>
        <button type="button" className="btn-primary !min-h-[38px] shrink-0 !px-3 !py-1.5 text-sm" disabled={!changed || state === 'busy'} onClick={save} data-testid="row-save">{t('staff.minFare.savePrices')}</button>
      </div>
      {state === 'saved' && <p className="mt-1 text-xs text-accent">{t('staff.minFare.saved')}</p>}
      {state === 'error' && <p className="mt-1 text-xs text-danger">{t('staff.minFare.needPrice')}</p>}
    </div>
  );
}
