import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { deleteDriverAccount } from '@/server/driver/delete-account';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// DELETE /api/v1/driver/account — the driver deletes his own account (2026-11-26; store rules, GDPR Art. 17).
// Body { confirm: "DELETE" } so a stray request cannot erase an account.
export async function DELETE(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const p = z.object({ confirm: z.literal('DELETE') }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Errors.validation({ confirm: 'Send { "confirm": "DELETE" }.' });
  const r = await deleteDriverAccount(ctx.driver.id);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ deleted: true });
}
