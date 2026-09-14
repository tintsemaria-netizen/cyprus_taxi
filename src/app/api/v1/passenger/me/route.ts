import { apiOk, Errors } from '@/lib/http';
import { getPassenger } from '@/server/passenger';
export const dynamic = 'force-dynamic';
export async function GET() {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  return apiOk({ phone: p.phone, name: p.name });
}
