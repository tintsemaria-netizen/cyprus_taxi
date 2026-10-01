import { prisma } from '@/lib/db';

// Passenger data-subject rights (2026-10-01 audit, Stage 1.12; GDPR Arts 15, 17, 20).
//  - exportPassengerData: everything we hold about the signed-in passenger, as JSON.
//  - deletePassengerAccount: erases the account and ANONYMISES their ride history. Ride/fare rows
//    are kept (financial records and the driver's own trip history) but no longer identify the
//    passenger: name/phone/note/addresses removed, coordinates coarsened to ~1 km, their chat
//    messages redacted, tracking links revoked, push subscriptions and OTP challenges deleted.

const ACTIVE = ['REQUESTED', 'SEARCHING', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];
export const DELETED_LABEL = 'Removed at passenger request';

export async function exportPassengerData(passengerId: string) {
  const p = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { id: true, phone: true, phoneVerifiedAt: true, name: true, email: true, createdAt: true, updatedAt: true, savedPlaces: { select: { kind: true, label: true, lat: true, lng: true, updatedAt: true } } },
  });
  if (!p) return null;
  const bookings = await prisma.booking.findMany({
    where: { passengerId },
    orderBy: { createdAt: 'asc' },
    select: {
      reference: true, status: true, createdAt: true, scheduledAt: true, pickupLabel: true, pickupLat: true, pickupLng: true,
      dropoffLabel: true, dropoffLat: true, dropoffLng: true, passengerName: true, phone: true, note: true, vClass: true,
      passengerCount: true, fareCents: true, priceType: true,
      fare: { select: { currency: true, estimateCents: true, waitingCents: true, finalCents: true, paymentMethod: true, paymentStatus: true, createdAt: true } },
      rating: { select: { stars: true, tags: true, comment: true, createdAt: true } },
      messages: { where: { sender: 'PASSENGER' }, orderBy: { createdAt: 'asc' }, select: { body: true, createdAt: true } },
      assignments: { where: { reason: 'completed' }, select: { driverPublicName: true, vehiclePlate: true, vehicleMake: true, vehicleModel: true } },
    },
  });
  return {
    generatedAt: new Date().toISOString(),
    controller: 'IL-Y',
    account: { phone: p.phone, phoneVerifiedAt: p.phoneVerifiedAt, name: p.name, email: p.email, createdAt: p.createdAt, updatedAt: p.updatedAt },
    savedPlaces: p.savedPlaces,
    rides: bookings.map((b) => ({
      ...b,
      rating: b.rating ? { ...b.rating, tags: b.rating.tags ? JSON.parse(b.rating.tags) : [] } : null,
      driver: b.assignments[0] ?? null,
      assignments: undefined,
      yourChatMessages: b.messages,
      messages: undefined,
    })),
  };
}

export type DeleteResult = { ok: true; ridesAnonymised: number } | { ok: false; status: number; code: string; message: string };

const coarse = (v: number) => Math.round(v * 100) / 100; // ~1 km

export async function deletePassengerAccount(passengerId: string): Promise<DeleteResult> {
  return prisma.$transaction(async (tx) => {
    const p = await tx.passenger.findUnique({ where: { id: passengerId }, select: { id: true, phone: true } });
    if (!p) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Account not found.' };
    const active = await tx.booking.count({ where: { passengerId, status: { in: ACTIVE as never[] } } });
    if (active > 0) return { ok: false, status: 409, code: 'ACTIVE_RIDE', message: 'Finish or cancel your current ride before deleting your account.' };

    const rides = await tx.booking.findMany({ where: { passengerId }, select: { id: true, pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true } });
    const ids = rides.map((r) => r.id);
    for (const r of rides) {
      await tx.booking.update({
        where: { id: r.id },
        data: {
          passengerId: null, passengerName: 'Deleted passenger', phone: 'deleted', note: null,
          pickupLabel: DELETED_LABEL, dropoffLabel: DELETED_LABEL,
          pickupLat: coarse(r.pickupLat), pickupLng: coarse(r.pickupLng), dropoffLat: coarse(r.dropoffLat), dropoffLng: coarse(r.dropoffLng),
        },
      });
    }
    if (ids.length) {
      await tx.chatMessage.updateMany({ where: { bookingId: { in: ids }, sender: 'PASSENGER' }, data: { body: '[deleted]' } });
      await tx.trackingGrant.updateMany({ where: { bookingId: { in: ids }, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.pushSubscription.deleteMany({ where: { audience: { in: ids.map((id) => `PASSENGER:${id}`) } } });
      await tx.notificationOutbox.deleteMany({ where: { audience: { in: ids.map((id) => `PASSENGER:${id}`) }, deliveredAt: null } });
    }
    await tx.tripRating.updateMany({ where: { passengerId }, data: { passengerId: 'deleted', comment: null } });
    await tx.phoneVerification.deleteMany({ where: { phone: p.phone } });
    await tx.passengerSession.deleteMany({ where: { passengerId } });
    await tx.passenger.delete({ where: { id: passengerId } }); // saved places cascade
    return { ok: true, ridesAnonymised: ids.length };
  });
}
