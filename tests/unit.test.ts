import { describe, it, expect } from 'vitest';
import { canTransition, allowedNext, isTerminal } from '@/lib/status-machine';
import { haversineMeters, pointInPolygon, DEMO_CYPRUS_POLYGON, validCoord } from '@/lib/geo';
import { computeFreshness } from '@/lib/freshness';
import { bookingReference, encryptReceipt, decryptReceipt } from '@/lib/crypto';
import { nicosiaWallTimeToUtc } from '@/lib/timezone';

describe('status machine', () => {
  it('allows only legal transitions', () => {
    expect(canTransition('REQUESTED', 'ASSIGNED', 'STAFF')).toBe(true);
    expect(canTransition('REQUESTED', 'ASSIGNED', 'DRIVER')).toBe(false);
    expect(canTransition('ASSIGNED', 'EN_ROUTE', 'DRIVER')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED', 'DRIVER')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'CANCELED', 'PASSENGER')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'CANCELED', 'STAFF')).toBe(false); // only via terminate
  });
  it('forbids reopening terminal states', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('CANCELED')).toBe(true);
    expect(allowedNext('COMPLETED', 'STAFF')).toEqual([]);
    expect(canTransition('CANCELED', 'REQUESTED', 'STAFF')).toBe(false);
  });
  it('passenger can only cancel from pre-pickup states', () => {
    expect(canTransition('REQUESTED', 'CANCELED', 'PASSENGER')).toBe(true);
    expect(canTransition('ARRIVED', 'CANCELED', 'PASSENGER')).toBe(true);
  });
});

describe('geo', () => {
  it('measures distance', () => {
    const marina = { lat: 34.6706, lng: 33.0413 };
    const lca = { lat: 34.8751, lng: 33.6249 };
    const d = haversineMeters(marina, lca);
    expect(d).toBeGreaterThan(50000);
    expect(d).toBeLessThan(70000);
  });
  it('validates coordinates', () => {
    expect(validCoord({ lat: 34.6, lng: 33.0 })).toBe(true);
    expect(validCoord({ lat: 200, lng: 33.0 })).toBe(false);
    expect(validCoord({ lat: NaN, lng: 33 })).toBe(false);
  });
  it('point-in-polygon over Cyprus area', () => {
    expect(pointInPolygon({ lat: 34.9, lng: 33.2 }, DEMO_CYPRUS_POLYGON)).toBe(true);
    expect(pointInPolygon({ lat: 48.0, lng: 2.0 }, DEMO_CYPRUS_POLYGON)).toBe(false);
  });
});

describe('freshness', () => {
  it('classifies by age', () => {
    const now = new Date('2026-01-01T00:02:00Z');
    expect(computeFreshness(new Date('2026-01-01T00:01:50Z'), new Date('2026-01-01T00:01:50Z'), now)).toBe('fresh');
    expect(computeFreshness(new Date('2026-01-01T00:01:00Z'), new Date('2026-01-01T00:01:00Z'), now)).toBe('stale');
    expect(computeFreshness(new Date('2025-12-31T23:59:00Z'), new Date('2025-12-31T23:59:00Z'), now)).toBe('disconnected');
  });
});

describe('booking reference', () => {
  it('has expected shape', () => {
    expect(bookingReference()).toMatch(/^CY-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});

describe('Europe/Nicosia wall-time conversion', () => {
  const iso = (r: ReturnType<typeof nicosiaWallTimeToUtc>) => (r.ok ? r.utc.toISOString() : `!${r.reason}`);

  it('summer (UTC+3) and winter (UTC+2)', () => {
    expect(iso(nicosiaWallTimeToUtc('2026-09-11T12:00'))).toBe('2026-09-11T09:00:00.000Z');
    expect(iso(nicosiaWallTimeToUtc('2026-01-15T12:00'))).toBe('2026-01-15T10:00:00.000Z');
  });

  it('spring-forward gap is rejected', () => {
    const r = nicosiaWallTimeToUtc('2026-03-29T03:30');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('GAP');
  });

  it('autumn fold is ambiguous and honours an explicit offset choice', () => {
    const r = nicosiaWallTimeToUtc('2026-10-25T03:30');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('AMBIGUOUS');
      expect(r.options).toEqual(['180', '120']);
    }
    // UTC+3 occurrence
    expect(iso(nicosiaWallTimeToUtc('2026-10-25T03:30', 180))).toBe('2026-10-25T00:30:00.000Z');
    // UTC+2 occurrence
    expect(iso(nicosiaWallTimeToUtc('2026-10-25T03:30', 120))).toBe('2026-10-25T01:30:00.000Z');
  });

  it('rejects invalid dates and malformed input', () => {
    expect(nicosiaWallTimeToUtc('2026-02-30T10:00').ok).toBe(false);
    expect(nicosiaWallTimeToUtc('not-a-date').ok).toBe(false);
    expect(nicosiaWallTimeToUtc('2026-13-01T10:00').ok).toBe(false);
    expect(nicosiaWallTimeToUtc('2026-09-11T25:00').ok).toBe(false);
  });
});

describe('receipt encryption', () => {
  it('round-trips and is not plaintext', () => {
    const payload = JSON.stringify({ token: 'secret-token', reference: 'CY-XXXX-YYYY' });
    const enc = encryptReceipt(payload);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc.includes('secret-token')).toBe(false);
    expect(decryptReceipt(enc)).toBe(payload);
  });
  it('reads legacy plaintext receipts as-is', () => {
    const legacy = '{"token":"x"}';
    expect(decryptReceipt(legacy)).toBe(legacy);
  });
});
