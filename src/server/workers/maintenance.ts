import { prisma } from '@/lib/db';
import { config } from '@/lib/config';

// Scheduled retention/cleanup (Task 016 §5/§7). Runs on the maintenance cadence, isolated from
// dispatch. NEVER prunes a domain event that still has an un-DELIVERED sink delivery — critical
// lifecycle/finance events are never silently discarded before analytics has acknowledged them.

const EVENT_SAFETY_DAYS = 14; // keep delivered events this long as a replay/backup safety margin
const NOTIFICATION_KEEP_DAYS = 7;

export interface MaintenanceResult { gpsDeleted: number; eventsDeleted: number; notificationsDeleted: number }

export async function runMaintenance(now: Date = new Date()): Promise<MaintenanceResult> {
  // 1) Exact-GPS retention. Coarse aggregates live longer in ClickHouse; the raw table here
  //    keeps only the configured window of precise coordinates.
  const gpsCutoff = new Date(now.getTime() - config.gpsRetentionDays * 86_400_000);
  const gps = await prisma.gpsSample.deleteMany({ where: { sampledAt: { lt: gpsCutoff } } });

  // 2) Prune ONLY fully-exported domain events past the safety window. The NOT EXISTS guard
  //    means an event with any PENDING/RETRY/DEAD delivery is retained (never lost pre-export).
  const evCutoff = new Date(now.getTime() - EVENT_SAFETY_DAYS * 86_400_000);
  await prisma.$executeRaw`
    DELETE FROM "AnalyticsDelivery" d
    USING "DomainEvent" e
    WHERE d."eventId" = e.id
      AND e."recordedAt" < ${evCutoff}
      AND NOT EXISTS (SELECT 1 FROM "AnalyticsDelivery" x WHERE x."eventId" = e.id AND x.status <> 'DELIVERED')`;
  const evDeleted: { count: bigint }[] = await prisma.$queryRaw`
    WITH del AS (
      DELETE FROM "DomainEvent" e
      WHERE e."recordedAt" < ${evCutoff}
        AND NOT EXISTS (SELECT 1 FROM "AnalyticsDelivery" x WHERE x."eventId" = e.id)
      RETURNING 1
    ) SELECT count(*)::bigint AS count FROM del`;

  // 3) Terminal notifications cleanup (delivered/failed/superseded rows past keep window).
  const noteCutoff = new Date(now.getTime() - NOTIFICATION_KEEP_DAYS * 86_400_000);
  const notes = await prisma.notificationOutbox.deleteMany({ where: { deliveredAt: { lt: noteCutoff } } });

  return { gpsDeleted: gps.count, eventsDeleted: Number(evDeleted[0]?.count ?? 0), notificationsDeleted: notes.count };
}
