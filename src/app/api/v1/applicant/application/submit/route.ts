import { apiOk, apiError, Errors } from '@/lib/http';
import { getApplicant } from '@/server/applicant';
import { submitApplication } from '@/server/applications';

export const dynamic = 'force-dynamic';

export async function POST() {
  const a = await getApplicant();
  if (!a) return Errors.unauthorized();
  const r = await submitApplication(a.id);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk(r.data);
}
