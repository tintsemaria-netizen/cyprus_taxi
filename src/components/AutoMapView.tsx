'use client';

import MapView from './MapView';
import GoogleMapView from './GoogleMapView';
import { googleEnabled } from '@/lib/google-maps';
import { useTheme } from '@/lib/theme';

export type { MapMarker } from './MapView';

// Renders the Google map when a browser key is configured (the deployed beta),
// otherwise the MapLibre map (dev without a key). No parallel/background map.
export default function AutoMapView(props: React.ComponentProps<typeof MapView>) {
  // Map styles are fixed when a map is created: a theme switch remounts it (2026-11-19).
  const theme = useTheme();
  return googleEnabled() ? <GoogleMapView key={theme} {...props} /> : <MapView key={theme} {...props} />;
}
