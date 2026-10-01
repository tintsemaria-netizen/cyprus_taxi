import { prisma } from './db';

// DB-backed fixed-window limiter shared across replicas (2026-10-01 audit Stage 1.1).
// The increment is ONE atomic statement, so N concurrent requests are counted as N (the previous
// read-modify-write counted a burst as ~1). Expired buckets are reset in the same statement and
// pruned by maintenance (pruneRateLimits). NAT tradeoffs: SPEC §10.

export async function rateLimit(
  bucket: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<{ ok: boolean; retryAfter: number }> {
  const key = `${bucket}:${identifier}`;
  const now = new Date();
  const freshReset = new Date(now.getTime() + windowSeconds * 1000);
  try {
    const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt") VALUES (${key}, 1, ${freshReset})
      ON CONFLICT ("key") DO UPDATE SET
        "count"   = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN EXCLUDED."resetAt" ELSE "RateLimitBucket"."resetAt" END
      RETURNING "count", "resetAt"`;
    const w = rows[0];
    if (w && w.count > limit) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((new Date(w.resetAt).getTime() - now.getTime()) / 1000)) };
    }
    return { ok: true, retryAfter: 0 };
  } catch (e) {
    // Fail open on limiter storage errors (availability over strictness), but make it visible.
    console.error('[rate-limit] storage error — failing open', bucket, (e as Error)?.message);
    return { ok: true, retryAfter: 0 };
  }
}

export async function pruneRateLimits(now: Date = new Date()): Promise<number> {
  const r = await prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } });
  return r.count;
}
