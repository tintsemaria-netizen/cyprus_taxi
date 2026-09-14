'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api-client';

export interface PassengerInfo { phone: string; name?: string | null; email?: string | null }

// Signed-in account control (Task 019). A circular initials avatar in the header top-right that
// opens an account menu — desktop dropdown, mobile bottom sheet — with the identity, My rides,
// Profile settings, Notifications, Help and Log out (last). Replaces the "Login" link when a
// passenger session exists. Follows the researched pattern: identity header, log out last,
// aria-haspopup/expanded, Esc + outside-click close, focus returns to the trigger.
export function AccountMenu({ passenger, onLoggedOut }: { passenger: PassengerInfo; onLoggedOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const label = passenger.name?.trim() || passenger.email || passenger.phone;
  const secondary = passenger.email || passenger.phone;
  const initials = deriveInitials(passenger);

  // Close on outside-click and Esc; restore focus to the trigger.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) { if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        aria-label="Account menu"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-sm font-semibold text-[#0d1608] transition hover:opacity-90"
      >
        {initials}
      </button>

      {open && (
        <>
          {/* Mobile scrim (sheet). Desktop dropdown ignores it. */}
          <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" onClick={close} aria-hidden />
          <div
            id={menuId}
            role="menu"
            aria-label="Account"
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-[16px] border border-edge bg-elevated p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:absolute sm:inset-auto sm:right-0 sm:top-12 sm:w-64 sm:rounded-[14px] sm:pb-2 sm:shadow-xl"
          >
            {/* Identity header → profile settings */}
            <a href="/account" role="menuitem" className="flex items-center gap-3 rounded-[10px] px-3 py-3 hover:bg-page" onClick={() => setOpen(false)}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-[#0d1608]">{initials}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{label}</span>
                <span className="block truncate text-xs text-muted">{secondary}</span>
              </span>
            </a>
            <div className="my-1 border-t border-edge" />
            <MenuLink href="/rides" onSelect={() => setOpen(false)}>My rides</MenuLink>
            <MenuLink href="/account#places" onSelect={() => setOpen(false)}>Saved places</MenuLink>
            <MenuLink href="/account" onSelect={() => setOpen(false)}>Profile settings</MenuLink>
            <MenuLink href="/privacy" onSelect={() => setOpen(false)}>Help &amp; privacy</MenuLink>
            <div className="my-1 border-t border-edge" />
            <button role="menuitem" onClick={logout} disabled={busy} className="w-full rounded-[10px] px-3 py-3 text-left text-sm text-danger hover:bg-page disabled:opacity-60">
              {busy ? 'Signing out…' : 'Log out'}
            </button>
          </div>
        </>
      )}
    </div>
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
