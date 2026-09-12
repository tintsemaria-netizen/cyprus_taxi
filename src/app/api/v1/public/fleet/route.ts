import { apiOk, Errors, clientIp } from '@/lib/http';
import { publicFleet } from '@/server/views';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Public, anonymized live positions of on-duty cars for the passenger map.
export async function GET(req: Request) {
  const rl = await rateLimit('public-fleet', clientIp(req, config.trustedProxyHops), 30, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  return apiOk({ vehicles: await publicFleet() });
}
