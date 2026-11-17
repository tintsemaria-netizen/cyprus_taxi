import { describe, it, expect, vi, beforeAll } from 'vitest';

// A point a car cannot reach (pinned in the sea): the quote fails with NO_ROUTE and hands back the
// nearest street, from which the route works (2026-11-17).
const sea = { lat: 34.66, lng: 33.07, label: 'Molos, Limassol' };
const street = { lat: 34.6712, lng: 33.0465 };
vi.mock('@/server/google', async (orig) => ({
  ...(await orig<typeof import('@/server/google')>()),
  googleConfigured: () => true,
  googleRoute: vi.fn(async (_from: { lat: number }, to: { lat: number }) => (to.lat === sea.lat ? null : { distanceKm: 3.1, etaMinutes: 8, polyline: null })),
  googleSnapToStreet: vi.fn(async (lat: number) => (lat === sea.lat ? street : null)),
}));

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
import { createQuote } from '@/server/quote';
import { prisma } from '@/lib/db';

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to run DB tests on "${dbName}".`);
  await prisma.$queryRaw`SELECT 1`;
});

describe('unreachable points', () => {
  const pickup = { lat: 34.6932, lng: 33.0645, label: 'Lisandrou 2' };
  it('a destination in the sea → NO_ROUTE with the nearest street to move it to', async () => {
    const r = await createQuote({ pickup, dropoff: sea, vClass: 'COMFORT', passengerCount: 1 } as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NO_ROUTE');
    expect(r.snapped?.dropoff).toEqual(street);
    expect(r.snapped?.pickup).toBeUndefined();
  });
  it('from the snapped street the quote has a price', async () => {
    const r = await createQuote({ pickup, dropoff: { ...street, label: sea.label }, vClass: 'COMFORT', passengerCount: 1 } as never);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.quote.rangeLowCents).toBeGreaterThan(0);
  });
});
