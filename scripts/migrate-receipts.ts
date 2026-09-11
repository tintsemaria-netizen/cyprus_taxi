/**
 * Guarded legacy receipt migration (Task 004). Older builds stored idempotency
 * responses as plaintext JSON (which embedded a raw tracking token). This
 * re-encrypts any such rows in place with AES-256-GCM using the CURRENT
 * TRACKING_RECEIPT_SECRET, so recoverability is preserved while plaintext tokens
 * are removed from the database.
 *
 * Safe and idempotent:
 *  - Rows already in `v1:` format are skipped.
 *  - Empty (in-flight/never-completed) receipts are left untouched, never deleted.
 *  - A row whose value is not valid JSON is left untouched and reported.
 *
 * Note: an OLDER application build cannot read v1 receipts; keep a compatible
 * reader deployed (the current build's decryptReceipt reads both) before running.
 */
import { PrismaClient } from '@prisma/client';
import { encryptReceipt } from '../src/lib/crypto';

try { (process as unknown as { loadEnvFile: (p?: string) => void }).loadEnvFile('.env'); } catch { /* env already set */ }

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.idempotencyReceipt.findMany();
  let migrated = 0, skipped = 0, empty = 0, bad = 0;
  for (const r of rows) {
    if (!r.responseJson) { empty++; continue; }
    if (r.responseJson.startsWith('v1:')) { skipped++; continue; }
    try {
      JSON.parse(r.responseJson); // ensure it is a legacy plaintext JSON payload
    } catch {
      bad++;
      continue;
    }
    await prisma.idempotencyReceipt.update({
      where: { id: r.id },
      data: { responseJson: encryptReceipt(r.responseJson) },
    });
    migrated++;
  }
  console.log(`Receipt migration done: migrated=${migrated} alreadyEncrypted=${skipped} empty=${empty} unparseable=${bad}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
