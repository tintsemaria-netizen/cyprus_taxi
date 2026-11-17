'use client';

import { useState } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { api } from '@/lib/api-client';
import { PlacesInput, type Selected } from './PlacesInput';

// Saved places from the passenger start screen (2026-11-18): set Home / Work right there, and «Ещё»
// = «Мои адреса», the passenger's own named places (add, change, delete; tap = ride there).
export interface CustomPlace extends Selected { id: string; name: string }
export interface SavedPlaces { home: Selected | null; work: Selected | null; school?: Selected | null; custom?: CustomPlace[] }
export type SavedMode = { type: 'set'; kind: 'HOME' | 'WORK' } | { type: 'list' };

type Edit = { kind: 'HOME' | 'WORK' | 'CUSTOM' | string; name: string; sel: Selected | null; text: string };

export default function SavedPlacesSheet(p: {
  mode: SavedMode;
  places: SavedPlaces;
  onSaved: () => void; // reload the places
  onGo: (pl: Selected) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const startEdit = (kind: Edit['kind']): Edit => {
    const cur = kind === 'HOME' ? p.places.home : kind === 'WORK' ? p.places.work : p.places.custom?.find((c) => c.id === kind) ?? null;
    return { kind, name: cur && 'name' in cur ? (cur as CustomPlace).name : '', sel: cur ? { label: cur.label, lat: cur.lat, lng: cur.lng } : null, text: cur?.label ?? '' };
  };
  const [edit, setEdit] = useState<Edit | null>(p.mode.type === 'set' ? startEdit(p.mode.kind) : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const custom = edit ? edit.kind !== 'HOME' && edit.kind !== 'WORK' : false;
  const exists = edit ? (edit.kind === 'HOME' ? !!p.places.home : edit.kind === 'WORK' ? !!p.places.work : edit.kind !== 'CUSTOM') : false;
  const back = () => { setErr(null); if (p.mode.type === 'set') p.onClose(); else setEdit(null); };

  async function save() {
    if (!edit?.sel || (custom && !edit.name.trim())) return;
    setBusy(true); setErr(null);
    try {
      await api('/passenger/places', { method: 'PUT', body: { kind: edit.kind, name: custom ? edit.name.trim() : undefined, place: { label: edit.sel.label, lat: edit.sel.lat, lng: edit.sel.lng } } });
      p.onSaved(); back();
    } catch { setErr(t('common.somethingWrong')); } finally { setBusy(false); }
  }
  async function remove() {
    if (!edit) return;
    setBusy(true); setErr(null);
    try { await api('/passenger/places', { method: 'PUT', body: { kind: edit.kind, place: null } }); p.onSaved(); back(); }
    catch { setErr(t('common.somethingWrong')); } finally { setBusy(false); }
  }

  const title = edit ? (edit.kind === 'HOME' ? t('booking.form.homeTitle') : edit.kind === 'WORK' ? t('booking.form.workTitle') : edit.kind === 'CUSTOM' ? t('booking.form.addOwnPlace') : t('booking.form.editPlace')) : t('booking.form.savedTitle');
  const row = (key: string, icon: string, name: string, pl: Selected | null, editKind: Edit['kind']) => (
    <li key={key} className="flex items-center gap-2 border-t border-white/[0.06] first:border-t-0">
      <button type="button" data-testid={`saved-go-${key}`} onClick={() => (pl ? p.onGo(pl) : setEdit(startEdit(editKind)))} className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 py-2 text-start">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-base">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ink">{name}</span>
          <span className={`block truncate text-[13px] ${pl ? 'text-muted' : 'text-accent'}`}>{pl ? pl.label : `＋ ${t('booking.form.addPlace')}`}</span>
        </span>
      </button>
      {pl && (
        <button type="button" data-testid={`saved-edit-${key}`} onClick={() => setEdit(startEdit(editKind))} aria-label={t('booking.form.editPlace')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white/5">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>
        </button>
      )}
    </li>
  );

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-page text-ink sm:inset-auto sm:bottom-4 sm:start-4 sm:top-4 sm:w-[380px] sm:overflow-hidden sm:rounded-[18px] sm:border sm:border-edge sm:shadow-2xl" style={{ paddingTop: 'env(safe-area-inset-top)' }}
      role="dialog" aria-modal="true" aria-label={title} data-testid="saved-places">
      <div className="relative flex h-14 shrink-0 items-center justify-center px-3">
        <button type="button" onClick={edit ? back : p.onClose} aria-label={t('common.cancel')}
          className="absolute start-2 flex h-11 w-11 items-center justify-center rounded-full text-[30px] leading-none text-ink hover:bg-white/5">{edit && p.mode.type === 'list' ? <span className="text-2xl rtl:rotate-180">‹</span> : '×'}</button>
        <h2 className="text-lg font-bold">{title}</h2>
      </div>

      {!edit ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
          <ul>
            {row('home', '🏠', t('booking.form.home'), p.places.home, 'HOME')}
            {row('work', '💼', t('booking.form.work'), p.places.work, 'WORK')}
            {(p.places.custom ?? []).map((c) => row(c.id, '📍', c.name, c, c.id))}
          </ul>
          {!(p.places.custom ?? []).length && <p className="mt-2 text-[13px] text-muted">{t('booking.form.emptyPlaces')}</p>}
          <button type="button" data-testid="saved-add" onClick={() => setEdit({ kind: 'CUSTOM', name: '', sel: null, text: '' })}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-dashed border-accent/60 text-[15px] font-semibold text-accent">
            ＋ {t('booking.form.addOwnPlace')}
          </button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
          {custom && (
            <label className="mb-3 block">
              <span className="label">{t('booking.form.placeName')}</span>
              <input data-testid="saved-name" className="field mt-1" value={edit.name} maxLength={40} placeholder={t('booking.form.placeNamePh')}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus={edit.kind === 'CUSTOM'} />
            </label>
          )}
          <div>
            <PlacesInput kind="To" labelText={t('booking.form.placeAddress')} value={edit.sel} text={edit.text} autoFocus={!custom || edit.kind !== 'CUSTOM'}
              onText={(x) => setEdit((e) => (e ? { ...e, text: x } : e))} onSelect={(s) => setEdit((e) => (e ? { ...e, sel: s } : e))} />
          </div>
          {err && <p className="mt-2 text-sm text-danger">{err}</p>}
          <button type="button" data-testid="saved-save" onClick={save} disabled={busy || !edit.sel || (custom && !edit.name.trim())} className="btn-primary mt-4 min-h-[48px] w-full">
            {t('booking.form.savePlace')}
          </button>
          {exists && (
            <button type="button" data-testid="saved-remove" onClick={remove} disabled={busy} className="mt-3 min-h-[44px] w-full text-[15px] text-danger">{t('booking.form.removePlace')}</button>
          )}
        </div>
      )}
    </div>
  );
}
