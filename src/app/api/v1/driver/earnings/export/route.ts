import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { Errors } from '@/lib/http';
import { listDriverTrips } from '@/server/driver/trips';
import { driverWindow } from '@/server/driver/window';

export const dynamic = 'force-dynamic';

// CSV statement of the driver's own trips in a window. Amounts stay in their recorded currency
// (never mixed/converted). User-influenced strings (addresses) are neutralized against CSV formula
// injection. Header carries currency-per-row, the UTC timezone, and generated-at.
export async function GET(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const url = new URL(req.url);
  const w = driverWindow(url.searchParams.get('range'), url.searchParams.get('from'), url.searchParams.get('to'));

  // Page through the driver's trips (bounded).
  const rows: string[] = [];
  rows.push(['date_utc', 'reference', 'pickup', 'dropoff', 'class', 'passengers', 'status', 'fare_label', 'amount', 'currency', 'payment'].map(csvCell).join(','));
  let cursor: string | undefined;
  let guard = 0;
  do {
    const page = await listDriverTrips(ctx.driver.id, { from: w.from, to: w.to, limit: 50, cursor });
    for (const t of page.items) {
      rows.push([
        t.at, t.reference, t.pickupLabel, t.dropoffLabel, t.vClass, t.passengerCount, t.driverStatus,
        t.fare.label, t.fare.cents != null ? (t.fare.cents / 100).toFixed(2) : '', t.fare.currency, t.payment ?? '',
      ].map(csvCell).join(','));
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor && ++guard < 40); // cap ~2000 rows

  const generatedAt = new Date().toISOString();
  const body = `# IL-Y driver statement · range=${w.range} · timezone=UTC · generated=${generatedAt}\n${rows.join('\n')}\n`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="il-y-statement-${w.range}-${generatedAt.slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

function csvCell(v: string | number | null): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralize spreadsheet formula injection
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
