import { apiOk, Errors } from '@/lib/http';
import { getTrackingBookingId } from '@/lib/tracking';
import { trackingView } from '@/server/views';

export const dynamic = 'force-dynamic';

export async function GET() {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  const view = await trackingView(bookingId);
  if (!view) return Errors.notFound();
  return apiOk(view);
}
