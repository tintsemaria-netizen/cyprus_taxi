import { apiOk, apiError, Errors } from '@/lib/http';
import { getPassenger } from '@/server/passenger';
import { passengerReceipt } from '@/server/receipt';

export const dynamic = 'force-dynamic';

// The passenger's receipt for their OWN completed ride, built from the immutable Fare.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const { id } = await params;

  const result = await passengerReceipt(id, p.id);
  if (!result.ok) return apiError(result.status, result.code, result.message);
  return apiOk(result.receipt);
}
