// Convert a naive wall-clock time in an IANA timezone to a UTC instant, without
// external libraries, handling DST gaps (nonexistent times) and folds (ambiguous
// times). Used so scheduled pickups mean Europe/Nicosia wall time regardless of
// the visitor's own timezone (SPEC §3.5).

const TZ = 'Europe/Nicosia';

interface Wall {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
}

// Offset (minutes, east-positive) of `tz` at a given UTC instant.
function offsetMinutes(instantMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = dtf.formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return Math.round((asUtc - instantMs) / 60000);
}

function wallInTz(instantMs: number, tz: string): Wall {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = dtf.formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let h = get('hour');
  if (h === 24) h = 0;
  return { y: get('year'), mo: get('month'), d: get('day'), h, mi: get('minute') };
}

function sameWall(a: Wall, b: Wall): boolean {
  return a.y === b.y && a.mo === b.mo && a.d === b.d && a.h === b.h && a.mi === b.mi;
}

// Format an instant as a Europe/Nicosia wall-time string "YYYY-MM-DDTHH:mm" suitable
// for a <input type="datetime-local"> min/value, independent of the visitor's own
// timezone. Client-safe (uses Intl). Keeps the picker's min consistent with the
// server, which interprets the field as Cyprus wall time.
export function nicosiaInputValue(instant: Date): string {
  const w = wallInTz(instant.getTime(), TZ);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${w.y}-${p(w.mo)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}`;
}

export type WallConversion =
  | { ok: true; utc: Date }
  | { ok: false; reason: 'GAP' | 'AMBIGUOUS'; options?: string[] };

// Strict full-format validator: real calendar date + 24h time.
function parseWall(local: string): Wall | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const w: Wall = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
  if (w.mo < 1 || w.mo > 12 || w.d < 1 || w.d > 31 || w.h > 23 || w.mi > 59) return null;
  // Reject impossible calendar days (e.g. Feb 30) by round-tripping through Date.
  const probe = new Date(Date.UTC(w.y, w.mo - 1, w.d));
  if (probe.getUTCFullYear() !== w.y || probe.getUTCMonth() !== w.mo - 1 || probe.getUTCDate() !== w.d) return null;
  return w;
}

// Parse "YYYY-MM-DDTHH:mm" (no timezone) as Europe/Nicosia wall time.
// Enumerates every distinct UTC offset the zone uses in a wide window around the
// target so autumn folds (two valid instants) and spring gaps (none) are both
// detected regardless of which side of the transition the naive guess lands on.
export function nicosiaWallTimeToUtc(local: string, preferOffsetMin?: number): WallConversion {
  const want = parseWall(local);
  if (!want) return { ok: false, reason: 'GAP' };
  const guess = Date.UTC(want.y, want.mo - 1, want.d, want.h, want.mi);

  // Collect the distinct offsets in effect within ±18h of the guess (covers any
  // DST transition on the day, in either direction).
  const offsets = new Set<number>();
  for (let k = -18; k <= 18; k++) offsets.add(offsetMinutes(guess + k * 3600_000, TZ));

  // A UTC instant t represents the wall time iff t = guess - offset(t). Test each
  // candidate offset and keep those that round-trip to exactly the requested wall time.
  const valid: number[] = [];
  for (const off of offsets) {
    const cand = guess - off * 60000;
    if (sameWall(wallInTz(cand, TZ), want) && !valid.includes(cand)) valid.push(cand);
  }

  if (valid.length === 0) return { ok: false, reason: 'GAP' }; // spring-forward nonexistent time
  if (valid.length === 1) return { ok: true, utc: new Date(valid[0]) };

  // Ambiguous (autumn fold): require an explicit offset choice unless provided.
  if (typeof preferOffsetMin === 'number') {
    const chosen = valid.find((c) => offsetMinutes(c, TZ) === preferOffsetMin);
    if (chosen !== undefined) return { ok: true, utc: new Date(chosen) };
  }
  return { ok: false, reason: 'AMBIGUOUS', options: valid.map((c) => `${offsetMinutes(c, TZ)}`).sort((a, b) => Number(b) - Number(a)) };
}
