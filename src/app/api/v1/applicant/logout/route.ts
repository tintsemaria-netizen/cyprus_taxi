import { apiOk } from '@/lib/http';
import { destroyApplicantSession } from '@/server/applicant';

export const dynamic = 'force-dynamic';

export async function POST() {
  await destroyApplicantSession();
  return apiOk({ ok: true });
}
