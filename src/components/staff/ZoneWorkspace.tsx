'use client';

// One map for the price / zone tabs (operator 2026-11-25): «Фикс. цены», «Минимум предзаказа», «Запретная зона»,
// «Точки подачи», «Стоянки с очередью» share ONE big map that stays put when the tab changes — only the panel on
// the side (the tab's tools) and what the tab draws on the map change. The map lives in the (zones) layout; a tab
// hands it its props with useZoneMap() and puts things over the map (step back, hints) with <OverMap>.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import dynamicImport from 'next/dynamic';
import type { ComponentProps } from 'react';
import type ZoneEditorMapT from '@/components/staff/ZoneEditorMap';
import { useT } from '@/i18n/I18nProvider';

const ZoneEditorMap = dynamicImport(() => import('@/components/staff/ZoneEditorMap'), { ssr: false });

type MapProps = Omit<ComponentProps<typeof ZoneEditorMapT>, 'className'>;
type Fit = MapProps['fit'];
interface Ctx { set: (p: MapProps | null) => void; overlay: HTMLDivElement | null; collapse: () => void }
const ZoneMapCtx = createContext<Ctx | null>(null);

const CYPRUS = { lat: 35.0, lng: 33.2 };
const EMPTY: MapProps = { center: CYPRUS, zones: [], editing: null, onChange: () => {} };

/** A tab gives the shared map what to show. Called on every render; the latest props win. */
export function useZoneMap(p: MapProps): void {
  const set = useContext(ZoneMapCtx)?.set;
  useLayoutEffect(() => { set?.(p); });
  useEffect(() => () => set?.(null), [set]); // only when the tab goes away (set is stable)
}

/**
 * The tab's title row (operator 2026-11-25): on the right ☰ with «Инфо» (the long description, hidden until asked)
 * and ✕ that folds the side panel away so the map takes the whole width (a «‹» on the map brings it back).
 */
export function PanelHead({ title, info }: { title: React.ReactNode; info: React.ReactNode }) {
  const { t } = useT();
  const collapse = useContext(ZoneMapCtx)?.collapse;
  const [menu, setMenu] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <h1 className="min-w-0 flex-1 text-xl font-semibold">{title}</h1>
        <button type="button" aria-label={t('staff.zoneMap.menu')} onClick={() => setMenu((v) => !v)} data-testid="panel-menu"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink hover:bg-white/5 ${menu ? 'bg-white/10' : ''}`}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        {collapse && (
          <button type="button" aria-label={t('staff.zoneMap.hide')} title={t('staff.zoneMap.hide')} onClick={collapse} data-testid="panel-close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg text-muted hover:bg-white/5 hover:text-ink">✕</button>
        )}
      </div>
      {menu && (
        <div className="absolute end-10 top-10 z-20 min-w-[160px] rounded-[12px] border border-edge bg-elevated p-1 shadow-xl" data-testid="panel-menu-list">
          <button type="button" className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-start text-sm hover:bg-white/5" data-testid="panel-info"
            onClick={() => { setShow(true); setMenu(false); }}>ℹ️ {t('staff.zoneMap.info')}</button>
        </div>
      )}
      {show && (
        <div className="mt-2 flex items-start gap-2 rounded-[12px] border border-edge bg-surface p-3 text-sm text-muted" data-testid="panel-info-text">
          <div className="min-w-0 flex-1">{info}</div>
          <button type="button" aria-label="✕" onClick={() => setShow(false)} className="-me-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-white/5">✕</button>
        </div>
      )}
    </div>
  );
}

/** Things drawn over the shared map (step back, hints) — at its top, left of the side panel. */
export function OverMap({ children }: { children: React.ReactNode }) {
  const ctx = useContext(ZoneMapCtx);
  return ctx?.overlay ? createPortal(children, ctx.overlay) : null;
}

export function ZoneWorkspace({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const pathname = usePathname();
  const [props, setProps] = useState<MapProps>(EMPTY);
  const latest = useRef<MapProps>(EMPTY);
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);

  // The camera stays where it is when the tab changes: the new tab's «fit» is only remembered; it is applied
  // when it changes WITHIN the tab (start editing a zone, pick another airport) — and once for the first tab.
  const tabOf = useRef<string | null>(null);
  const baseline = useRef<string>('');
  const [fit, setFit] = useState<Fit>(null);
  // The first tab's centre only: another tab's default centre must not move the camera.
  const center = useRef<MapProps['center'] | null>(null);
  const set = useCallback((p: MapProps | null) => {
    const next = p ?? EMPTY;
    latest.current = next;
    setProps(next);
    if (!p) return;
    const key = JSON.stringify(p.fit ?? null);
    if (tabOf.current !== window.location.pathname) {
      const first = tabOf.current == null;
      tabOf.current = window.location.pathname;
      baseline.current = key;
      if (first) { setFit(p.fit ?? null); center.current = p.center; }
      return;
    }
    if (key !== baseline.current) { baseline.current = key; setFit(p.fit ?? null); }
  }, []);

  // Callbacks go through refs: the map always calls the current tab's handlers.
  const onChange = useCallback((poly: Parameters<MapProps['onChange']>[0]) => latest.current.onChange(poly), []);
  const onPick = useCallback((lat: number, lng: number) => latest.current.onPick?.(lat, lng), []);
  const onPinMove = useCallback((id: string, lat: number, lng: number) => latest.current.onPinMove?.(id, lat, lng), []);

  // ✕ in the panel folds it away (its content stays mounted, so a half-filled form is kept); «‹» on the map opens it.
  const [folded, setFolded] = useState(false);
  const collapse = useCallback(() => setFolded(true), []);
  const ctxValue = useMemo(() => ({ set, overlay, collapse }), [set, overlay, collapse]);

  // The work area fills the screen below the menu (its height follows banners above it and the window size).
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const fitH = () => { const top = box.current?.getBoundingClientRect().top ?? 0; setH(Math.max(420, window.innerHeight - top - 12 + window.scrollY)); };
    fitH();
    const id = window.setTimeout(fitH, 300);
    window.addEventListener('resize', fitH);
    return () => { window.clearTimeout(id); window.removeEventListener('resize', fitH); };
  }, [pathname]);

  return (
    <ZoneMapCtx.Provider value={ctxValue}>
      <div ref={box} className="flex flex-col gap-3 p-3 lg:flex-row" style={h ? { height: undefined, ['--zw-h' as string]: `${h}px` } : undefined} data-testid="zone-workspace">
        <div className="relative h-[58vh] min-h-[360px] overflow-hidden rounded-[14px] border border-edge lg:h-[var(--zw-h,75vh)] lg:min-w-0 lg:flex-1" data-testid="zone-map-box">
          <ZoneEditorMap {...props} center={center.current ?? props.center} fit={fit} onChange={onChange} onPick={props.onPick ? onPick : undefined} onPinMove={props.onPinMove ? onPinMove : undefined} className="h-full w-full" />
          <div ref={setOverlay} className="pointer-events-none absolute inset-0" />
          {folded && (
            <button type="button" onClick={() => setFolded(false)} data-testid="panel-open" aria-label={t('staff.zoneMap.show')}
              className="absolute end-0 top-1/2 z-10 flex h-16 w-8 -translate-y-1/2 items-center justify-center rounded-s-[12px] bg-accent text-xl font-bold text-[#0b0f10] shadow-lg">‹</button>
          )}
        </div>
        <aside className={`lg:h-[var(--zw-h,75vh)] lg:w-[400px] lg:shrink-0 lg:overflow-y-auto ${folded ? 'hidden' : ''}`} data-testid="zone-panel">{children}</aside>
      </div>
    </ZoneMapCtx.Provider>
  );
}
