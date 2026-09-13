// Central runtime configuration. Server-only secrets are read here and never
// exposed to the client. NEXT_PUBLIC_* values are safe for the browser.

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    // During `next build` some server envs are absent; fall back to a marker so
    // the build succeeds. Runtime (start) requires them to be real.
    if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
      throw new Error(`Missing required env: ${name}`);
    }
    return `__missing_${name}__`;
  }
  return v;
}

function num(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  // Hosts we will serve/emit in absolute links. APP_BASE_URL's host plus any extra
  // production domains (comma-separated APP_ALLOWED_HOSTS). Used to build the tracking
  // link from the request host without trusting an arbitrary/spoofed Host header.
  appAllowedHosts: (): Set<string> => {
    const hosts = new Set<string>();
    try { hosts.add(new URL(process.env.APP_BASE_URL || '').host.toLowerCase()); } catch { /* ignore */ }
    (process.env.APP_ALLOWED_HOSTS || '')
      .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
      .forEach((h) => hosts.add(h));
    return hosts;
  },
  demoMode: (process.env.DEMO_MODE || 'true').toLowerCase() === 'true',
  sessionSecret: () => req('SESSION_SECRET'),
  trackingReceiptSecret: () => req('TRACKING_RECEIPT_SECRET'),
  databaseUrl: () => req('DATABASE_URL'),
  schedule: {
    minMinutes: num('SCHEDULE_MIN_MINUTES', 30),
    maxDays: num('SCHEDULE_MAX_DAYS', 30),
  },
  gps: {
    freshSeconds: num('GPS_FRESH_SECONDS', 30),
    staleSeconds: num('GPS_STALE_SECONDS', 120),
  },
  // Autonomous dispatch tunables (Task 012 §4.4/§6.4 — our own beta engineering
  // defaults, clearly labelled, not statutory Cyprus rules).
  dispatch: {
    scheduleLeadMinutes: num('DISPATCH_SCHEDULE_LEAD_MINUTES', 15), // promote a scheduled ride to SEARCHING this long before pickup
    searchDeadlineSeconds: num('DISPATCH_SEARCH_DEADLINE_SECONDS', 180),
    arrivalRadiusMeters: num('DISPATCH_ARRIVAL_RADIUS_METERS', 150), // driver must be within this of pickup to mark ARRIVED (airport zones exempt)
    waitingGraceSeconds: num('DISPATCH_WAITING_GRACE_SECONDS', 180), // free wait after arrival (TEST default 3 min)
    // Pre-pickup paid waiting rate. Kept 0 for REGULATED_METER_ESTIMATE by default because
    // the app-side pre-boarding waiting penalty is not verified against RTD rules (§6.4).
    waitingRateCentsPerMin: num('DISPATCH_WAITING_RATE_CENTS_PER_MIN', 0),
    gpsLossRematchSeconds: num('DISPATCH_GPS_LOSS_REMATCH_SECONDS', 90), // prolonged pre-pickup GPS loss → expire assignment + rematch
  },
  minStopDistanceMeters: num('MIN_STOP_DISTANCE_METERS', 50),
  trustedProxyHops: num('TRUSTED_PROXY_HOPS', 2),
  timezone: 'Europe/Nicosia',
  currency: 'EUR',
  // Server-only Google Maps key (Geocoding + Routes). Never exposed to the client.
  googleServerKey: () => process.env.GOOGLE_MAPS_SERVER_API_KEY || '',
} as const;

// Public Google Maps config (safe for the browser bundle). When a browser key is
// present the app renders Google maps; otherwise it falls back to the MapLibre
// raster map (dev without a key). Cyprus viewport bias for geocoding.
export const googlePublic = {
  apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || '',
  enabled: !!(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim(),
};

export const CYPRUS_BOUNDS = { south: 34.55, west: 32.25, north: 35.72, east: 34.65 };

// Public map config (safe for browser bundle). Default demo tiles use Esri's Dark
// Gray Canvas basemap: a clean labelled dark map served without an API key or
// watermark. (OpenStreetMap's volunteer servers block app/bulk usage with 403, and
// Carto's public tiles are now watermarked "API key required".) Note the Esri URL
// order is {z}/{y}/{x}. For production, configure an authorized/licensed provider.
export const publicMapConfig = {
  style: process.env.NEXT_PUBLIC_MAP_STYLE || 'demo-raster',
  tiles:
    process.env.NEXT_PUBLIC_MAP_TILES ||
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || 'Tiles © Esri · © OpenStreetMap contributors',
};
