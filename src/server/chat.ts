import { prisma } from '@/lib/db';

// Passenger↔driver chat, scoped to a booking. Sending is only allowed while a driver is
// assigned (pre-terminal); history stays readable afterwards.
export const CHAT_ACTIVE_STATUSES = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];
const MAX_LEN = 1000;

export interface ChatMessageView {
  id: string;
  sender: 'PASSENGER' | 'DRIVER';
  body: string;
  at: string;
}

export type PostResult =
  | { ok: true; message: ChatMessageView }
  | { ok: false; status: number; code: string; message: string };

function view(m: { id: string; sender: string; body: string; createdAt: Date }): ChatMessageView {
  return { id: m.id, sender: m.sender as 'PASSENGER' | 'DRIVER', body: m.body, at: m.createdAt.toISOString() };
}

// Stable cursor pagination on (createdAt, id) so messages sharing a timestamp are never
// lost or duplicated. Cursor string = `${createdAt ISO}_${id}` (the client builds it from
// a message's own `at` + `id`, which equal these values).
export interface ListOpts { after?: string; before?: string; limit?: number }

function parseCursor(c?: string): { t: Date; id: string } | null {
  if (!c) return null;
  const i = c.lastIndexOf('_');
  if (i < 0) return null;
  const t = new Date(c.slice(0, i));
  const id = c.slice(i + 1);
  return Number.isNaN(t.getTime()) || !id ? null : { t, id };
}

export async function listMessages(bookingId: string, opts: ListOpts = {}): Promise<{ open: boolean; messages: ChatMessageView[]; hasMoreOlder: boolean }> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const after = parseCursor(opts.after);
  const before = parseCursor(opts.before);

  let rows;
  if (after) {
    // Incremental tail: messages strictly after the cursor, ascending.
    rows = await prisma.chatMessage.findMany({
      where: { bookingId, OR: [{ createdAt: { gt: after.t } }, { createdAt: after.t, id: { gt: after.id } }] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit,
    });
  } else if (before) {
    // Older page: messages strictly before the cursor, taken newest-first then flipped.
    rows = await prisma.chatMessage.findMany({
      where: { bookingId, OR: [{ createdAt: { lt: before.t } }, { createdAt: before.t, id: { lt: before.id } }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit,
    });
    rows.reverse();
  } else {
    // Latest page (newest `limit`, chronological for display).
    rows = await prisma.chatMessage.findMany({ where: { bookingId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
    rows.reverse();
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
  // Whether older messages exist before the earliest we returned (skip for the `after`
  // tail poll — the client already holds the history).
  let hasMoreOlder = false;
  if (!after && rows.length) {
    const e = rows[0];
    hasMoreOlder = (await prisma.chatMessage.count({ where: { bookingId, OR: [{ createdAt: { lt: e.createdAt } }, { createdAt: e.createdAt, id: { lt: e.id } }] } })) > 0;
  }
  return { open: booking ? CHAT_ACTIVE_STATUSES.includes(booking.status) : false, messages: rows.map(view), hasMoreOlder };
}

// Post a message. Chat availability, and (for a driver) ownership of the CURRENT active
// assignment, are validated ATOMICALLY under the booking row lock — so a message can't be
// written into a ride the driver was just un-/re-assigned from. Policy: chat is
// booking-scoped, so a replacement driver on the same booking may send and see the prior
// thread (ride continuity); a driver with no active assignment on the booking cannot.
export async function postMessage(bookingId: string, sender: 'PASSENGER' | 'DRIVER', body: string, opts?: { requireDriverId?: string }): Promise<PostResult> {
  const text = (body ?? '').trim();
  if (!text) return { ok: false, status: 422, code: 'EMPTY_MESSAGE', message: 'Message is empty.' };
  if (text.length > MAX_LEN) return { ok: false, status: 422, code: 'MESSAGE_TOO_LONG', message: `Keep it under ${MAX_LEN} characters.` };
  return prisma.$transaction(async (tx): Promise<PostResult> => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
    if (!booking) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Booking not found.' };
    if (!CHAT_ACTIVE_STATUSES.includes(booking.status)) return { ok: false, status: 409, code: 'CHAT_CLOSED', message: 'Chat is only available while a driver is assigned.' };
    if (opts?.requireDriverId) {
      const a = await tx.assignment.findFirst({ where: { activeBookingId: bookingId }, select: { driverId: true } });
      if (!a || a.driverId !== opts.requireDriverId) return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Not your active trip.' };
    }
    const m = await tx.chatMessage.create({ data: { bookingId, sender, body: text } });
    return { ok: true, message: view(m) };
  });
}

// A driver may chat only on the booking of their CURRENT active assignment.
export async function driverOwnsBooking(driverId: string, bookingId: string): Promise<boolean> {
  const a = await prisma.assignment.findFirst({ where: { activeBookingId: bookingId }, select: { driverId: true } });
  return !!a && a.driverId === driverId;
}
