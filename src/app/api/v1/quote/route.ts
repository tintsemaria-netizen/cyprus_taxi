import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { createQuote } from '@/server/quote';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';
import { validCoord } from '@/lib/geo';
import { onCyprusIsland } from '@/lib/cyprus-island';
import { firstNoGo } from '@/server/no-go';
import { nicosiaWallTimeToUtc } from '@/lib/timezone';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  pickup: z.object({ lat: z.number(), lng: z.number() }),
  dropoff: z.object({ lat: z.number(), lng: z.number() }),
  stop: z.object({ lat: z.number(), lng: z.number() }).optional(),
  vClass: z.enum(['COMFORT', 'XL']),
  passengerCount: z.number().int().min(1).max(6),
  luggageCount: z.number().int().min(0).max(10).optional(),
  // Scheduled pickup as Europe/Nicosia wall time (+ optional DST-fold offset); priced for
  // that journey time. Omitted → immediate quote priced for now.
  scheduledAt: z.string().min(1).max(40).optional(),
  scheduleOffsetMin: z.number().int().optional(),
});

export async function POST(req: Request) {
  const rl = await rateLimit('quote', clientIp(req, config.trustedProxyHops), 30, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);

  let raw: unknown;
  try { raw = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return Errors.validation({ _: 'Invalid quote request.' });
  if (!validCoord(parsed.data.pickup) || !validCoord(parsed.data.dropoff) || (parsed.data.stop && !validCoord(parsed.data.stop))) return Errors.validation({ _: 'Invalid coordinates.' });

  // Only on the island of Cyprus (2026-11-24, operator).
  const { pickup, dropoff, stop } = parsed.data;
  if (!onCyprusIsland(pickup) || !onCyprusIsland(dropoff) || (stop && !onCyprusIsland(stop))) {
    return apiError(422, 'OFF_ISLAND', 'The point is not on the island of Cyprus.');
  }
  if (await firstNoGo({ pickup, dropoff, stop })) return apiError(422, 'NO_GO_ZONE', 'The taxi does not go to this area.'); // 2026-11-24

  // Convert a scheduled wall time to UTC; if it's not a valid instant (DST gap/ambiguous)
  // we price the quote for "now" — the booking endpoint does the strict schedule check.
  let scheduledAtUtc: string | null = null;
  if (parsed.data.scheduledAt) {
    const conv = nicosiaWallTimeToUtc(parsed.data.scheduledAt, parsed.data.scheduleOffsetMin);
    if (conv.ok) scheduledAtUtc = conv.utc.toISOString();
  }

  const r = await createQuote({ ...parsed.data, scheduledAtUtc });
  if (!r.ok) return apiError(r.status, r.code, r.message, {}, r.snapped ? { snapped: r.snapped } : undefined);
  return apiOk(r.quote);
}
