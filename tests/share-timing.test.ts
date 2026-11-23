import { describe, it, expect } from 'vitest';
import { prebookTiming, bestPrebookPlan, comparePairs, type LegFn } from '@/lib/share';

// Ride-share pre-booking time window (2026-11-21): each passenger may leave up to N min later
// (wait) and, now, up to N min EARLIER. The start keeps «nobody earlier» when that fits.
const at = (hm: string) => new Date(`2026-11-22T${hm}:00+02:00`);
const hhmm = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Nicosia', hour: '2-digit', minute: '2-digit' });

describe('prebookTiming', () => {
  it('as before: the host waits for a later co-rider; nobody leaves earlier', () => {
    const r = prebookTiming(at('13:00'), at('13:30'), 10, 30, 15)!;
    expect(hhmm(r.startAt)).toBe('13:20'); // car at the co-rider 13:30
    expect(r.hostWait).toBe(20);
    expect(r.guestWait).toBe(0);
  });

  it('too far apart one way → no pair without «earlier»', () => {
    expect(prebookTiming(at('13:00'), at('14:30'), 10, 30, 15)).toBeNull();
  });

  it('the later passenger may leave earlier → pair found, they leave earlier', () => {
    const r = prebookTiming(at('13:00'), at('14:30'), 10, 30, 15, 0, 60)!;
    expect(r).not.toBeNull();
    expect(hhmm(r.startAt)).toBe('13:30'); // host waits the full 30 min…
    expect(r.hostWait).toBe(30);
    expect(r.guestWait).toBe(-50); // …co-rider picked up 13:40, 50 min earlier than booked
  });

  it('the earlier passenger may leave earlier too (co-rider booked before them)', () => {
    const r = prebookTiming(at('13:00'), at('12:40'), 10, 0, 0, 30, 0)!;
    expect(hhmm(r.startAt)).toBe('12:30');
    expect(r.hostWait).toBe(-30);
    expect(r.guestWait).toBe(0);
  });

  it('windows that do not overlap → null; exact times both → only an exact fit', () => {
    expect(prebookTiming(at('13:00'), at('12:00'), 10, 0, 0, 20, 0)).toBeNull();
    expect(prebookTiming(at('13:00'), at('13:10'), 10, 0, 0)).not.toBeNull();
    expect(prebookTiming(at('13:00'), at('13:11'), 10, 0, 0)).toBeNull();
  });
});

// TZ «Попутчик −30%» (2026-11-23): at most 15 extra minutes in the car per passenger vs riding alone.
describe('extra-minutes limit and pair choice', () => {
  const P = (id: number) => ({ lat: id, lng: 0 });
  const pts = { Hp: P(1), Hd: P(2), Gp: P(3), Gd: P(4) };
  const table = (gpHd: number): LegFn => (a, b) => {
    const k = `${a.lat}-${b.lat}`;
    const m: Record<string, number> = { '1-2': 30, '1-3': 5, '3-2': gpHd, '2-4': 1, '3-4': 40, '4-2': 50 };
    return m[k] ?? 99;
  };
  it('15 extra minutes fits, 16 does not', () => {
    const ok = bestPrebookPlan(pts, table(40), { hostMaxExtra: 15, guestMaxExtra: 15 });
    expect(ok?.extraHost).toBe(15);
    expect(bestPrebookPlan(pts, table(41), { hostMaxExtra: 15, guestMaxExtra: 15 })).toBeNull();
  });
  it('several fit: the smaller largest pickup shift wins first, then the smaller total detour', () => {
    expect(comparePairs({ hostWait: 0, guestWait: -10, extraHost: 1, extraGuest: 1 }, { hostWait: 5, guestWait: -5, extraHost: 9, extraGuest: 9 })).toBeGreaterThan(0);
    expect(comparePairs({ hostWait: 0, guestWait: -5, extraHost: 3, extraGuest: 2 }, { hostWait: 5, guestWait: 0, extraHost: 4, extraGuest: 4 })).toBeLessThan(0);
  });
});
