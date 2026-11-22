import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { shareInternals, earningsUpPct } from '@/server/share';

// Co-rider proposal notifications (2026-11-19): the service worker re-words the server's English
// body into the app's language. Guard that both sides keep agreeing on the format.
function loadSw() {
  const src = fs.readFileSync('public/sw.js', 'utf8');
  const ctx: Record<string, unknown> = { self: { addEventListener() {}, registration: {} }, caches: {}, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx as unknown as { shareText: (tag: string, body: string, l: string) => { title: string; body: string } | null };
}

describe('co-rider push notifications', () => {
  const sw = loadSw();
  it('passenger proposal is shown in Russian with counts, extra time and «−30%» (no prices, 2026-11-22)', () => {
    const body = shareInternals.proposalBody({ passengerCount: 3, childCount: 1, luggageCount: 2 }, 5, 30);
    expect(sw.shareText('share-p-g1', body, 'ru')).toEqual({
      title: '👥 Нашёлся попутчик',
      body: 'взрослых: 2, детей: 1, чемоданов: 2 · +5 мин · −30% — нажмите, чтобы ответить',
    });
    expect(sw.shareText('share-p-g1', shareInternals.proposalBody({ passengerCount: 1, childCount: 0, luggageCount: 1 }, 0, 30), 'en')?.body)
      .toBe('1 adult(s), 1 suitcase(s) · about the same time · −30% — tap to answer');
  });
  it('driver proposal shows «+40%» earnings, no sums (2026-11-22)', () => {
    const body = shareInternals.driverProposalBody(4, earningsUpPct(8400, 6000));
    expect(sw.shareText('share-d-g1', body, 'ru')).toEqual({ title: '👥 Попутчик по пути', body: '+4 мин · увеличит заработок на +40% — нажмите, чтобы ответить' });
  });
  it('every language has the texts', () => {
    const body = shareInternals.proposalBody({ passengerCount: 1, childCount: 0, luggageCount: 0 }, 3, 30);
    for (const l of ['en', 'ru', 'el', 'de', 'fr', 'pl', 'he', 'ar']) expect(sw.shareText('share-p-x', body, l)).not.toBeNull();
  });
});
