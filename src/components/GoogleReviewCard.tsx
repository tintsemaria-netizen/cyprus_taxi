'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

// «Leave us a review on Google» (2026-11-17). Shown to EVERY passenger after a completed ride —
// whatever stars they gave: Google's rules forbid asking only happy customers (no review gating).
// The link comes from admin settings (Place ID → Google's write-review page); without it nothing shows.
let cached: Promise<string | null> | null = null;
function reviewUrl(): Promise<string | null> {
  if (!cached) cached = api<{ googleReviewUrl?: string | null }>('/public/config', { timeoutMs: 8000 }).then((c) => c.googleReviewUrl ?? null).catch(() => { cached = null; return null; });
  return cached;
}

export function GoogleReviewCard({ compact = false, modal = false, onClose }: { compact?: boolean; modal?: boolean; onClose?: () => void }) {
  const { t } = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem('il-y-review-done') === '1') { setHidden(true); return; } } catch { /* storage off */ }
    let alive = true;
    void reviewUrl().then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, []);
  if (!url || hidden) return null;
  const close = () => { setHidden(true); onClose?.(); };
  const done = () => { try { localStorage.setItem('il-y-review-done', '1'); } catch { /* ignore */ } close(); };
  const card = (
    <div className={modal ? 'card w-full max-w-sm p-5' : `rounded-[14px] border border-edge bg-elevated ${compact ? 'p-3' : 'p-4'}`} data-testid="google-review" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-lg text-accent" aria-hidden>★</span>
        <div className="min-w-0">
          <div className="font-semibold">{t('common.review.title')}</div>
          <p className="mt-0.5 text-sm text-muted">{t('common.review.body')}</p>
        </div>
      </div>
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={done} className="btn-primary mt-3 w-full" data-testid="google-review-link">{t('common.review.cta')}</a>
      <button type="button" onClick={close} className="mt-1 block w-full py-1.5 text-center text-xs text-muted hover:text-ink">{t('common.review.later')}</button>
    </div>
  );
  // modal (2026-11-17): a separate window over everything, right after the passenger rated the trip.
  // Portal to <body> so no sheet/header stacking context can sit on top of it.
  if (modal) return createPortal(<div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 px-4" onClick={close} role="dialog" aria-modal="true">{card}</div>, document.body);
  return card;
}
