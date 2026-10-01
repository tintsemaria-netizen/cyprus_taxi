// Recovery for a lost authenticator: turns TOTP off for one staff login and signs out its sessions.
//   docker compose --env-file deploy/.env.production exec -e STAFF_LOGIN=<login> taxi-app npx tsx scripts/reset-staff-mfa.ts
import { prisma } from '../src/lib/db';

async function main() {
  const login = process.env.STAFF_LOGIN;
  if (!login) throw new Error('Set STAFF_LOGIN=<login>');
  const u = await prisma.staffUser.update({
    where: { login },
    data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, sessionVersion: { increment: 1 } },
  });
  console.log(`2FA reset for ${u.login} (${u.role}); existing sessions signed out.`);
}
main().finally(() => prisma.$disconnect());
