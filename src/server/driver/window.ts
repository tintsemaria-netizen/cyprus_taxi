// Shared driver report windows (Task 017). UTC storage/reporting; half-open [from, to). Custom
// dates are day-based and bounded to 366 days.
export function driverWindow(range?: string | null, fromRaw?: string | null, toRaw?: string | null): { from: Date; to: Date; range: string } {
  const now = new Date();
  const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  switch (range) {
    case 'week':
      return { from: startOfUtcDay(new Date(now.getTime() - 6 * 86_400_000)), to: now, range: 'week' };
    case 'month':
      return { from: startOfUtcDay(new Date(now.getTime() - 29 * 86_400_000)), to: now, range: 'month' };
    case 'custom': {
      const f = fromRaw ? new Date(fromRaw) : null;
      const t = toRaw ? new Date(toRaw) : null;
      let from = f && !Number.isNaN(f.getTime()) ? startOfUtcDay(f) : startOfUtcDay(now);
      const to = t && !Number.isNaN(t.getTime()) ? new Date(startOfUtcDay(t).getTime() + 86_400_000) : now; // inclusive end day
      if (to.getTime() - from.getTime() > 366 * 86_400_000) from = new Date(to.getTime() - 366 * 86_400_000);
      if (from >= to) from = startOfUtcDay(new Date(to.getTime() - 86_400_000));
      return { from, to, range: 'custom' };
    }
    default:
      return { from: startOfUtcDay(now), to: now, range: 'today' };
  }
}
