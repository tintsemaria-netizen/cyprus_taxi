import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { postcodeArea } from '@/server/postcode-area';

export const dynamic = 'force-dynamic';

// GET /api/v1/admin/fixed-zones/postcode-areas?codes=8560,8561 → { areas: { "8560": [[lat,lng],…] | null } }
export async function GET(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const codes = [...new Set((new URL(req.url).searchParams.get('codes') ?? '').split(',').map((c) => c.trim()).filter((c) => /^\d{4,5}$/.test(c)))].slice(0, 60);
  const areas: Record<string, [number, number][] | null> = {};
  for (const c of codes) areas[c] = await postcodeArea(c);
  return apiOk({ areas });
}
