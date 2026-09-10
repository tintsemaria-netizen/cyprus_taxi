import { apiOk } from '@/lib/http';
import { destroyStaffSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  await destroyStaffSession();
  return apiOk({ ok: true });
}
