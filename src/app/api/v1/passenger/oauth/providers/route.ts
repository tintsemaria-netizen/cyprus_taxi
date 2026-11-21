import { apiOk } from '@/lib/http';
import { googleEnabled } from '@/server/oauth-google';

export const dynamic = 'force-dynamic';

// Which «Продолжить с …» buttons to show (only the ones whose keys are set on the server).
export async function GET() {
  return apiOk({ google: googleEnabled(), apple: false });
}
