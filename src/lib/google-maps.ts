'use client';

import { googlePublic } from './config';

// Singleton loader for the Google Maps JS SDK. Loads the script exactly once and
// resolves with the `google.maps` namespace. Uses the async loading pattern and the
// libraries needed across the app (marker for AdvancedMarkerElement).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { google?: any; __ilyasGmapsPromise?: Promise<any> }
}

export function googleEnabled(): boolean {
  return googlePublic.enabled;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadGoogleMaps(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__ilyasGmapsPromise) return window.__ilyasGmapsPromise;
  if (!googlePublic.apiKey) return Promise.reject(new Error('Google Maps key not configured'));

  window.__ilyasGmapsPromise = new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      key: googlePublic.apiKey,
      v: 'weekly',
      libraries: 'marker',
      loading: 'async',
    });
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Failed to load Google Maps JS'));
    // The classic callback pattern via a global; simplest reliable ready signal.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ilyasGmapsReady = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error('Google Maps loaded without namespace'));
    };
    script.src += '&callback=__ilyasGmapsReady';
    document.head.appendChild(script);
  });
  return window.__ilyasGmapsPromise;
}

export const MAP_ID = googlePublic.mapId;
