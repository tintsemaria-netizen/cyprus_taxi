/**
 * Make one ADMIN the business owner (2026-11-23): only the owner sees «Бухгалтерия».
 * Exactly one owner — every other account loses the flag.
 *
 * Usage (on the server): npm run owner:set -- <admin login>
 */
import { PrismaClient } from '@prisma/client';

try { (process as unknown as { loadEnvFile: (p?: string) => void }).loadEnvFile('.env'); } catch { /* env already set */ }
const prisma = new PrismaClient();

async function main() {
  const login = process.argv[2];
  if (!login) { console.error('Usage: npm run owner:set -- <admin login>'); process.exit(1); }
  const u = await prisma.staffUser.findUnique({ where: { login } });
  if (!u || u.role !== 'ADMIN' || !u.active) { console.error(`"${login}" is not an active admin.`); process.exit(1); }
  await prisma.$transaction([
    prisma.staffUser.updateMany({ where: { isOwner: true, NOT: { id: u.id } }, data: { isOwner: false } }),
    prisma.staffUser.update({ where: { id: u.id }, data: { isOwner: true } }),
  ]);
  console.log(`"${login}" is now the owner.`);
}
main().finally(() => prisma.$disconnect());
