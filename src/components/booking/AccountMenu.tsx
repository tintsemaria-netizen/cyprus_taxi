'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';
import { markLeftViaMenu, consumeMenuReopen } from '@/lib/navTrail';

export interface PassengerInfo { phone: string | null; name?: string | null; email?: string | null }

// Signed-in account control (Task 019). A circular initials avatar in the header top-right that
// opens an account menu — desktop dropdown, mobile bottom sheet — with the identity, My rides,
// Profile settings, Notifications, Help and Log out (last). Replaces the "Login" link when a
// passenger session exists. Follows the researched pattern: identity header, log out last,
// aria-haspopup/expanded, Esc + outside-click close, focus returns to the trigger.
export function AccountMenu({ passenger, onLoggedOut }: { passenger: PassengerInfo; onLoggedOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const { t } = useT();

  // Coming back (‹) to the page the menu was used on reopens the menu — that was the previous step.
  useEffect(() => {
    const check = () => { if (consumeMenuReopen()) setOpen(true); };
    check();
    window.addEventListener('pageshow', check);
    return () => window.removeEventListener('pageshow', check);
  }, []);

  const label = passenger.name?.trim() || passenger.email || passenger.phone || '';
  const secondary = passenger.email || passenger.phone || '';
  const initials = deriveInitials(passenger);

  // Close on outside-click and Esc; restore focus to the trigger.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return; // menu may be portaled
      close();
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
     
  }, [open]);

  function close() { setOpen(false); btnRef.current?.focus(); }

  async function logout() {
    setBusy(true);
    try { await api('/passenger/logout', { method: 'POST' }); onLoggedOut(); setOpen(false); }
    catch { /* keep menu open; user can retry */ }
    finally { setBusy(false); }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('auth.menu.button')}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-sm font-semibold text-[#0d1608] transition hover:opacity-90"
      >
        {initials}
      </button>

      {open && (
        // Portaled to <body>: the header uses backdrop-blur, and a backdrop-filter ancestor becomes
        // the containing block for position:fixed — the mobile bottom sheet then anchored to the
        // header's bottom edge and opened off-screen above it. On desktop the dropdown is
        // positioned from the trigger's rect instead of relative to the header.
        <MenuPortal anchor={btnRef}>
          {/* Mobile scrim (sheet). Desktop dropdown ignores it. */}
          <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" onClick={close} aria-hidden />
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={t('auth.menu.label')}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-[16px] border border-edge bg-elevated p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-auto sm:right-[var(--menu-right)] sm:top-[var(--menu-top)] sm:w-64 sm:rounded-[14px] sm:pb-2 sm:shadow-xl"
          >
            {/* Identity header → profile settings */}
            <a href="/account" role="menuitem" className="flex items-center gap-3 rounded-[10px] px-3 py-3 hover:bg-page" onClick={() => { markLeftViaMenu(); setOpen(false); }}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-[#0d1608]">{initials}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{label}</span>
                <span className="block truncate text-xs text-muted">{secondary}</span>
              </span>
            </a>
            <div className="my-1 border-t border-edge" />
            <MenuLink href="/rides" onSelect={() => { markLeftViaMenu(); setOpen(false); }}>{t('auth.myRides')}</MenuLink>
            <MenuLink href="/prebookings" onSelect={() => { markLeftViaMenu(); setOpen(false); }}>{t('rides.prebookings.menu')}</MenuLink>
            <MenuLink href="/account#places" onSelect={() => { markLeftViaMenu(); setOpen(false); }}>{t('auth.menu.savedPlaces')}</MenuLink>
            <MenuLink href="/account" onSelect={() => { markLeftViaMenu(); setOpen(false); }}>{t('auth.menu.profile')}</MenuLink>
            <MenuLink href="/privacy" onSelect={() => { markLeftViaMenu(); setOpen(false); }}>{t('auth.menu.help')}</MenuLink>
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm text-muted">{t('common.language')}</span>
              <LanguageSwitcher />
            </div>
            <div className="my-1 border-t border-edge" />
            <button role="menuitem" onClick={logout} disabled={busy} className="w-full rounded-[10px] px-3 py-3 text-left text-sm text-danger hover:bg-page disabled:opacity-60">
              {busy ? t('auth.signingOut') : t('auth.logOut')}
            </button>
          </div>
        </MenuPortal>
      )}
    </div>
  );
}

// Renders children into <body> and exposes the trigger's position as CSS variables
// (--menu-top / --menu-right) for the desktop dropdown.
function MenuPortal({ anchor, children }: { anchor: React.RefObject<HTMLButtonElement | null>; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    function place() {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);
  if (!pos) return null;
  return createPortal(
    <div style={{ '--menu-top': `${pos.top}px`, '--menu-right': `${pos.right}px` } as React.CSSProperties}>{children}</div>,
    document.body,
  );
}

function MenuLink({ href, onSelect, children }: { href: string; onSelect: () => void; children: React.ReactNode }) {
  return <a href={href} role="menuitem" onClick={onSelect} className="block rounded-[10px] px-3 py-3 text-sm hover:bg-page">{children}</a>;
}

function deriveInitials(p: PassengerInfo): string {
  const n = p.name?.trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || n[0]!.toUpperCase();
  }
  const src = p.email || p.phone || '?';
  const firstAlnum = src.replace(/[^a-zA-Z0-9]/g, '')[0];
  return (firstAlnum ?? '?').toUpperCase();
}
