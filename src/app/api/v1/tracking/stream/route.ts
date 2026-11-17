import { Errors } from '@/lib/http';
import { getTrackingBookingId } from '@/lib/tracking';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Instant status for the passenger (2026-11-17). The car position stays economical (5 s polling),
// but a status change — driver assigned / on the way / arrived / started / finished / canceled —
// and a new chat message reach the open tracking page within ~1 s: this Server-Sent Events stream
// checks one small row every second and says «changed»; the page then reloads the view at once.
// Each connection lives ≤ 55 s; EventSource reconnects by itself.
const CHECK_MS = 1000;
const LIFE_MS = 55_000;
const TERMINAL = ['COMPLETED', 'CANCELED'];

async function signature(bookingId: string): Promise<string | null> {
  const [b, m] = await Promise.all([
    prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true, revision: true, updatedAt: true } }),
    prisma.chatMessage.findFirst({ where: { bookingId }, orderBy: { createdAt: 'desc' }, select: { id: true } }),
  ]);
  return b ? `${b.status}|${b.revision}|${b.updatedAt.getTime()}|${m?.id ?? ''}` : null;
}

export async function GET(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  const first = await signature(bookingId);
  if (!first) return Errors.notFound();

  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let last = first;
      let busy = false;
      const born = Date.now();
      const send = (s: string) => { if (!closed) try { controller.enqueue(enc.encode(s)); } catch { closed = true; } };
      const close = () => { if (closed) return; closed = true; if (timer) clearInterval(timer); try { controller.close(); } catch { /* already */ } };
      send('retry: 2000\n\n');
      timer = setInterval(async () => {
        if (closed) return;
        if (Date.now() - born > LIFE_MS) { close(); return; }
        if (busy) return;
        busy = true;
        try {
          const sig = await signature(bookingId);
          if (sig && sig !== last) {
            last = sig;
            send(`data: ${JSON.stringify({ status: sig.split('|')[0] })}\n\n`);
            if (TERMINAL.includes(sig.split('|')[0])) close();
          } else if ((Date.now() - born) % 15_000 < CHECK_MS) send(': ping\n\n');
        } catch { /* transient: next tick */ } finally { busy = false; }
      }, CHECK_MS);
      req.signal.addEventListener('abort', close);
    },
    cancel() { closed = true; if (timer) clearInterval(timer); },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      // Keeps next start's gzip from buffering the stream.
      'Content-Encoding': 'none',
    },
  });
}
