import { describe, it, expect, beforeAll } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { hashPassword, verifyPassword } from '@/lib/auth';
import { upsertPassengerCredentials, passengerByEmail } from '@/server/passenger';
import { prisma } from '@/lib/db';

const RUN = `${Date.now()}`;
let n = 0;
const uniquePhone = () => `+35799${String((Date.now() + ++n) % 1_000_000).padStart(6, '0')}`;

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});

describe('passenger email + password (Task 018)', () => {
  it('attaches email+password to a phone and authenticates by email', async () => {
    const phone = uniquePhone();
    const email = `u${RUN}${n}@example.com`;
    const p = await upsertPassengerCredentials(phone, { email, passwordHash: await hashPassword('secret123'), name: 'Alex' });
    expect(p.email).toBe(email);
    expect(p.phoneVerifiedAt).not.toBeNull();

    const byEmail = await passengerByEmail(email);
    expect(byEmail?.id).toBe(p.id);
    expect(await verifyPassword('secret123', byEmail!.passwordHash!)).toBe(true);
    expect(await verifyPassword('wrong-pass', byEmail!.passwordHash!)).toBe(false);
  });

  it('re-registering the same phone updates credentials (safe merge on a verified phone)', async () => {
    const phone = uniquePhone();
    const e1 = `first${RUN}${n}@example.com`;
    const e2 = `second${RUN}${n}@example.com`;
    const p1 = await upsertPassengerCredentials(phone, { email: e1, passwordHash: 'h1', name: 'A' });
    const p2 = await upsertPassengerCredentials(phone, { email: e2, passwordHash: 'h2', name: 'A2' });
    expect(p2.id).toBe(p1.id); // same account
    expect(p2.email).toBe(e2);
  });

  it('rejects an email already registered to a different phone', async () => {
    const email = `dup${RUN}${n}@example.com`;
    await upsertPassengerCredentials(uniquePhone(), { email, passwordHash: 'x', name: 'A' });
    await expect(upsertPassengerCredentials(uniquePhone(), { email, passwordHash: 'y', name: 'B' })).rejects.toThrow('email-taken');
  });
});
