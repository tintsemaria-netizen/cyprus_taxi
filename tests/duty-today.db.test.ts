import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { dutyToday } from '@/server/driver/duty';
import type { CreateBookingInput } from '@/lib/validation';

// «Время на линии» window (2026-11-20). A past week (March 2025) so other tests' sessions don't count.
describe('dutyToday', () => {
  it('adds the day\'s sessions (an open one up to now), splits on-order time, clips to the day, sums the week', async () => {
    const d = await prisma.driver.findFirst({ where: { publicName: 'Maria' }, include: { bindings: { where: { endedAt: null } } } });
    if (!d || !d.bindings[0]) throw new Error('fixture Maria missing');
    const driverId = d.id;
    const day = new Date('2025-03-14T00:00:00+02:00'), week = new Date('2025-03-10T00:00:00+02:00'), now = new Date('2025-03-14T15:00:00+02:00');
    const h = (x: number) => new Date(day.getTime() + x * 3600_000);
    await prisma.dutySession.createMany({ data: [
      { driverId, onlineAt: new Date(day.getTime() - 3600_000), offlineAt: h(1) },   // from 23:00 the day before → 1 h today
      { driverId, onlineAt: h(8), offlineAt: h(11.5) },                              // 3 h 30 min
      { driverId, onlineAt: h(13), offlineAt: h(20) },                               // «still online» at 15:00 → 2 h
      { driverId, onlineAt: new Date('2025-03-12T09:00:00+02:00'), offlineAt: new Date('2025-03-12T12:00:00+02:00') }, // Wednesday
    ] });
    const r0 = await createBooking({ pickup: { lat: 34.6706, lng: 33.0413, label: 'Marina' }, dropoff: { lat: 34.8751, lng: 33.6249, label: 'LCA' }, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Duty', phone: '+35799123456' } as CreateBookingInput, `duty-${Date.now()}`);
    if (!r0.ok) throw new Error('create failed');
    const b = (await prisma.booking.findUnique({ where: { reference: r0.body.reference } }))!;
    await prisma.assignment.create({ data: { bookingId: b.id, driverId, vehicleId: d.bindings[0].vehicleId, driverPublicName: 'x', driverPhone: 'x', vehiclePlate: 'x', vehicleMake: 'x', vehicleModel: 'x', vehicleColor: 'x', vehicleClass: 'COMFORT', actor: 'SYSTEM', reason: 'completed', assignedAt: h(9), endedAt: h(10) } });

    const r = await dutyToday(driverId, day, week, now);
    expect(r.sessions.length).toBe(3);
    expect(r.onlineSec).toBe((1 + 3.5 + 2) * 3600);
    expect(r.onTripSec).toBe(3600);
    expect(r.freeSec).toBe(r.onlineSec - 3600);
    expect(r.weekSec).toBe((3 + 2 + 3.5 + 2) * 3600); // Wed 3 h + Thu 23:00 → Fri 01:00 + today's 5 h 30
  });
});
