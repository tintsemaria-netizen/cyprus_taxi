import { prisma } from '@/lib/db';
import { canWork } from '@/lib/eligibility-policy';
import { getSettings } from '@/lib/settings';
import { earningsSummary } from './earnings';
import { listDriverTrips } from './trips';
import { hasOpenSession } from './duty';

// Driver Home summary (Task 017 §3/§7). PostgreSQL is authoritative; this endpoint stays fully
// operational if ClickHouse is down. Pending applicants / suspended / expired drivers get their
// exact blocker instead of fake driver earnings.

type DriverRow = { id: string; publicName: string; onDuty: boolean; available: boolean; active: boolean; eligibility: string; applicationId: string | null };

export interface DashboardAlert { level: 'blocker' | 'warning' | 'info'; code: string; message: string; action?: { label: string; href: string } }

function startOfUtcDay(d: Date): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }

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
    select: { vehicle: { select: { plate: true, vClass: true, seats: true, make: true, model: true, color: true } } },
  });

  const alerts: DashboardAlert[] = [];
  if (!eligible) {
    alerts.push({ level: 'blocker', code: driver.eligibility, message: BLOCKER_MESSAGES[driver.eligibility] ?? 'Your account can’t take rides right now.', action: driver.eligibility === 'DOCUMENTS_EXPIRED' ? { label: 'Update documents', href: '/driver#documents' } : undefined });
  }
  // Document expiry warnings for approved drivers with an application (LEGACY drivers have none).
  if (driver.applicationId) {
    const soon = new Date(now.getTime() + 14 * 86_400_000);
    const docs = await prisma.applicationDocument.findMany({ where: { applicationId: driver.applicationId, expiresAt: { not: null, lt: soon } }, select: { slot: true, expiresAt: true } });
    for (const d of docs) {
      const expired = d.expiresAt! < now;
      alerts.push({ level: expired ? 'blocker' : 'warning', code: expired ? 'DOC_EXPIRED' : 'DOC_EXPIRING', message: `${prettySlot(d.slot)} ${expired ? 'has expired' : `expires ${d.expiresAt!.toISOString().slice(0, 10)}`}.`, action: { label: 'Update document', href: '/driver#documents' } });
    }
  }

  // Today's figures (UTC day). Pending/blocked drivers still see zeros truthfully (no fake data).
  const today = await earningsSummary(driver.id, startOfUtcDay(now), now);
  const latest = (await listDriverTrips(driver.id, { limit: 3 })).items;
  const activeAsg = await prisma.assignment.findFirst({ where: { activeDriverId: driver.id }, select: { activeBookingId: true } });
  const settings = await getSettings();

  return {
    driver: { name: driver.publicName.split(' ')[0] || driver.publicName, eligibility: driver.eligibility, canWork: eligible },
    status: { onDuty: driver.onDuty, available: driver.available, sharingSessionOpen: await hasOpenSession(driver.id), hasActiveTrip: !!activeAsg?.activeBookingId, activeBookingId: activeAsg?.activeBookingId ?? null },
    vehicle: binding ? { plate: binding.vehicle.plate, vClass: binding.vehicle.vClass, seats: binding.vehicle.seats, label: `${binding.vehicle.color} ${binding.vehicle.make} ${binding.vehicle.model}` } : null,
    today: {
      recordedEarnings: today.byCurrency.map((c) => ({ currency: c.currency, cents: c.recordedEarningsCents })),
      pendingFinalTrips: today.pendingFinalTrips,
      completedTrips: today.completedTrips,
      onlineSeconds: today.onlineSeconds,
    },
    latestTrips: latest,
    alerts,
    support: { operatorName: settings.operatorName, phone: settings.supportPhone, email: settings.supportEmail },
  };
}

function prettySlot(slot: string): string {
  return slot.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
