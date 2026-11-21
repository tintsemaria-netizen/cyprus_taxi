import { describe, it, expect } from 'vitest';
import { prebookTiming } from '@/lib/share';

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
