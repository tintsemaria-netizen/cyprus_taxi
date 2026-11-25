import { apiOk } from '@/lib/http';
import { noGoZones, pickupPoints } from '@/server/no-go';

export const dynamic = 'force-dynamic';

// Active «Запретная зона» polygons for the passenger app (2026-11-24): a point inside is refused right
// where it is picked, not only at the price. Public — they are just map areas.
// Points switched off in admin (2026-11-25) → sent empty: the passenger app neither moves nor shows them.
export async function GET() {
  return apiOk({ zones: (await noGoZones()).map((z) => z.polygon), territories: (await pickupPoints()).map((z) => ({ name: z.name, polygon: z.polygon, points: z.pointsActive ? z.points : [], dropPoints: z.pointsActive ? z.dropPoints : [], airport: z.airport })) });
}
