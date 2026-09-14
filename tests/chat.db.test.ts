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

  it('in-transaction ownership: a non-active driver cannot post (Task 013)', async () => {
    const { bookingId, driverId } = await assigned();
    const other = await prisma.driver.findFirst({ where: { publicName: 'Maria' } });
    // Wrong driver → 403 even though the booking has an active assignment.
    const bad = await postMessage(bookingId, 'DRIVER', 'hi', { requireDriverId: other!.id });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.status).toBe(403);
    // The actual assigned driver succeeds.
    const good = await postMessage(bookingId, 'DRIVER', 'on my way', { requireDriverId: driverId });
    expect(good.ok).toBe(true);
    // If the assignment ends, they can no longer post (checked under the lock).
    await prisma.assignment.updateMany({ where: { activeBookingId: bookingId }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
    await prisma.booking.update({ where: { id: bookingId }, data: { status: 'SEARCHING' } });
    const after = await postMessage(bookingId, 'DRIVER', 'still here?', { requireDriverId: driverId });
    expect(after.ok).toBe(false); // CHAT_CLOSED (SEARCHING) or FORBIDDEN
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

  it('cursor pagination: latest page + load older, no loss or duplication', async () => {
    const { bookingId } = await assigned();
    const base = Date.now() - 60_000;
    for (let i = 0; i < 60; i++) await prisma.chatMessage.create({ data: { bookingId, sender: 'PASSENGER', body: `m${String(i).padStart(3, '0')}`, createdAt: new Date(base + i * 1000) } });

    // Latest page = newest 50 (m010..m059), chronological, more older available.
    const page1 = await listMessages(bookingId, { limit: 50 });
    expect(page1.messages.length).toBe(50);
    expect(page1.messages[0].body).toBe('m010');
    expect(page1.messages[49].body).toBe('m059');
    expect(page1.hasMoreOlder).toBe(true);

    // Load older before the earliest → m000..m009, nothing left older.
    const first = page1.messages[0];
    const older = await listMessages(bookingId, { before: `${first.at}_${first.id}`, limit: 50 });
    expect(older.messages.map((m) => m.body)).toEqual(Array.from({ length: 10 }, (_, i) => `m${String(i).padStart(3, '0')}`));
    expect(older.hasMoreOlder).toBe(false);

    // Merged set is exactly 60 unique, in order.
    const merged = new Map([...older.messages, ...page1.messages].map((m) => [m.id, m]));
    expect(merged.size).toBe(60);

    // `after` the newest returns nothing (tail poll).
    const last = page1.messages[49];
    const tail = await listMessages(bookingId, { after: `${last.at}_${last.id}` });
    expect(tail.messages.length).toBe(0);
  }, 20000);

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
