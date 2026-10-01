import { apiOk, apiError, Errors } from '@/lib/http';
import { getPassenger, destroyPassengerSession } from '@/server/passenger';
import { deletePassengerAccount } from '@/server/passenger-data';

export const dynamic = 'force-dynamic';

// Permanently delete the signed-in passenger's account (GDPR erasure). The body must carry
// { confirm: "DELETE" } so a stray request can never erase an account.
export async function POST(req: Request) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  let body: { confirm?: unknown };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (body.confirm !== 'DELETE') return Errors.validation({ confirm: 'Confirmation required.' });
  const r = await deletePassengerAccount(p.id);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  await destroyPassengerSession();
  return apiOk({ deleted: true, ridesAnonymised: r.ridesAnonymised });
}
