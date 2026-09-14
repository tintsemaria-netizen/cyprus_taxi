import { apiOk, Errors } from '@/lib/http';
import { getPassenger } from '@/server/passenger';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const KINDS = ['HOME', 'WORK'];

// Passenger saved places (Task 019). GET returns Home/Work; PUT upserts one kind (place:null removes).
export async function GET() {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const rows = await prisma.savedPlace.findMany({ where: { passengerId: p.id } });
  const pick = (k: string) => { const r = rows.find((x) => x.kind === k); return r ? { label: r.label, lat: r.lat, lng: r.lng } : null; };
  return apiOk({ home: pick('HOME'), work: pick('WORK') });
}

export async function PUT(req: Request) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  let body: { kind?: string; place?: { label?: string; lat?: number; lng?: number } | null };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const kind = String(body.kind || '').toUpperCase();
  if (!KINDS.includes(kind)) return Errors.validation({ kind: 'HOME or WORK.' });

  if (body.place === null) {
    await prisma.savedPlace.deleteMany({ where: { passengerId: p.id, kind } });
    return apiOk({ ok: true, kind, place: null });
  }
  const { label, lat, lng } = body.place ?? {};
  if (typeof label !== 'string' || !label.trim() || typeof lat !== 'number' || typeof lng !== 'number') {
    return Errors.validation({ place: 'Choose an address.' });
  }
  const saved = await prisma.savedPlace.upsert({
    where: { passengerId_kind: { passengerId: p.id, kind } },
    update: { label: label.trim().slice(0, 200), lat, lng },
    create: { passengerId: p.id, kind, label: label.trim().slice(0, 200), lat, lng },
  });
  return apiOk({ ok: true, kind, place: { label: saved.label, lat: saved.lat, lng: saved.lng } });
}
