'use client';

import MapView from './MapView';
import GoogleMapView from './GoogleMapView';
import { googleEnabled } from '@/lib/google-maps';

export type { MapMarker } from './MapView';

// Renders the Google map when a browser key is configured (the deployed beta),
// otherwise the MapLibre map (dev without a key). No parallel/background map.
export default function AutoMapView(props: React.ComponentProps<typeof MapView>) {
  return googleEnabled() ? <GoogleMapView {...props} /> : <MapView {...props} />;
}
