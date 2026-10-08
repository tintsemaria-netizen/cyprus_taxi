'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n/I18nProvider';

// In-app confirmation (replaces native confirm()/alert()/prompt(), which look off-brand, can be
// blocked in installed PWAs/webviews and can't explain consequences — 2026-10-01 audit).
// Optional `input` turns it into a prompt with inline validation; onConfirm then receives the value.
export interface SheetInput {
  label: string;
  placeholder?: string;
  type?: 'text' | 'date';
  multiline?: boolean;
  required?: boolean;
  minLength?: number;
  initial?: string;
  hint?: string;
}

export function ConfirmSheet({
  title, body, confirmLabel, cancelLabel, danger = false, busy = false, input, onConfirm, onCancel,
}: {
  title: string; body?: React.ReactNode; confirmLabel: string; cancelLabel?: string; danger?: boolean; busy?: boolean;
  input?: SheetInput;
  onConfirm: (value?: string) => void; onCancel: () => void;
}) {
  const { t } = useT();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [value, setValue] = useState(input?.initial ?? '');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    (input ? fieldRef.current : cancelRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, input]);

  const trimmed = value.trim();
  const invalid = !!input && ((input.required && !trimmed) || (!!trimmed && (input.minLength ?? 0) > trimmed.length));
  const submit = () => { setTouched(true); if (!invalid) onConfirm(input ? trimmed : undefined); };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-4 sm:items-center sm:pb-0" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cs-title" aria-describedby={body ? 'cs-body' : undefined} className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()} style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <h2 id="cs-title" className="text-lg font-bold">{title}</h2>
        {body && <div id="cs-body" className="mt-2 text-sm text-muted">{body}</div>}
        {input && (
          <form className="mt-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label className="label" htmlFor="cs-input">{input.label}</label>
            {input.multiline ? (
              <textarea id="cs-input" ref={fieldRef} rows={3} className={`field mt-1 ${touched && invalid ? 'border-danger' : ''}`} placeholder={input.placeholder} value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={touched && invalid} />
            ) : (
              <input id="cs-input" ref={fieldRef} type={input.type ?? 'text'} className={`field mt-1 ${touched && invalid ? 'border-danger' : ''}`} placeholder={input.placeholder} value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={touched && invalid} />
            )}
            {touched && invalid ? (
              <p className="mt-1 text-xs text-danger">{input.minLength ? `At least ${input.minLength} characters.` : 'Required.'}</p>
            ) : input.hint ? <p className="mt-1 text-xs text-muted">{input.hint}</p> : null}
          </form>
        )}
        <div className="mt-5 grid gap-2">
          <button className={danger ? 'w-full rounded-[12px] border border-danger bg-danger/15 px-4 py-3 font-semibold text-danger disabled:opacity-50' : 'btn-primary w-full'} disabled={busy} onClick={submit}>{busy ? t('common.pleaseWait') : confirmLabel}</button>
          <button ref={cancelRef} className="btn-ghost w-full" disabled={busy} onClick={onCancel}>{cancelLabel ?? t('track.keepIt')}</button>
        </div>
      </div>
    </div>
  );
}
