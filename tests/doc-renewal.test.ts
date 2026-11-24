import { describe, it, expect } from 'vitest';
import { slotStates } from '@/server/doc-renewal';

// Per document type, newest wins; an upload waiting for the admin keeps the driver working (2026-11-24).
const now = new Date('2026-12-01T10:00:00Z');
const day = 86_400_000;
const row = (id: string, slot: string, decision: string, createdDaysAgo: number, expiresInDays: number | null) => ({
  id, slot, decision, scanStatus: 'CLEAN', decisionNote: null,
  createdAt: new Date(now.getTime() - createdDaysAgo * day), expiresAt: expiresInDays == null ? null : new Date(now.getTime() + expiresInDays * day),
});

describe('document slot states', () => {
  it('marks from 7 days, blocks when expired with nothing waiting', () => {
    expect(slotStates([row('a', 'insurance', 'ACCEPTED', 300, 8)], now)[0]).toMatchObject({ needsRenewal: false, blocking: false, daysLeft: 8 });
    expect(slotStates([row('a', 'insurance', 'ACCEPTED', 300, 7)], now)[0]).toMatchObject({ needsRenewal: true, blocking: false });
    expect(slotStates([row('a', 'insurance', 'ACCEPTED', 300, -1)], now)[0]).toMatchObject({ expired: true, blocking: true });
  });
  it('an upload waiting for the admin: works on, no marker; sent back: blocked again', () => {
    const waiting = slotStates([row('a', 'insurance', 'ACCEPTED', 300, -1), row('b', 'insurance', 'PENDING', 1, null)], now)[0];
    expect(waiting).toMatchObject({ expired: true, blocking: false, needsRenewal: false, renewal: { id: 'b', decision: 'PENDING' } });
    const back = slotStates([row('a', 'insurance', 'ACCEPTED', 300, -1), row('b', 'insurance', 'CHANGES', 1, null)], now)[0];
    expect(back).toMatchObject({ blocking: true, renewal: { decision: 'CHANGES' } });
  });
  it('only the four expiring documents, and only once accepted', () => {
    expect(slotStates([row('a', 'selfie', 'ACCEPTED', 300, -1), row('b', 'taxi_licence', 'PENDING', 1, null)], now)).toEqual([]);
    const s = slotStates([row('old', 'licence_front', 'ACCEPTED', 900, -400), row('new', 'licence_front', 'ACCEPTED', 300, 200)], now)[0];
    expect(s).toMatchObject({ accepted: { id: 'new' }, blocking: false, renewal: null });
  });
});
