import { apiOk } from '@/lib/http';
import { destroyPassengerSession } from '@/server/passenger';
export const dynamic = 'force-dynamic';
export async function POST() { await destroyPassengerSession(); return apiOk({ ok: true }); }
