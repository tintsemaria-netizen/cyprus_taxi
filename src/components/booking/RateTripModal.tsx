'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

// Post-trip rating of the driver (Task 020). Shown from My rides for a COMPLETED ride that the
// passenger has not rated yet. Stars are required; tags and a comment are optional. The tag set
// shown depends on the star rating (positive for 4-5, constructive for 1-3) and the slugs match
// the server vocabulary in src/server/ratings.ts.

// Two suggestions per band (2026-11-18) to keep the card small.
const POSITIVE = ['safe_driving', 'clean_car'] as const;
const CONSTRUCTIVE = ['late', 'unsafe_driving'] as const;

export function RateTripModal({ rideId, onClose, onDone, postUrl, inline }: { rideId?: string; onClose?: () => void; onDone: (stars: number) => void; postUrl?: string; inline?: boolean }) {
  const { t, tp, tError } = useT();
  const [stars, setStars] = useState(5);
  const [hover, setHover] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tagSet = stars >= 4 ? POSITIVE : CONSTRUCTIVE;

  function pickStars(n: number) {
    // Switching between positive/constructive bands clears tags that no longer apply.
    const band = n >= 4;
    const prevBand = stars >= 4;
    if (stars === 0 || band !== prevBand) setTags([]);
    setStars(n);
  }
  function toggleTag(slug: string) {
    setTags((t) => (t.includes(slug) ? t.filter((x) => x !== slug) : t.length < 5 ? [...t, slug] : t));
  }

  async function submit() {
    if (stars < 1) { setErr(t('rides.rate.pickStars')); return; }
    setBusy(true); setErr(null);
    try {
      await api(postUrl ?? `/passenger/rides/${rideId}/rating`, { method: 'POST', body: { stars, tags, comment: comment.trim() || undefined } });
      onDone(stars);
    } catch (e) {
      setErr(tError(e));
    } finally { setBusy(false); }
  }

  const content = (
    <>
        <h2 className="text-lg font-bold">{t('rides.rate.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('rides.rate.subtitle')}</p>

        <div className="mt-4 flex justify-center gap-1" role="radiogroup" aria-label={t('rides.rate.starsLabel')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={tp('rides.rate.star', n)}
              className="p-1 text-3xl leading-none transition"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => pickStars(n)}
            >
              <span className={(hover || stars) >= n ? 'text-accent' : 'text-muted/40'}>★</span>
            </button>
          ))}
        </div>

        {stars > 0 && (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {tagSet.map((slug) => (
                <button
                  key={slug}
                  type="button"
                  aria-pressed={tags.includes(slug)}
                  onClick={() => toggleTag(slug)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${tags.includes(slug) ? 'border-accent bg-accent text-[#0d1608]' : 'border-edge text-muted hover:text-ink'}`}
                >
                  {t(`rides.rate.tags.${slug}`)}
                </button>
              ))}
            </div>
            <textarea
              className="field mt-3 !min-h-0 h-11 resize-none !py-2.5 text-sm"
              rows={1}
              maxLength={500}
              placeholder={t('rides.rate.commentPlaceholder')}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </>
        )}

        {err && <p className="mt-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}

        <button className="btn-primary mt-4 w-full" disabled={busy || stars < 1} onClick={submit}>{busy ? t('rides.rate.submitting') : t('rides.rate.submit')}</button>
        {!inline && <button className="mt-2 block w-full text-center text-xs text-muted hover:text-ink" onClick={onClose}>{t('rides.rate.notNow')}</button>}
    </>
  );
  // inline: the same card embedded in the finished-ride screen (no overlay, no «Не сейчас»).
  if (inline) return <div className="rounded-[16px] border border-accent/40 bg-accent/5 p-4">{content}</div>;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>{content}</div>
    </div>
  );
}
