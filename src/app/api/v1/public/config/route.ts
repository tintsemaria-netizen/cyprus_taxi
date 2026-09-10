import { apiOk } from '@/lib/http';
import { getPublicConfig } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  return apiOk(await getPublicConfig());
}
