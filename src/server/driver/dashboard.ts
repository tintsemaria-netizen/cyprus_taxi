import { prisma } from '@/lib/db';
import { driverAnalytics } from './analytics';
import { nicosiaDayKey } from '@/lib/timezone';
import { canWork } from '@/lib/eligibility-policy';
import { startOfNicosiaDay } from '@/lib/timezone';
import { getSettings } from '@/lib/settings';
import { earningsSummary } from './earnings';
import { listDriverTrips } from './trips';
import { hasOpenSession } from './duty';
import { driverRatingSummary } from '@/server/ratings';

// Driver Home summary (Task 017 §3/§7). PostgreSQL is authoritative; this endpoint stays fully
// operational if ClickHouse is down. Pending applicants / suspended / expired drivers get their
// exact blocker instead of fake driver earnings.

type DriverRow = { id: string; publicName: string; onDuty: boolean; available: boolean; active: boolean; eligibility: string; applicationId: string | null };

export interface DashboardAlert { level: 'blocker' | 'warning' | 'info'; code: string; message: string; action?: { label: string; href: string }; slot?: string; daysLeft?: number | null; expiresAt?: string | null }


const BLOCKER_MESSAGES: Record<string, string> = {
  PENDING: 'Your driver application is under review. You can’t take rides yet.',
  SUSPENDED: 'Your account is suspended. Contact the operator.',
  DOCUMENTS_EXPIRED: 'A required document expired. Renew it to take rides again.',
};

export async function driverDashboard(driver: DriverRow) {
  const now = new Date();
  const eligible = canWork(driver);

  // Current vehicle (approved binding).
  const binding = await prisma.driverVehicleBinding.findFirst({
    where: { driverId: driver.id, endedAt: null },
    select: { vehicle: { select: { plate: true, vClass: true, seats: true, make: true, model: true, color: true, active: true } } },
  });

  const alerts: DashboardAlert[] = [];
  if (!eligible) {
    alerts.push({ level: 'blocker', code: driver.eligibility, message: BLOCKER_MESSAGES[driver.eligibility] ?? 'Your account can’t take rides right now.', action: driver.eligibility === 'DOCUMENTS_EXPIRED' ? { label: 'Update documents', href: '/driver#documents' } : undefined });
  }
  if (eligible && !binding?.vehicle.active) {
    alerts.push({ level: 'blocker', code: 'NO_VEHICLE', message: 'No vehicle is assigned to you, so you won’t receive ride offers. Contact the operator.' });
  }
  // Documents (2026-11-24): a marker from 7 days before expiry; once he uploaded the new one, nothing
  // more is asked of him (option «б»). The screen words come from the app's language (slot, days, date).
  if (driver.applicationId) {
    const { statesFor } = await import('@/server/doc-renewal');
    for (const st of await statesFor(driver.applicationId, now)) {
      if (!st.needsRenewal) continue;
      const exp = st.accepted?.expiresAt?.toISOString() ?? null;
      alerts.push({ level: st.blocking ? 'blocker' : 'warning', code: st.blocking ? 'DOC_EXPIRED' : 'DOC_EXPIRING', slot: st.slot, daysLeft: st.daysLeft, expiresAt: exp, message: `${prettySlot(st.slot)} ${st.blocking ? 'has expired' : `expires ${exp?.slice(0, 10)}`}.`, action: { label: 'Update document', href: '/driver#documents' } });
    }
  }

  // Today's figures (Cyprus calendar day). Pending/blocked drivers still see zeros truthfully (no fake data).
  const today = await earningsSummary(driver.id, startOfNicosiaDay(now), now);
  // «Не выполнено» today for the «today» card — the SAME count as the analytics panel it opens
  // (2026-11-20): rides the driver cancelled + offers he declined / let expire.
  const todayAn = await driverAnalytics(driver.id, nicosiaDayKey(now), 1);
  const latest = (await listDriverTrips(driver.id, { limit: 3 })).items;
  const activeAsg = await prisma.assignment.findFirst({ where: { activeDriverId: driver.id }, select: { activeBookingId: true } });
  const settings = await getSettings();
  const ratingRow = await prisma.driver.findUnique({ where: { id: driver.id }, select: { ratingTotal: true, ratingCount: true } });
  const rating = driverRatingSummary(ratingRow ?? { ratingTotal: 0, ratingCount: 0 });

  return {
    driver: { name: driver.publicName.split(' ')[0] || driver.publicName, eligibility: driver.eligibility, canWork: eligible, rating },
    status: { onDuty: driver.onDuty, available: driver.available, sharingSessionOpen: await hasOpenSession(driver.id), hasActiveTrip: !!activeAsg?.activeBookingId, activeBookingId: activeAsg?.activeBookingId ?? null },
    vehicle: binding ? { plate: binding.vehicle.plate, vClass: binding.vehicle.vClass, seats: binding.vehicle.seats, label: `${binding.vehicle.color} ${binding.vehicle.make} ${binding.vehicle.model}` } : null,
    today: {
      recordedEarnings: today.byCurrency.map((c) => ({ currency: c.currency, cents: c.recordedEarningsCents })),
      pendingFinalTrips: today.pendingFinalTrips,
      completedTrips: today.completedTrips,
      onlineSeconds: today.onlineSeconds,
      cash: today.byCurrency.map((c) => ({ currency: c.currency, cents: c.cashCents })),
      card: today.byCurrency.map((c) => ({ currency: c.currency, cents: c.cardCents })),
      canceledTrips: todayAn.driverCanceled.count + todayAn.missedOffers.count,
    },
    latestTrips: latest,
    alerts,
    support: { operatorName: settings.operatorName, phone: settings.supportPhone, email: settings.supportEmail },
  };
}

function prettySlot(slot: string): string {
  return slot.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
