import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking } from '@/server/assignments';
import { listMessages, postMessage, driverOwnsBooking } from '@/server/chat';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput => ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Chat', phone: '+35799123456' } as CreateBookingInput);

let n = 0;
const RUN = `${Date.now()}`;

async function ready(name: 'Andreas' | 'Maria') {
  const d = await prisma.driver.findFirst({ where: { publicName: name }, include: { bindings: { where: { endedAt: null } } } });
  if (!d || !d.bindings[0]) throw new Error(`fixture ${name} missing`);
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  return { driverId: d.id, vehicleId: d.bindings[0].vehicleId };
}
async function assigned() {
  const { driverId, vehicleId } = await ready('Andreas');
  const r = await createBooking(input(), `chat-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create failed');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  const a = await assignBooking({ bookingId: b.id, driverId, vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
  if (!a.ok) throw new Error('assign failed');
  return { bookingId: b.id, driverId };
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});
beforeEach(async () => {
  await prisma.chatMessage.deleteMany({});
  await prisma.fare.deleteMany({});
  await prisma.waitingSession.deleteMany({});
  await prisma.driverOffer.deleteMany({});
  await prisma.dispatchJob.deleteMany({});
  await prisma.bookingEvent.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.trackingGrant.deleteMany({});
  await prisma.latestDriverLocation.deleteMany({});
  await prisma.idempotencyReceipt.deleteMany({});
  await prisma.booking.deleteMany({});
  for (const name of ['Andreas', 'Maria']) {
    const d = await prisma.driver.findFirst({ where: { publicName: name } });
    if (d) await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false, available: false } });
  }
});

describe('passenger↔driver chat', () => {
  it('both sides exchange messages in order while assigned', async () => {
    const { bookingId } = await assigned();
    expect((await postMessage(bookingId, 'PASSENGER', 'Hi, where are you?')).ok).toBe(true);
    expect((await postMessage(bookingId, 'DRIVER', '2 minutes away')).ok).toBe(true);
    const list = await listMessages(bookingId);
    expect(list.open).toBe(true);
    expect(list.messages.map((m) => m.sender)).toEqual(['PASSENGER', 'DRIVER']);
    expect(list.messages[0].body).toBe('Hi, where are you?');
  });

  it('driver may chat only on their own active assignment', async () => {
    const { bookingId, driverId } = await assigned();
    expect(await driverOwnsBooking(driverId, bookingId)).toBe(true);
    const other = await prisma.driver.findFirst({ where: { publicName: 'Maria' } });
    expect(await driverOwnsBooking(other!.id, bookingId)).toBe(false);
  });

  it('chat is closed before assignment (SEARCHING) and rejects sends', async () => {
    const r = await createBooking(input(), `chat-${RUN}-${++n}`);
    if (!r.ok) throw new Error('create failed');
    const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
    const list = await listMessages(b.id);
    expect(list.open).toBe(false); // SEARCHING, no driver yet
    const res = await postMessage(b.id, 'PASSENGER', 'hello?');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('CHAT_CLOSED');
  });

  it('rejects empty and over-long messages', async () => {
    const { bookingId } = await assigned();
    const empty = await postMessage(bookingId, 'PASSENGER', '   ');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe('EMPTY_MESSAGE');
    const long = await postMessage(bookingId, 'PASSENGER', 'x'.repeat(1001));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.code).toBe('MESSAGE_TOO_LONG');
  });
});
