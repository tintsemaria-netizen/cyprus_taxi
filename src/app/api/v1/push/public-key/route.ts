import { apiOk } from '@/lib/http';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Public VAPID key for the browser to subscribe to Web Push. Not a secret.
export function GET() {
  return apiOk({ enabled: config.push.enabled, key: config.push.enabled ? config.push.vapidPublic : null });
}
