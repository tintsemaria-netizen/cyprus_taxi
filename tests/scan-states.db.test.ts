import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Launch fixes §3: clamd answers CLEAN / INFECTED / ERROR; an unreachable scanner = UNAVAILABLE
// (pending). Documents stored while the scanner was down are rescanned by maintenance. A local fake
// clamd stands in for the real one (no real malware involved).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
process.env.PRIVATE_UPLOAD_DIR = dir;

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { scanFile, rescanPendingDocuments } from '@/server/scan';

let server: net.Server;
let answer = 'stream: OK\0';
beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error('Refusing: not a _test DB');
  server = net.createServer((s) => { s.on('data', (d) => { if (d.includes(Buffer.alloc(4)) || d.length >= 4) { s.end(answer); } }); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  (config.clamav as { host: string; port: number }).host = '127.0.0.1';
  (config.clamav as { host: string; port: number }).port = (server.address() as net.AddressInfo).port;
  (config.uploads as { dir: string }).dir = dir;
});
afterAll(() => { server?.close(); (config.clamav as { host: string }).host = ''; });

describe('§3 scan states', () => {
  it('CLEAN / INFECTED / ERROR from clamd; UNAVAILABLE when unreachable', async () => {
    answer = 'stream: OK\0'; expect(await scanFile(Buffer.from('hello'))).toBe('CLEAN');
    answer = 'stream: Eicar-Test-Signature FOUND\0'; expect(await scanFile(Buffer.from('x'))).toBe('INFECTED');
    answer = 'INSTREAM size limit exceeded. ERROR\0'; expect(await scanFile(Buffer.from('x'))).toBe('ERROR');
    const port = config.clamav.port;
    (config.clamav as { port: number }).port = 1; // nothing listens there
    expect(await scanFile(Buffer.from('x'))).toBe('UNAVAILABLE');
    (config.clamav as { port: number }).port = port;
  });

  it('a document stored while the scanner was down is rescanned later', async () => {
    const applicant = await prisma.driverApplicant.create({ data: { phone: `+3579${Date.now().toString().slice(-7)}` } });
    const app = await prisma.driverApplication.create({ data: { applicantId: applicant.id } });
    const key = `${app.id}/scan-test.jpg`;
    fs.mkdirSync(path.join(dir, app.id), { recursive: true });
    fs.writeFileSync(path.join(dir, key), Buffer.from('fake-image'));
    const doc = await prisma.applicationDocument.create({ data: { applicationId: app.id, slot: 'insurance', storageKey: key, mime: 'image/jpeg', sizeBytes: 10, sha256: 'h', revision: 1, decision: 'PENDING', scanStatus: 'UNAVAILABLE' } });
    answer = 'stream: OK\0';
    const r = await rescanPendingDocuments();
    expect(r.scanned).toBeGreaterThanOrEqual(1);
    expect((await prisma.applicationDocument.findUnique({ where: { id: doc.id } }))!.scanStatus).toBe('CLEAN');
  });
});
