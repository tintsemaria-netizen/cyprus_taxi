import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
function parse(s: string | null) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }

// Full application detail for review (ADMIN only). Includes identity/vehicle fields,
// document metadata (streamed separately) and the event trail.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const app = await prisma.driverApplication.findUnique({
    where: { id },
    include: { applicant: true, documents: { orderBy: { slot: 'asc' } }, events: { orderBy: { createdAt: 'asc' } } },
  });
  if (!app) return Errors.notFound();
  return apiOk({
    id: app.id,
    status: app.status,
    revision: app.revision,
    submittedAt: app.submittedAt?.toISOString() ?? null,
    reviewedAt: app.reviewedAt?.toISOString() ?? null,
    decisionReason: app.decisionReason,
    phone: app.applicant.phone,
    identity: parse(app.identity),
    driving: parse(app.driving),
    vehicle: parse(app.vehicle),
    documents: app.documents.map((d) => ({ id: d.id, slot: d.slot, decision: d.decision, decisionNote: d.decisionNote, mime: d.mime, scanStatus: d.scanStatus, sizeBytes: d.sizeBytes })),
    events: app.events.map((e) => ({ type: e.type, actorType: e.actorType, visibility: e.visibility, detail: e.detail, at: e.createdAt.toISOString() })),
  });
}
