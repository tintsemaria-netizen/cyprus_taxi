import { driverReliability, FLAG_RULES } from '@/server/admin/reliability';

// «Рейтинг и надёжность» for one driver (2026-11-27, operator: one tool for the driver, the admin's driver card and
// the fleet owner's driver card). Last 30 days, the admin's figures and limits.
export async function reliabilityView(driverId: string) {
  const to = new Date(), from = new Date(to.getTime() - 30 * 86_400_000);
  const [row] = await driverReliability(from, to, driverId);
  if (!row) return null;
  return { days: 30, offers: row.offers, trips: row.trips, prebook: row.prebook, rating: row.rating, flags: row.flags.filter((f) => !f.startsWith('ONLINE_')), rules: FLAG_RULES };
}
