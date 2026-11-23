import { randomUUID } from 'node:crypto';
import { onCyprusIsland } from '@/lib/cyprus-island';
import { apiOk, apiError, Errors } from '@/lib/http';
import { getPassenger } from '@/server/passenger';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const KINDS = ['HOME', 'WORK', 'SCHOOL']; // SCHOOL added 2026-11-17
const CUSTOM_MAX = 20;
const isCustom = (k: string) => /^C_[0-9a-f-]{36}$/.test(k);

// Passenger saved places (Task 019). GET returns Home/Work(/School) and the passenger's own named
// places (`custom`, 2026-11-18). PUT upserts one kind (place:null removes); kind 'CUSTOM' creates a
// new named place, kind 'C_<id>' changes or removes that one.
export async function GET() {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const rows = await prisma.savedPlace.findMany({ where: { passengerId: p.id }, orderBy: { createdAt: 'asc' } });
  const pick = (k: string) => { const r = rows.find((x) => x.kind === k); return r ? { label: r.label, lat: r.lat, lng: r.lng } : null; };
  const custom = rows.filter((r) => isCustom(r.kind)).map((r) => ({ id: r.kind, name: r.name ?? '', label: r.label, lat: r.lat, lng: r.lng }));
  return apiOk({ home: pick('HOME'), work: pick('WORK'), school: pick('SCHOOL'), custom });
}

export async function PUT(req: Request) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  let body: { kind?: string; name?: string; place?: { label?: string; lat?: number; lng?: number } | null };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const raw = String(body.kind || '');
  const kind = isCustom(raw) ? raw : raw.toUpperCase();
  if (!KINDS.includes(kind) && kind !== 'CUSTOM' && !isCustom(kind)) return Errors.validation({ kind: 'HOME, WORK, SCHOOL or a saved place.' });

  if (body.place === null) {
    if (kind === 'CUSTOM') return Errors.validation({ kind: 'Which place?' });
    await prisma.savedPlace.deleteMany({ where: { passengerId: p.id, kind } });
    return apiOk({ ok: true, kind, place: null });
  }
  const { label, lat, lng } = body.place ?? {};
  if (typeof label !== 'string' || !label.trim() || typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Errors.validation({ place: 'Choose an address.' });
  }
  if (!onCyprusIsland({ lat, lng })) return apiError(422, 'OFF_ISLAND', 'The point is not on the island of Cyprus.', { place: 'Not on Cyprus.' });
  const custom = kind === 'CUSTOM' || isCustom(kind);
  const name = custom ? String(body.name ?? '').trim().slice(0, 40) : null;
  if (custom && !name) return Errors.validation({ name: 'Enter a name.' });
  let key = kind;
  if (kind === 'CUSTOM') {
    const n = await prisma.savedPlace.count({ where: { passengerId: p.id, kind: { startsWith: 'C_' } } });
    if (n >= CUSTOM_MAX) return Errors.validation({ _: `Up to ${CUSTOM_MAX} places.` });
    key = `C_${randomUUID()}`;
  } else if (isCustom(kind)) {
    const exists = await prisma.savedPlace.findUnique({ where: { passengerId_kind: { passengerId: p.id, kind } } });
    if (!exists) return Errors.notFound();
  }
  const data = { label: label.trim().slice(0, 200), lat, lng, ...(custom ? { name } : {}) };
  const saved = await prisma.savedPlace.upsert({
    where: { passengerId_kind: { passengerId: p.id, kind: key } },
    update: data,
    create: { passengerId: p.id, kind: key, ...data },
  });
  return apiOk({ ok: true, kind: key, place: { label: saved.label, lat: saved.lat, lng: saved.lng }, ...(custom ? { id: key, name: saved.name } : {}) });
}
