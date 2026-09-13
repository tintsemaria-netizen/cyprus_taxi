import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { createQuote } from '@/server/quote';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';
import { validCoord } from '@/lib/geo';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  pickup: z.object({ lat: z.number(), lng: z.number() }),
  dropoff: z.object({ lat: z.number(), lng: z.number() }),
  vClass: z.enum(['COMFORT', 'XL']),
  passengerCount: z.number().int().min(1).max(6),
  luggageCount: z.number().int().min(0).max(10).optional(),
});

export async function POST(req: Request) {
  const rl = await rateLimit('quote', clientIp(req, config.trustedProxyHops), 30, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);

  let raw: unknown;
  try { raw = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return Errors.validation({ _: 'Invalid quote request.' });
  if (!validCoord(parsed.data.pickup) || !validCoord(parsed.data.dropoff)) return Errors.validation({ _: 'Invalid coordinates.' });

  const r = await createQuote(parsed.data);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk(r.quote);
}
