import { prisma } from '@/lib/db';

// Cross-process worker liveness (Task 016 §4). Each sub-loop upserts its heartbeat so the web
// process can tell — from the DATABASE, not a module-local timer — whether the dedicated worker
// is actually alive and how deep its queues are. Operational and analytics health are separate
// rows, so a dead analytics loop never makes the booking path look unhealthy.

export type WorkerRole = 'dispatch' | 'notifications' | 'analytics' | 'maintenance';

export async function heartbeat(role: WorkerRole, workerId: string, detail?: unknown): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "WorkerHeartbeat" (role, "workerId", "beatAt", detail, "updatedAt")
    VALUES (${role}, ${workerId}, now(), ${detail ? JSON.stringify(detail) : null}, now())
    ON CONFLICT (role) DO UPDATE
      SET "workerId" = EXCLUDED."workerId", "beatAt" = now(), detail = EXCLUDED.detail, "updatedAt" = now()`;
}

export interface HeartbeatView { role: string; workerId: string; beatAt: string; ageMs: number; detail: unknown }

export async function getHeartbeats(now: Date = new Date()): Promise<HeartbeatView[]> {
  const rows = await prisma.workerHeartbeat.findMany();
  return rows.map((r) => ({
    role: r.role,
    workerId: r.workerId,
    beatAt: r.beatAt.toISOString(),
    ageMs: now.getTime() - r.beatAt.getTime(),
    detail: r.detail ? safeParse(r.detail) : null,
  }));
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
