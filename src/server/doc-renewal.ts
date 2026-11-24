import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { saveDocument, deleteDocumentFile } from '@/server/storage';
import { scanFile } from '@/server/scan';
import { EXPIRING_SLOTS } from '@/server/applications';

// Document renewal (2026-11-24, operator):
//  - the driver sees a marker from 7 days before a document expires, and gets a push at 7 and at 1 day;
//  - he uploads the new document himself; the admin checks the photo, types the new expiry date, accepts;
//  - option «б»: once he has uploaded, he keeps working — even past the old date — while the admin has
//    not looked yet. He is blocked only when the accepted document has expired AND nothing new waits;
//  - the admin is told: a push, a red bar on every admin page, red counters on «Водители» (licence,
//    licence) and «Машины» (taxi licence, insurance, roadworthiness) with the row blinking on top, and a reminder
//    twice a day — urgent once the old document has expired.

export const WARN_DAYS = 7;
const DAY = 86_400_000;
/** Car documents go to «Машины» (taxi licence too — it belongs to the car, operator 2026-11-24); the
 *  driving licence to «Водители». Without a bound car everything shows in «Водители». */
export const CAR_SLOTS = new Set(['insurance', 'taxi_licence', 'vehicle_front', 'vehicle_rear']);
/** Photos without a date the driver may replace himself (2026-11-24): his selfie, the car from the front / rear. */
export const PHOTO_RENEW_SLOTS = new Set(['selfie', 'vehicle_front', 'vehicle_rear']);
const RENEWABLE = new Set([...EXPIRING_SLOTS, ...PHOTO_RENEW_SLOTS]);
export const RENEWABLE_SLOTS = [...RENEWABLE];

export interface SlotState {
  slot: string;
  /** The newest accepted document of this slot. */
  accepted: { id: string; expiresAt: Date | null } | null;
  /** A newer upload: waiting for the admin (PENDING) or sent back (CHANGES). */
  renewal: { id: string; decision: string; scanStatus: string; createdAt: Date; note: string | null } | null;
  /** Whole days until the accepted document expires (negative once expired); null without a date. */
  daysLeft: number | null;
  expired: boolean;
  /** Blocks work: expired and nothing new waiting (option «б»). */
  blocking: boolean;
  /** Inside the 7-day window or past it, and nothing new waiting: the driver has to act. */
  needsRenewal: boolean;
}

type Row = { id: string; slot: string; decision: string; scanStatus: string; expiresAt: Date | null; createdAt: Date; decisionNote: string | null };

/** One state per expiring slot, from all rows of an application (newest wins). Pure — tested directly. */
export function slotStates(rows: Row[], now: Date = new Date()): SlotState[] {
  const out: SlotState[] = [];
  const slots = [...new Set(rows.map((r) => r.slot))].filter((s) => RENEWABLE.has(s)).sort();
  for (const slot of slots) {
    const mine = rows.filter((r) => r.slot === slot).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const acc = mine.find((r) => r.decision === 'ACCEPTED') ?? null;
    const newer = mine.find((r) => r.decision !== 'ACCEPTED' && (!acc || r.createdAt > acc.createdAt)) ?? null;
    if (!acc) continue; // never accepted: still the registration flow, not a renewal
    const daysLeft = acc.expiresAt ? Math.ceil((acc.expiresAt.getTime() - now.getTime()) / DAY) : null;
    const expired = !!acc.expiresAt && acc.expiresAt < now;
    const waiting = newer?.decision === 'PENDING';
    out.push({
      slot,
      accepted: { id: acc.id, expiresAt: acc.expiresAt },
      renewal: newer ? { id: newer.id, decision: newer.decision, scanStatus: newer.scanStatus, createdAt: newer.createdAt, note: newer.decisionNote } : null,
      daysLeft, expired,
      blocking: expired && !waiting,
      needsRenewal: !waiting && daysLeft != null && daysLeft <= WARN_DAYS,
    });
  }
  return out;
}

export async function statesFor(applicationId: string, now: Date = new Date()): Promise<SlotState[]> {
  const rows = await prisma.applicationDocument.findMany({ where: { applicationId }, select: { id: true, slot: true, decision: true, scanStatus: true, expiresAt: true, createdAt: true, decisionNote: true } });
  return slotStates(rows, now);
}

/** Puts DOCUMENTS_EXPIRED on / off from the slot states. Never touches SUSPENDED or PENDING drivers. */
export async function reconcileDocEligibility(driverId: string, now: Date = new Date()): Promise<'blocked' | 'restored' | 'unchanged'> {
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true, userId: true, applicationId: true, eligibility: true } });
  if (!d?.applicationId || !['APPROVED', 'DOCUMENTS_EXPIRED'].includes(d.eligibility)) return 'unchanged';
  const blocking = (await statesFor(d.applicationId, now)).some((s) => s.blocking);
  if (blocking && d.eligibility === 'APPROVED') {
    await prisma.$transaction(async (tx) => {
      await tx.driver.update({ where: { id: d.id }, data: { eligibility: 'DOCUMENTS_EXPIRED', onDuty: false, available: false } });
      // Close any open duty session so online-time doesn't keep accruing (Task 017).
      const { goOffline } = await import('@/server/driver/duty');
      await goOffline(tx, d.id, 'system');
      const offers = await tx.driverOffer.findMany({ where: { activeDriverId: d.id, status: 'OFFERED' } });
      for (const o of offers) await tx.driverOffer.update({ where: { id: o.id }, data: { status: 'EXPIRED', respondedAt: new Date(), activeBookingId: null, activeDriverId: null } });
    });
    return 'blocked';
  }
  if (!blocking && d.eligibility === 'DOCUMENTS_EXPIRED') {
    await prisma.driver.update({ where: { id: d.id }, data: { eligibility: 'APPROVED' } });
    return 'restored';
  }
  return 'unchanged';
}

export type UploadResult = { ok: true; id: string; scanStatus: string } | { ok: false; code: string; message: string };

/** The driver uploads a new document for an expiring slot. The accepted one stays until the admin accepts
 *  the new one; an earlier upload that is still waiting (or was sent back) is replaced. */
export async function uploadRenewal(driverId: string, slot: string, buf: Buffer): Promise<UploadResult> {
  if (!RENEWABLE.has(slot)) return { ok: false, code: 'BAD_SLOT', message: 'This document cannot be renewed here.' };
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true, applicationId: true, publicName: true } });
  if (!d?.applicationId) return { ok: false, code: 'NO_APPLICATION', message: 'No documents on file.' };
  const st = (await statesFor(d.applicationId)).find((s) => s.slot === slot);
  if (!st) return { ok: false, code: 'BAD_SLOT', message: 'This document cannot be renewed here.' };
  const scanStatus = await scanFile(buf);
  if (scanStatus === 'INFECTED') return { ok: false, code: 'INFECTED', message: 'This file failed a malware scan and was rejected.' };
  const app = await prisma.driverApplication.findUnique({ where: { id: d.applicationId }, select: { revision: true } });
  const id = randomUUID();
  const stored = await saveDocument(d.applicationId, id, buf);
  if ('error' in stored) return { ok: false, code: 'BAD_FILE', message: stored.error };
  const old = await prisma.applicationDocument.findMany({ where: { applicationId: d.applicationId, slot, decision: { not: 'ACCEPTED' } } });
  await prisma.applicationDocument.create({ data: { id, applicationId: d.applicationId, slot, storageKey: stored.storageKey, mime: stored.mime, sizeBytes: stored.sizeBytes, sha256: stored.sha256, scanStatus, decision: 'PENDING', revision: app?.revision ?? 1 } });
  for (const p of old) { await prisma.applicationDocument.delete({ where: { id: p.id } }); await deleteDocumentFile(p.storageKey); }
  await prisma.applicationEvent.create({ data: { applicationId: d.applicationId, type: 'DOC_RENEWAL', actorType: 'DRIVER', actorId: d.id, visibility: 'INTERNAL', detail: slot } });
  await reconcileDocEligibility(d.id);
  await notifyStaffUpload(d.id, slot).catch((e) => console.error('[doc-renewal] staff push', e));
  return { ok: true, id, scanStatus };
}

/** After the admin accepted a renewal: the old accepted rows of that slot (and their files) go. */
export async function afterRenewalAccepted(applicationId: string, docId: string): Promise<void> {
  const doc = await prisma.applicationDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.decision !== 'ACCEPTED') return;
  const older = await prisma.applicationDocument.findMany({ where: { applicationId, slot: doc.slot, id: { not: docId }, createdAt: { lt: doc.createdAt } } });
  for (const p of older) { await prisma.applicationDocument.delete({ where: { id: p.id } }); await deleteDocumentFile(p.storageKey); }
  const drv = await prisma.driver.findFirst({ where: { applicationId }, select: { id: true } });
  if (drv) await reconcileDocEligibility(drv.id);
}

/** The admin sent a renewal back: tell the driver; block him if the old document already expired. */
export async function afterRenewalReturned(applicationId: string, docId: string): Promise<void> {
  const drv = await prisma.driver.findFirst({ where: { applicationId, eligibility: { in: ['APPROVED', 'DOCUMENTS_EXPIRED'] } }, select: { id: true, userId: true } });
  if (!drv) return; // still registering: the registration screen shows it
  const doc = await prisma.applicationDocument.findUnique({ where: { id: docId }, select: { slot: true } });
  if (!doc) return;
  const { enqueue } = await import('@/server/outbox');
  await enqueue(prisma, { audience: `DRIVER:${drv.userId}`, title: 'Document sent back', body: 'The operator could not accept your new document. Open the menu → Documents and upload it again.', url: '/driver', tag: 'docs', dedupeKey: `docback:${docId}`, msg: { k: 'drv.docReturned', p: { slot: doc.slot } } });
  await reconcileDocEligibility(drv.id);
}

// ---------- Admin side ----------

export interface DocAttention {
  driverId: string; driverName: string; vehicleId: string | null; plate: string | null;
  applicationId: string; slot: string; section: 'drivers' | 'vehicles';
  /** UPLOADED: a new document waits for the admin. EXPIRING / EXPIRED: nothing uploaded yet. */
  kind: 'UPLOADED' | 'EXPIRING' | 'EXPIRED';
  docId: string; oldExpiresAt: string | null; oldExpired: boolean; uploadedAt: string | null; daysLeft: number | null;
}

/** Everything the admin should see in «Водители» / «Машины» about documents. */
export async function docAttention(now: Date = new Date(), fleetId?: string): Promise<DocAttention[]> {
  const drivers = await prisma.driver.findMany({
    // A fleet owner (2026-11-24) sees his own drivers and anyone driving one of his cars.
    where: { applicationId: { not: null }, eligibility: { in: ['APPROVED', 'DOCUMENTS_EXPIRED'] }, ...(fleetId ? { OR: [{ fleetId }, { bindings: { some: { endedAt: null, vehicle: { fleetId } } } }] } : {}) },
    select: { id: true, publicName: true, applicationId: true, bindings: { where: { endedAt: null }, select: { vehicle: { select: { id: true, plate: true } } } } },
  });
  const rows = await prisma.applicationDocument.findMany({ where: { applicationId: { in: drivers.map((d) => d.applicationId!) }, slot: { in: RENEWABLE_SLOTS } }, select: { id: true, applicationId: true, slot: true, decision: true, scanStatus: true, expiresAt: true, createdAt: true, decisionNote: true } });
  const out: DocAttention[] = [];
  for (const d of drivers) {
    const v = d.bindings[0]?.vehicle ?? null;
    for (const s of slotStates(rows.filter((r) => r.applicationId === d.applicationId), now)) {
      const waiting = s.renewal?.decision === 'PENDING';
      if (!waiting && !s.needsRenewal) continue;
      const section = CAR_SLOTS.has(s.slot) && v ? 'vehicles' : 'drivers';
      out.push({
        driverId: d.id, driverName: d.publicName, vehicleId: v?.id ?? null, plate: v?.plate ?? null,
        applicationId: d.applicationId!, slot: s.slot, section,
        kind: waiting ? 'UPLOADED' : s.expired ? 'EXPIRED' : 'EXPIRING',
        docId: waiting ? s.renewal!.id : s.accepted!.id,
        oldExpiresAt: s.accepted?.expiresAt?.toISOString() ?? null, oldExpired: s.expired,
        uploadedAt: waiting ? s.renewal!.createdAt.toISOString() : null, daysLeft: s.daysLeft,
      });
    }
  }
  // Waiting uploads first, then the ones already working on an expired document, then the soonest.
  const rank = (a: DocAttention) => (a.kind === 'UPLOADED' ? (a.oldExpired ? 0 : 1) : a.kind === 'EXPIRED' ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b) || (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
}

async function adminAudiences(): Promise<string[]> {
  const admins = await prisma.staffUser.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true } });
  return admins.map((a) => `STAFF:${a.id}`);
}

async function pushAdmins(p: { title: string; body: string; url: string; dedupeKey: string; msg: { k: string; p: Record<string, string | number> } }) {
  const { enqueue } = await import('@/server/outbox');
  for (const audience of await adminAudiences()) {
    await enqueue(prisma, { audience, title: p.title, body: p.body, url: p.url, tag: 'docs', dedupeKey: `${p.dedupeKey}:${audience}`, msg: p.msg });
  }
}

/** «01.12» in Cyprus time. */
function dayMonth(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Nicosia', day: '2-digit', month: '2-digit' }).format(new Date(iso)).replace('/', '.');
}

const SLOT_EN: Record<string, string> = { licence_front: 'driving licence', taxi_licence: 'taxi licence', insurance: 'insurance', roadworthiness: 'roadworthiness (MOT)', selfie: 'selfie', vehicle_front: 'car photo (front)', vehicle_rear: 'car photo (rear)' };

async function notifyStaffUpload(driverId: string, slot: string) {
  const a = (await docAttention()).find((x) => x.driverId === driverId && x.slot === slot && x.kind === 'UPLOADED');
  if (!a) return;
  const who = a.section === 'vehicles' && a.plate ? `${a.driverName} · ${a.plate}` : a.driverName;
  await pushAdmins({
    title: 'New document to check', body: `${who}: new ${SLOT_EN[slot] ?? slot} — check it`,
    url: `/admin/applications/${a.applicationId}`, dedupeKey: `docup:${a.docId}`,
    msg: { k: 'staff.docUploaded', p: { who, slot } },
  });
}

/** Maintenance (every ~5 min): blocks / restores, driver pushes at 7 and 1 day, admin reminders twice a day. */
export async function runDocExpiry(now: Date = new Date()): Promise<void> {
  const { enqueue } = await import('@/server/outbox');
  const drivers = await prisma.driver.findMany({ where: { applicationId: { not: null }, eligibility: { in: ['APPROVED', 'DOCUMENTS_EXPIRED'] } }, select: { id: true, userId: true, applicationId: true } });
  for (const d of drivers) {
    const states = await statesFor(d.applicationId!, now);
    await reconcileDocEligibility(d.id, now);
    for (const s of states) {
      if (!s.accepted || s.renewal?.decision === 'PENDING') continue; // uploaded: no more reminders for him
      if (s.blocking) {
        await enqueue(prisma, { audience: `DRIVER:${d.userId}`, title: 'Document expired', body: 'A document expired. Upload the new one in the menu → Documents to take rides again.', url: '/driver', tag: 'docs', dedupeKey: `docexp:${s.accepted.id}`, msg: { k: 'drv.docExpired', p: { slot: s.slot } } });
        continue;
      }
      if (s.daysLeft == null || s.daysLeft > WARN_DAYS) continue;
      const mark = s.daysLeft <= 1 ? 1 : 7; // two pushes only: from 7 days, and on the last day
      await enqueue(prisma, { audience: `DRIVER:${d.userId}`, title: 'Document expiring', body: `A document expires in ${Math.max(s.daysLeft, 1)} day(s). Upload the new one in the menu → Documents.`, url: '/driver', tag: 'docs', dedupeKey: `docsoon:${s.accepted.id}:${mark}`, msg: { k: 'drv.docExpiring', p: { slot: s.slot, days: Math.max(s.daysLeft, 1) } } });
    }
  }

  // Admins: a reminder twice a day for every new document still unchecked (urgent once the old one expired),
  // and one push at 7 and at 1 day for a document the driver has not renewed yet.
  const half = Math.floor(now.getTime() / (12 * 3_600_000));
  for (const a of await docAttention(now)) {
    const who = a.section === 'vehicles' && a.plate ? `${a.driverName} · ${a.plate}` : a.driverName;
    const url = `/admin/applications/${a.applicationId}`;
    if (a.kind === 'UPLOADED') {
      // The upload push itself counts as the first one: no reminder in the first 12 hours.
      if (now.getTime() - new Date(a.uploadedAt!).getTime() < 12 * 3_600_000) continue;
      if (a.oldExpired) {
        await pushAdmins({ title: 'Unchecked document — old one expired', body: `${who} works with an unchecked ${SLOT_EN[a.slot] ?? a.slot}; the old one expired ${dayMonth(a.oldExpiresAt!)}`, url, dedupeKey: `docrem:${a.docId}:${half}`, msg: { k: 'staff.docUrgent', p: { who, slot: a.slot, date: dayMonth(a.oldExpiresAt!) } } });
      } else {
        await pushAdmins({ title: 'Document still to check', body: `${who}: new ${SLOT_EN[a.slot] ?? a.slot} waits for you`, url, dedupeKey: `docrem:${a.docId}:${half}`, msg: { k: 'staff.docReminder', p: { who, slot: a.slot } } });
      }
    } else if (a.kind === 'EXPIRING' && a.daysLeft != null) {
      const mark = a.daysLeft <= 1 ? 1 : 7;
      await pushAdmins({ title: 'Document expiring', body: `${who}: ${SLOT_EN[a.slot] ?? a.slot} expires in ${Math.max(a.daysLeft, 1)} day(s), nothing new uploaded`, url: a.section === 'vehicles' ? '/admin/vehicles' : '/admin/drivers', dedupeKey: `docsoonadm:${a.docId}:${mark}`, msg: { k: 'staff.docExpiring', p: { who, slot: a.slot, days: Math.max(a.daysLeft, 1) } } });
    }
  }
}

/** For the admin menu (polled every 10 s): counts per section and the waiting uploads for the red bar. */
export async function docMenuCounts(now: Date = new Date()): Promise<{ drivers: number; vehicles: number; uploaded: number; uploadedSection: 'drivers' | 'vehicles' | null }> {
  const all = await docAttention(now);
  const up = all.filter((a) => a.kind === 'UPLOADED');
  return {
    drivers: new Set(all.filter((a) => a.section === 'drivers').map((a) => a.driverId)).size,
    // + «Мои машины» (2026-11-24): drivers asking the admin for a car, and new cars to check.
    vehicles: new Set(all.filter((a) => a.section === 'vehicles').map((a) => a.vehicleId)).size
      + await prisma.carAccess.count({ where: { status: 'PENDING', needAdmin: true, adminOkAt: null } })
      + await prisma.carRequest.count({ where: { status: 'SUBMITTED' } }),
    uploaded: up.length,
    uploadedSection: up[0]?.section ?? null,
  };
}
