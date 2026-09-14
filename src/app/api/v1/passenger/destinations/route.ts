import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getPassenger } from '@/server/passenger';
export const dynamic = 'force-dynamic';
// Recent distinct destinations for quick re-selection (account-based history).
export async function GET() {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const rows = await prisma.booking.findMany({
    where: { passengerId: p.id }, orderBy: { createdAt: 'desc' }, take: 40,
    select: { dropoffLabel: true, dropoffLat: true, dropoffLng: true },
  });
  const seen = new Set<string>(); const out: { label: string; lat: number; lng: number }[] = [];
  for (const r of rows) { if (seen.has(r.dropoffLabel)) continue; seen.add(r.dropoffLabel); out.push({ label: r.dropoffLabel, lat: r.dropoffLat, lng: r.dropoffLng }); if (out.length >= 6) break; }
  return apiOk({ destinations: out });
}
