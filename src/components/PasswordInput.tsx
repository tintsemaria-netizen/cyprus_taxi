'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { useT } from '@/i18n/I18nProvider';

// Password field with an eye button to show / hide what was typed (2026-11-13). Drop-in for
// <input type="password">: margin classes (mt-*) move to the wrapper so the eye stays centred.
export function PasswordInput({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const { t } = useT();
  const [show, setShow] = useState(false);
  const cls = className.split(/\s+/).filter(Boolean);
  const wrap = cls.filter((c) => /^m[tby]?-/.test(c)).join(' ');
  const input = cls.filter((c) => !/^m[tby]?-/.test(c)).join(' ');
  return (
    <div className={`relative ${wrap}`}>
      <input {...props} type={show ? 'text' : 'password'} className={`${input} pr-12`} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t('common.hidePassword') : t('common.showPassword')}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted hover:text-ink"
      >
        {show ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <path d="M3 3l18 18" strokeLinecap="round" />
            <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6 0 9.5 7 9.5 7a17.6 17.6 0 0 1-3.2 4.1M6.1 6.6C3.9 8.2 2.5 12 2.5 12s3.5 7 9.5 7a9.6 9.6 0 0 0 4.4-1.1" strokeLinecap="round" />
            <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
