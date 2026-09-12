'use client';

import MapPicker from './MapPicker';
import GoogleMapPicker from './GoogleMapPicker';
import { googleEnabled } from '@/lib/google-maps';

// Google picker when a browser key is configured (deployed beta); MapLibre picker
// otherwise (dev without a key). Same props/behaviour contract.
export default function AutoMapPicker(props: React.ComponentProps<typeof MapPicker>) {
  return googleEnabled() ? <GoogleMapPicker {...props} /> : <MapPicker {...props} />;
}
