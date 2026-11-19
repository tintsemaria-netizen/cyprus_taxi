import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { shareInternals } from '@/server/share';

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
  it('passenger proposal is shown in Russian with counts, extra time and saving', () => {
    const body = shareInternals.proposalBody({ passengerCount: 3, childCount: 1, luggageCount: 2 }, 5, 2116);
    expect(sw.shareText('share-p-g1', body, 'ru')).toEqual({
      title: '👥 Нашёлся попутчик',
      body: 'взрослых: 2, детей: 1, чемоданов: 2 · +5 мин · дешевле на €21.16 — нажмите, чтобы ответить',
    });
    expect(sw.shareText('share-p-g1', shareInternals.proposalBody({ passengerCount: 1, childCount: 0, luggageCount: 1 }, 0, 900), 'en')?.body)
      .toBe('1 adult(s), 1 suitcase(s) · about the same time · €9.00 cheaper — tap to answer');
  });
  it('driver proposal shows "was → now" in the app language', () => {
    const body = shareInternals.driverProposalBody(4, 10780, 6500);
    expect(sw.shareText('share-d-g1', body, 'ru')).toEqual({ title: '👥 Попутчик по пути', body: '+4 мин · €107.80 вместо €65.00 — нажмите, чтобы ответить' });
  });
  it('every language has the texts', () => {
    const body = shareInternals.proposalBody({ passengerCount: 1, childCount: 0, luggageCount: 0 }, 3, 500);
    for (const l of ['en', 'ru', 'el', 'de', 'fr', 'pl', 'he', 'ar']) expect(sw.shareText('share-p-x', body, l)).not.toBeNull();
  });
});
