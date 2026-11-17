import { describe, it, expect, vi, beforeAll } from 'vitest';

// Chat auto-translation (2026-11-17): each side reads the other in its own language; one Google
// call per message and target language (cached on the row); failures fall back to the original.
const calls: string[] = [];
vi.mock('@/server/google', async (orig) => ({
  ...(await orig<typeof import('@/server/google')>()),
  googleConfigured: () => true,
  googleTranslate: vi.fn(async (text: string, target: string) => { calls.push(`${text}>${target}`); return `[${target}] ${text}`; }),
}));

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { listMessages } from '@/server/chat';
import type { CreateBookingInput } from '@/lib/validation';

let bookingId = '';
beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to run DB tests on "${dbName}".`);
  const r = await createBooking({ pickup: { lat: 34.67, lng: 33.04, label: 'A' }, dropoff: { lat: 34.7, lng: 33.06, label: 'B' }, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'P', phone: '+35799123456' } as unknown as CreateBookingInput, `chat-tr-${Date.now()}`);
  if (!r.ok) throw new Error('create');
  bookingId = (await prisma.booking.findUniqueOrThrow({ where: { reference: r.body.reference } })).id;
  await prisma.chatMessage.createMany({ data: [
    { bookingId, sender: 'PASSENGER', body: 'Я у входа', lang: 'ru' },
    { bookingId, sender: 'DRIVER', body: 'Έφτασα', lang: 'el' },
    { bookingId, sender: 'DRIVER', body: 'Same language', lang: 'ru' },
  ] });
});

describe('chat auto-translation', () => {
  it('the driver (Greek) sees the passenger in Greek; own messages untouched', async () => {
    const r = await listMessages(bookingId, { reader: 'DRIVER', readerLang: 'el' });
    const pax = r.messages.find((m) => m.sender === 'PASSENGER')!;
    expect(pax.body).toBe('Я у входа');
    expect(pax.translated).toBe('[el] Я у входа');
    expect(r.messages.filter((m) => m.sender === 'DRIVER').every((m) => !m.translated)).toBe(true);
  });
  it('the passenger (Russian) sees the driver in Russian, skipping one already in Russian', async () => {
    const r = await listMessages(bookingId, { reader: 'PASSENGER', readerLang: 'ru' });
    expect(r.messages.find((m) => m.body === 'Έφτασα')!.translated).toBe('[ru] Έφτασα');
    expect(r.messages.find((m) => m.body === 'Same language')!.translated).toBeUndefined();
  });
  it('translations are cached: a second read makes no new calls', async () => {
    const before = calls.length;
    await listMessages(bookingId, { reader: 'DRIVER', readerLang: 'el' });
    await listMessages(bookingId, { reader: 'PASSENGER', readerLang: 'ru' });
    expect(calls.length).toBe(before);
  });
});
