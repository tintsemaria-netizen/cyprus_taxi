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

export async function listMessages(bookingId: string, sinceIso?: string): Promise<{ open: boolean; messages: ChatMessageView[] }> {
  const where: Record<string, unknown> = { bookingId };
  if (sinceIso) {
    const d = new Date(sinceIso);
    if (!Number.isNaN(d.getTime())) where.createdAt = { gt: d };
  }
  const [rows, booking] = await Promise.all([
    prisma.chatMessage.findMany({ where, orderBy: { createdAt: 'asc' }, take: 200 }),
    prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } }),
  ]);
  return { open: booking ? CHAT_ACTIVE_STATUSES.includes(booking.status) : false, messages: rows.map(view) };
}

export async function postMessage(bookingId: string, sender: 'PASSENGER' | 'DRIVER', body: string): Promise<PostResult> {
  const text = (body ?? '').trim();
  if (!text) return { ok: false, status: 422, code: 'EMPTY_MESSAGE', message: 'Message is empty.' };
  if (text.length > MAX_LEN) return { ok: false, status: 422, code: 'MESSAGE_TOO_LONG', message: `Keep it under ${MAX_LEN} characters.` };
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
  if (!booking) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Booking not found.' };
  if (!CHAT_ACTIVE_STATUSES.includes(booking.status)) return { ok: false, status: 409, code: 'CHAT_CLOSED', message: 'Chat is only available while a driver is assigned.' };
  const m = await prisma.chatMessage.create({ data: { bookingId, sender, body: text } });
  return { ok: true, message: view(m) };
}

// A driver may chat only on the booking of their CURRENT active assignment.
export async function driverOwnsBooking(driverId: string, bookingId: string): Promise<boolean> {
  const a = await prisma.assignment.findFirst({ where: { activeBookingId: bookingId }, select: { driverId: true } });
  return !!a && a.driverId === driverId;
}
