// Versioned Cyprus URBAN regulated-meter ESTIMATE (cents). Source figures verified from
// Visit Cyprus (see docs/research/CYPRUS-TAXI-MARKET-AND-FARES.md, 2026-09-13). This is an
// estimate, NOT a certified taximeter amount. All money is integer cents.

export const TARIFF_VERSION = 'cy-urban-2026-09-13';
// Rule version for XL quotes: the urban meter + our XL vehicle surcharge.
export const TARIFF_VERSION_XL = 'cy-urban-2026-09-13+xl40-2026-11-16';

const TARIFF = {
  day: { initialCents: 380, perKmCents: 95 }, // 06:01–20:30
  night: { initialCents: 480, perKmCents: 110 }, // 20:31–06:00
  // Waiting, urban taximeter: €17.00/h day, €19.00/h night (same source as above).
  waitingPerHourCents: { day: 1700, night: 1900 },
  luggagePieceCents: 140,
  holidaySurchargeCents: 200,
  // Passenger surcharge on the fare (regulated): 5 pax +20%, 6 pax +40%.
  paxSurcharge: (n: number) => (n >= 6 ? 0.4 : n === 5 ? 0.2 : 0),
  estimateBandPct: 0.15, // ± band shown to the passenger (honest estimate, not exact)
  // XL (minivan, up to 6 pax) — OUR OWN commercial setting, not a regulated figure (2026-11-16,
  // owner's request for a separate XL price). +40 % on initial hire + distance, the same as the
  // regulated 6-passenger surcharge. It REPLACES the passenger surcharge (never both), so a full
  // XL costs what a 6-passenger meter fare would, and a 1–4 pax XL pays for the bigger vehicle.
  xlPct: 0.4,
};

// Local wall-clock hour/min in Europe/Nicosia for a given instant.
function nicosiaHM(d: Date): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Nicosia', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let h = get('hour');
  if (h === 24) h = 0;
  return { h, m: get('minute') };
}

// Night tariff runs 20:31–06:00 inclusive of the boundary minute semantics documented.
export function isNightTariff(at: Date): boolean {
  const { h, m } = nicosiaHM(at);
  const mins = h * 60 + m;
  return mins >= 20 * 60 + 31 || mins <= 6 * 60; // 20:31..23:59 or 00:00..06:00
}

// Orthodox Easter (Gregorian date) via the Meeus Julian algorithm — needed for the
// movable Cyprus public holidays (Good Friday/Saturday, Easter Sunday/Monday).
function orthodoxEaster(year: number): Date {
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31); // 3=March, 4=April (Julian)
  const day = ((d + e + 114) % 31) + 1;
  // Julian date → add 13 days for the Gregorian offset (valid 1900–2099).
  const julian = new Date(Date.UTC(year, month - 1, day));
  julian.setUTCDate(julian.getUTCDate() + 13);
  return julian;
}

export function isCyprusPublicHoliday(at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Nicosia', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = get('year'), mo = get('month'), da = get('day');
  const fixed = [ [12, 24], [12, 25], [12, 26], [12, 31], [1, 1], [5, 1] ];
  if (fixed.some(([m, d]) => m === mo && d === da)) return true;
  const easter = orthodoxEaster(y);
  const movable = [-2, -1, 0, 1].map((off) => { const e = new Date(easter); e.setUTCDate(e.getUTCDate() + off); return e; });
  return movable.some((e) => e.getUTCMonth() + 1 === mo && e.getUTCDate() === da);
}

export interface FareLine { code: string; label: string; cents: number }
export interface MeterEstimate {
  priceType: 'REGULATED_METER_ESTIMATE';
  ruleVersion: string;
  currency: 'EUR';
  night: boolean;
  holiday: boolean;
  lines: FareLine[];
  totalCents: number;
  rangeLowCents: number;
  rangeHighCents: number;
}

// Pure fare-estimate calculator. distanceMeters/durationSeconds come from a real route.
export function computeMeterEstimate(params: {
  distanceMeters: number;
  passengerCount: number;
  luggageCount?: number;
  at: Date;
  vClass?: 'COMFORT' | 'XL';
}): MeterEstimate {
  const night = isNightTariff(params.at);
  const holiday = isCyprusPublicHoliday(params.at);
  const t = night ? TARIFF.night : TARIFF.day;
  const km = params.distanceMeters / 1000;
  const distanceCents = Math.round(km * t.perKmCents);
  const base = t.initialCents + distanceCents;
  const xl = params.vClass === 'XL';
  const paxPct = xl ? 0 : TARIFF.paxSurcharge(params.passengerCount);
  const paxCents = Math.round(base * paxPct);
  const xlCents = xl ? Math.round(base * TARIFF.xlPct) : 0;
  const luggageCents = (params.luggageCount ?? 0) * TARIFF.luggagePieceCents;
  const holidayCents = holiday ? TARIFF.holidaySurchargeCents : 0;

  const lines: FareLine[] = [
    { code: 'initial', label: `Initial hire (${night ? 'night' : 'day'} tariff)`, cents: t.initialCents },
    { code: 'distance', label: `Distance ${km.toFixed(1)} km × €${(t.perKmCents / 100).toFixed(2)}/km`, cents: distanceCents },
  ];
  if (xlCents) lines.push({ code: 'xl', label: `XL vehicle (+${Math.round(TARIFF.xlPct * 100)}%)`, cents: xlCents });
  if (paxCents) lines.push({ code: 'pax', label: `${params.passengerCount}-passenger surcharge (+${Math.round(paxPct * 100)}%)`, cents: paxCents });
  if (luggageCents) lines.push({ code: 'luggage', label: `Luggage × ${params.luggageCount}`, cents: luggageCents });
  if (holidayCents) lines.push({ code: 'holiday', label: 'Public-holiday surcharge', cents: holidayCents });

  const totalCents = base + paxCents + xlCents + luggageCents + holidayCents;
  return {
    priceType: 'REGULATED_METER_ESTIMATE',
    ruleVersion: xl ? TARIFF_VERSION_XL : TARIFF_VERSION,
    currency: 'EUR',
    night,
    holiday,
    lines,
    totalCents,
    rangeLowCents: Math.round(totalCents * (1 - TARIFF.estimateBandPct)),
    rangeHighCents: Math.round(totalCents * (1 + TARIFF.estimateBandPct)),
  };
}

export const fmtEur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

/**
 * Paid waiting priced like the urban taximeter (2026-11-15, owner decision for the stop waiting):
 * €17.00/h in the day window, €19.00/h at night, accrued per second and split exactly at the
 * 20:30/20:31 and 06:00/06:01 boundaries (Europe/Nicosia). Integer cents, rounded once at the end.
 */
export function meterWaitingCents(start: Date, end: Date): number {
  let t = start.getTime();
  const stop = end.getTime();
  if (!(stop > t)) return 0;
  let centsExact = 0;
  // Walk minute boundaries: the tariff window can only change on a whole local minute.
  while (t < stop) {
    const nextMinute = Math.min(stop, Math.floor(t / 60_000) * 60_000 + 60_000);
    const rate = isNightTariff(new Date(t)) ? TARIFF.waitingPerHourCents.night : TARIFF.waitingPerHourCents.day;
    centsExact += ((nextMinute - t) / 3_600_000) * rate;
    t = nextMinute;
  }
  return Math.round(centsExact);
}

/** Current per-hour waiting rate in cents (for display). */
export function meterWaitingRatePerHourCents(at: Date): number {
  return isNightTariff(at) ? TARIFF.waitingPerHourCents.night : TARIFF.waitingPerHourCents.day;
}
