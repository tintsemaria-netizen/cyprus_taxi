import { describe, it, expect } from 'vitest';
import { pairStops, coRiderNext, type PairBooking } from '@/lib/pair-stops';

const b = (id: string, status: string): PairBooking => ({
  id, status, passengerName: id,
  pickupLat: 1, pickupLng: 1, pickupLabel: `${id} from`, dropoffLat: 2, dropoffLng: 2, dropoffLabel: `${id} to`,
});
const plan = [
  { kind: 'pickup', who: 'host' }, { kind: 'pickup', who: 'guest' }, { kind: 'dropoff', who: 'guest' }, { kind: 'dropoff', who: 'host' },
] as const;

describe('pair stops on the driver navigation (2026-11-22)', () => {
  it('numbers the stops in trip order and marks the primary trip', () => {
    const p = pairStops([...plan], b('H', 'EN_ROUTE'), b('G', 'EN_ROUTE'), 'H');
    expect(p.stops.map((s) => [s.n, s.kind, s.primary, s.label])).toEqual([
      [1, 'pickup', true, 'H from'], [2, 'pickup', false, 'G from'], [3, 'dropoff', false, 'G to'], [4, 'dropoff', true, 'H to'],
    ]);
    expect(p.next).toBe(0);
    expect(coRiderNext(p)).toBeNull(); // the primary pickup leads
  });
  it('host on board → the co-rider pickup is next and leads the route', () => {
    const p = pairStops([...plan], b('H', 'IN_PROGRESS'), b('G', 'EN_ROUTE'), 'H');
    expect(p.next).toBe(1);
    expect(coRiderNext(p)?.bookingId).toBe('G');
  });
  it('waiting at the co-rider (ARRIVED) keeps that stop; once on board → their drop-off', () => {
    expect(pairStops([...plan], b('H', 'IN_PROGRESS'), b('G', 'ARRIVED'), 'H').next).toBe(1);
    const p = pairStops([...plan], b('H', 'IN_PROGRESS'), b('G', 'IN_PROGRESS'), 'H');
    expect([p.next, coRiderNext(p)?.kind]).toEqual([2, 'dropoff']);
  });
  it('co-rider dropped (or cancelled) → the primary destination; all done → nothing next', () => {
    for (const st of ['COMPLETED', 'CANCELED']) {
      const p = pairStops([...plan], b('H', 'IN_PROGRESS'), b('G', st), 'H');
      expect([p.next, coRiderNext(p)]).toEqual([3, null]);
    }
    expect(pairStops([...plan], b('H', 'COMPLETED'), b('G', 'COMPLETED'), 'G').next).toBeNull();
  });
});
