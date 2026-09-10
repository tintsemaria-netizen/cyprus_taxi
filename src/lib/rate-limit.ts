import { prisma } from './db';

// Simple DB-backed fixed-window limiter (shared across replicas). Uses the
// Setting table namespace to avoid an extra model; keys expire by overwrite.
// For beta scale this is sufficient; document NAT tradeoffs (SPEC §10).

interface Window {
  count: number;
  resetAt: number;
}

export async function rateLimit(
  bucket: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<{ ok: boolean; retryAfter: number }> {
  const key = `ratelimit:${bucket}:${identifier}`;
  const now = Date.now();
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    let w: Window = row ? (JSON.parse(row.value) as Window) : { count: 0, resetAt: now + windowSeconds * 1000 };
    if (w.resetAt < now) w = { count: 0, resetAt: now + windowSeconds * 1000 };
    w.count += 1;
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(w) },
      update: { value: JSON.stringify(w) },
    });
    if (w.count > limit) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
    }
    return { ok: true, retryAfter: 0 };
  } catch {
    // Fail open on limiter storage errors (availability over strictness for beta).
    return { ok: true, retryAfter: 0 };
  }
}
