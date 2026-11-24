import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { getSettings, saveSettings } from '@/lib/settings';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  // No secrets are stored in settings, so returning the whole object is safe.
  return apiOk(await getSettings());
}

const patchSchema = z.object({
  operatorName: z.string().max(120).nullable().optional(),
  supportPhone: z.string().max(30).nullable().optional(),
  supportEmail: z.string().email().max(120).nullable().optional(),
  googleReviewUrl: z.string().max(400).refine((v) => /^https:\/\//i.test(v) || /^[A-Za-z0-9_-]{10,}$/.test(v.trim()), 'Use a Google Place ID or an https link').nullable().optional(),
  scheduleMinMinutes: z.number().int().min(0).max(1440).optional(),
  scheduleMaxDays: z.number().int().min(1).max(365).optional(),
  shareMinMinutes: z.number().int().min(0).max(2880).optional(),
  shareTimeMode: z.enum(['DEPART', 'ARRIVE']).optional(), // 2026-11-25
  shareSlotMinutes: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120), z.literal(180)]).optional(), // 2026-11-24
  shareBoardHideMinutes: z.number().int().min(0).max(2880).optional(),
  minStopDistanceMeters: z.number().int().min(0).max(100000).optional(),
  serviceAreaPolygon: z.array(z.object({ lat: z.number(), lng: z.number() })).min(3).optional(),
});

export async function PATCH(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return Errors.validation({ _: 'Invalid settings.' });
  const saved = await saveSettings(parsed.data);
  return apiOk(saved);
}
