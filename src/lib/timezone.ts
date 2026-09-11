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

export type WallConversion =
  | { ok: true; utc: Date }
  | { ok: false; reason: 'GAP' | 'AMBIGUOUS'; options?: string[] };

// Parse "YYYY-MM-DDTHH:mm" (no timezone) as Europe/Nicosia wall time.
export function nicosiaWallTimeToUtc(local: string, preferOffsetMin?: number): WallConversion {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return { ok: false, reason: 'GAP' };
  const want: Wall = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
  const guess = Date.UTC(want.y, want.mo - 1, want.d, want.h, want.mi);

  const off1 = offsetMinutes(guess, TZ);
  const cand1 = guess - off1 * 60000;
  const off2 = offsetMinutes(cand1, TZ);
  const cand2 = guess - off2 * 60000;

  const candidates = Array.from(new Set([cand1, cand2]));
  const valid = candidates.filter((c) => sameWall(wallInTz(c, TZ), want));

  if (valid.length === 0) return { ok: false, reason: 'GAP' }; // spring-forward nonexistent time
  if (valid.length === 1) return { ok: true, utc: new Date(valid[0]) };

  // Ambiguous (autumn fold): require an explicit choice unless one was provided.
  if (typeof preferOffsetMin === 'number') {
    const chosen = valid.find((c) => offsetMinutes(c, TZ) === preferOffsetMin);
    if (chosen !== undefined) return { ok: true, utc: new Date(chosen) };
  }
  return { ok: false, reason: 'AMBIGUOUS', options: valid.map((c) => `${offsetMinutes(c, TZ)}`) };
}
