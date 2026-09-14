import { apiOk, Errors } from '@/lib/http';
import { getPassenger } from '@/server/passenger';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  return apiOk({ phone: p.phone, name: p.name, email: p.email });
}

// Update the passenger's display name only (Task 019 profile settings). Phone and email are the
// verified identity and are NOT changed here — a phone/email change would require re-verification.
export async function PATCH(req: Request) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  let body: { name?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const name = (body.name ?? '').trim();
  if (!name || name.length > 80) return Errors.validation({ name: 'Enter a name (up to 80 characters).' });
  const u = await prisma.passenger.update({ where: { id: p.id }, data: { name } });
  return apiOk({ phone: u.phone, name: u.name, email: u.email });
}
