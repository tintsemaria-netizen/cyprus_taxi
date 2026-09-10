/**
 * One-time admin bootstrap (SPEC §5). No fixed credentials: reads
 * ADMIN_LOGIN and ADMIN_PASSWORD from the environment. Idempotent — if the
 * login already exists it resets the password and ensures ADMIN role.
 *
 * Usage: ADMIN_LOGIN=admin ADMIN_PASSWORD=... npm run bootstrap:admin
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Load .env if present (no-op when env is already provided by the container).
try { (process as unknown as { loadEnvFile: (p?: string) => void }).loadEnvFile('.env'); } catch { /* env already set */ }

const prisma = new PrismaClient();

async function main() {
  const login = process.env.ADMIN_LOGIN;
  const password = process.env.ADMIN_PASSWORD;
  if (!login || !password) {
    console.error('ERROR: set ADMIN_LOGIN and ADMIN_PASSWORD in the environment.');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('ERROR: ADMIN_PASSWORD must be at least 10 characters.');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.staffUser.findUnique({ where: { login } });
  if (existing) {
    await prisma.staffUser.update({
      where: { login },
      data: { passwordHash, role: 'ADMIN', active: true, sessionVersion: { increment: 1 } },
    });
    console.log(`Updated existing admin "${login}" (password reset, sessions invalidated).`);
  } else {
    await prisma.staffUser.create({
      data: { login, passwordHash, role: 'ADMIN', displayName: 'Administrator', active: true },
    });
    console.log(`Created admin "${login}".`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
