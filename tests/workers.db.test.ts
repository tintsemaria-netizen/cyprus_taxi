import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { heartbeat, getHeartbeats } from '@/server/workers/heartbeat';
import { runMaintenance } from '@/server/workers/maintenance';

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});

describe('worker heartbeat', () => {
  it('upserts a role heartbeat and reports a small age', async () => {
    await heartbeat('dispatch', 'w-test', { tick: 1 });
    const hbs = await getHeartbeats();
    const d = hbs.find((h) => h.role === 'dispatch');
    expect(d).toBeTruthy();
    expect(d!.ageMs).toBeLessThan(60_000);
  });
});

describe('maintenance retention', () => {
  it('prunes exact GPS older than retention but keeps recent samples', async () => {
    const driverId = `ret-${randomUUID()}`;
    const now = Date.now();
    await prisma.gpsSample.create({ data: { driverId, gpsSession: 's', sequence: 1, lat: 34.7, lng: 33, accuracyM: 5, sampledAt: new Date(now - 10 * 86_400_000) } });
    await prisma.gpsSample.create({ data: { driverId, gpsSession: 's', sequence: 2, lat: 34.7, lng: 33, accuracyM: 5, sampledAt: new Date(now - 3_600_000) } });
    await runMaintenance(new Date(now));
    const left = await prisma.gpsSample.findMany({ where: { driverId } });
    expect(left.length).toBe(1);
    expect(left[0].sequence).toBe(2);
  });

  it('never prunes a domain event that still has an un-delivered sink; prunes fully-delivered', async () => {
    const oldTs = new Date(Date.now() - 30 * 86_400_000); // older than the 14-day safety window
    const pendingId = randomUUID();
    const deliveredId = randomUUID();
    // Event with a PENDING delivery — must be retained.
    await prisma.$executeRaw`INSERT INTO "DomainEvent" (id,"eventType","aggregateType","aggregateId","aggregateVersion","eventOrdinal","occurredAt","recordedAt",environment,payload) VALUES (${pendingId},'test.retain','test',${pendingId},1,0,${oldTs},${oldTs},'beta','{}'::jsonb)`;
    await prisma.$executeRaw`INSERT INTO "AnalyticsDelivery" (id,"eventId",sink,status,"createdAt","updatedAt") VALUES (${randomUUID()},${pendingId},'clickhouse','PENDING',now(),now())`;
    // Event whose delivery is DELIVERED — eligible to prune.
    await prisma.$executeRaw`INSERT INTO "DomainEvent" (id,"eventType","aggregateType","aggregateId","aggregateVersion","eventOrdinal","occurredAt","recordedAt",environment,payload) VALUES (${deliveredId},'test.prune','test',${deliveredId},1,0,${oldTs},${oldTs},'beta','{}'::jsonb)`;
    await prisma.$executeRaw`INSERT INTO "AnalyticsDelivery" (id,"eventId",sink,status,"deliveredAt","createdAt","updatedAt") VALUES (${randomUUID()},${deliveredId},'clickhouse','DELIVERED',now(),now(),now())`;

    await runMaintenance(new Date());

    expect(await prisma.domainEvent.findUnique({ where: { id: pendingId } })).not.toBeNull();
    expect(await prisma.domainEvent.findUnique({ where: { id: deliveredId } })).toBeNull();
  });
});
