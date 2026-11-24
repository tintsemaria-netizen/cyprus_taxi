import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { setDocumentDecision } from '@/server/applications';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const ctx = await requireStaff(['ADMIN']); if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id, docId } = await params;
  let body: { decision?: string; note?: string; expiresAt?: string; vehicleChecked?: boolean }; try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON.' }); }
  if (body.decision !== 'ACCEPTED' && body.decision !== 'CHANGES') return Errors.validation({ decision: 'ACCEPTED or CHANGES.' });
  const r = await setDocumentDecision(id, docId, body.decision, body.note, ctx.user.id, body.expiresAt);
  // The admin confirmed this car document / photo matches the car (2026-11-24) — kept in the trail.
  if (r.ok && body.decision === 'ACCEPTED' && body.vehicleChecked) {
    const { prisma } = await import('@/lib/db');
    await prisma.applicationEvent.create({ data: { applicationId: id, type: 'VEHICLE_MATCH_CONFIRMED', actorType: 'ADMIN', actorId: ctx.user.id, visibility: 'INTERNAL', detail: docId } });
  }
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
