import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Driver-application queue (ADMIN only). Dispatchers cannot review KYC.
export async function GET(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const status = new URL(req.url).searchParams.get('status') || undefined;
  const where = status ? { status: status as never } : {};
  const [rows, pending] = await Promise.all([
    prisma.driverApplication.findMany({
      where,
      orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
      take: 100,
      include: { applicant: { select: { legalName: true } }, _count: { select: { documents: true } } },
    }),
    prisma.driverApplication.count({ where: { status: { in: ['SUBMITTED', 'IN_REVIEW'] } } }),
  ]);
  return apiOk({
    pending,
    applications: rows.map((a) => ({ id: a.id, status: a.status, revision: a.revision, submittedAt: a.submittedAt?.toISOString() ?? null, applicantName: a.applicant.legalName, documents: a._count.documents })),
  });
}
