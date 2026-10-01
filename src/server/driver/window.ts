import { startOfNicosiaDay } from '@/lib/timezone';

// Shared driver report windows (Task 017). Days are Cyprus (Europe/Nicosia) calendar days — a shift
// after local midnight belongs to the new day (2026-10-01 audit; was UTC days). Half-open [from, to).
// Custom dates are day-based and bounded to 366 days.
export function driverWindow(range?: string | null, fromRaw?: string | null, toRaw?: string | null): { from: Date; to: Date; range: string } {
  const now = new Date();
  switch (range) {
    case 'week':
      return { from: startOfNicosiaDay(now, -6), to: now, range: 'week' };
    case 'month':
      return { from: startOfNicosiaDay(now, -29), to: now, range: 'month' };
    case 'custom': {
      // Inputs are calendar dates (YYYY-MM-DD); interpret them as Cyprus days.
      const f = fromRaw ? new Date(`${fromRaw.slice(0, 10)}T12:00:00Z`) : null;
      const t = toRaw ? new Date(`${toRaw.slice(0, 10)}T12:00:00Z`) : null;
      let from = f && !Number.isNaN(f.getTime()) ? startOfNicosiaDay(f) : startOfNicosiaDay(now);
      const to = t && !Number.isNaN(t.getTime()) ? startOfNicosiaDay(t, 1) : now; // inclusive end day
      if (to.getTime() - from.getTime() > 366 * 86_400_000) from = new Date(to.getTime() - 366 * 86_400_000);
      if (from >= to) from = startOfNicosiaDay(new Date(to.getTime() - 1));
      return { from, to, range: 'custom' };
    }
    default:
      return { from: startOfNicosiaDay(now), to: now, range: 'today' };
  }
}
