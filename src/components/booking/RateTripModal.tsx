'use client';

import { useState } from 'react';
import { api, ApiRequestError } from '@/lib/api-client';

// Post-trip rating of the driver (Task 020). Shown from My rides for a COMPLETED ride that the
// passenger has not rated yet. Stars are required; tags and a comment are optional. The tag set
// shown depends on the star rating (positive for 4-5, constructive for 1-3) and the slugs match
// the server vocabulary in src/server/ratings.ts.

const POSITIVE: [string, string][] = [
  ['clean_car', 'Clean car'],
  ['safe_driving', 'Safe driving'],
  ['on_time', 'On time'],
  ['friendly', 'Friendly'],
  ['smooth_ride', 'Smooth ride'],
  ['great_route', 'Great route'],
];
const CONSTRUCTIVE: [string, string][] = [
  ['late', 'Late'],
  ['unsafe_driving', 'Unsafe driving'],
  ['rude', 'Rude'],
  ['dirty_car', 'Dirty car'],
  ['wrong_route', 'Wrong route'],
  ['hard_to_find', 'Hard to find'],
];

export function RateTripModal({ rideId, onClose, onDone }: { rideId: string; onClose: () => void; onDone: (stars: number) => void }) {
  const [stars, setStars] = useState(0);
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
    if (stars < 1) { setErr('Pick a star rating first.'); return; }
    setBusy(true); setErr(null);
    try {
      await api(`/passenger/rides/${rideId}/rating`, { method: 'POST', body: { stars, tags, comment: comment.trim() || undefined } });
      onDone(stars);
    } catch (e) {
      if (e instanceof ApiRequestError) setErr(e.body.message);
      else setErr('Could not submit your rating. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Rate your trip</h2>
        <p className="mt-1 text-sm text-muted">How was your ride with the driver?</p>

        <div className="mt-4 flex justify-center gap-1" role="radiogroup" aria-label="Star rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
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
            <div className="mt-4 flex flex-wrap gap-2">
              {tagSet.map(([slug, label]) => (
                <button
                  key={slug}
                  type="button"
                  aria-pressed={tags.includes(slug)}
                  onClick={() => toggleTag(slug)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${tags.includes(slug) ? 'border-accent bg-accent text-[#0d1608]' : 'border-edge text-muted hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              className="field mt-3 h-20 resize-none"
              maxLength={500}
              placeholder="Add a comment (optional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </>
        )}

        {err && <p className="mt-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}

        <button className="btn-primary mt-4 w-full" disabled={busy || stars < 1} onClick={submit}>{busy ? 'Submitting…' : 'Submit rating'}</button>
        <button className="mt-2 block w-full text-center text-xs text-muted hover:text-ink" onClick={onClose}>Not now</button>
      </div>
    </div>
  );
}
