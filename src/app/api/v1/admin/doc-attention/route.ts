import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { docAttention } from '@/server/doc-renewal';

export const dynamic = 'force-dynamic';

// Documents the admin should look at (2026-11-24): a new upload to check, or one expiring / expired with
// nothing uploaded. «Водители» and «Машины» put these rows on top, blinking red.
export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk({ items: await docAttention() });
}
