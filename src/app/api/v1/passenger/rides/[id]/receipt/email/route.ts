import { apiOk, apiError, Errors } from '@/lib/http';
import { getPassenger } from '@/server/passenger';
import { requestReceiptEmail } from '@/server/email/receipts';

export const dynamic = 'force-dynamic';

// «Send the receipt to my e-mail» / «send again» for the passenger's own completed ride.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const { id } = await params;
  const r = await requestReceiptEmail(id, p.id);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ status: r.status });
}
