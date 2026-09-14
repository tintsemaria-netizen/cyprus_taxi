import { apiOk, Errors } from '@/lib/http';
import { config } from '@/lib/config';
import { prisma } from '@/lib/db';
import { getPassenger } from '@/server/passenger';
import { createGrantTx } from '@/lib/tracking';
export const dynamic = 'force-dynamic';
// Mint a fresh tracking grant for the passenger's OWN booking so they can re-open live tracking.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const { id } = await params;
  const b = await prisma.booking.findFirst({ where: { id, passengerId: p.id }, select: { id: true } });
  if (!b) return Errors.forbidden();
  const grant = await prisma.$transaction((tx) => createGrantTx(tx, b.id, new Date()));
  return apiOk({ token: grant.token, url: `${config.appBaseUrl}/track#token=${grant.token}` });
}
