import { prisma } from './db';
import { config } from './config';
import { DEMO_CYPRUS_POLYGON, LatLng } from './geo';

// Operator-configurable settings with safe defaults. Secrets are NEVER stored
// here or returned by settings APIs (SPEC §5).
export interface OperationalSettings {
  serviceAreaPolygon: LatLng[];
  scheduleMinMinutes: number;
  scheduleMaxDays: number;
  minStopDistanceMeters: number;
  gpsFreshSeconds: number;
  gpsStaleSeconds: number;
  supportPhone: string | null;
  supportEmail: string | null;
  operatorName: string | null;
  classes: { key: 'COMFORT' | 'XL'; label: string; maxPassengers: number }[];
}

const DEFAULTS: OperationalSettings = {
  serviceAreaPolygon: DEMO_CYPRUS_POLYGON,
  scheduleMinMinutes: config.schedule.minMinutes,
  scheduleMaxDays: config.schedule.maxDays,
  minStopDistanceMeters: config.minStopDistanceMeters,
  gpsFreshSeconds: config.gps.freshSeconds,
  gpsStaleSeconds: config.gps.staleSeconds,
  supportPhone: null,
  supportEmail: null,
  operatorName: null,
  classes: [
    { key: 'COMFORT', label: 'Comfort', maxPassengers: 4 },
    { key: 'XL', label: 'XL', maxPassengers: 6 },
  ],
};

const KEY = 'operational';

export async function getSettings(): Promise<OperationalSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULTS;
  try {
    return { ...DEFAULTS, ...(JSON.parse(row.value) as Partial<OperationalSettings>) };
  } catch {
    return DEFAULTS;
  }
}

export async function saveSettings(patch: Partial<OperationalSettings>): Promise<OperationalSettings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}

// Safe public subset for GET /public/config.
export async function getPublicConfig() {
  const s = await getSettings();
  return {
    demoMode: config.demoMode,
    timezone: config.timezone,
    currency: config.currency,
    operatorName: s.operatorName,
    supportPhone: s.supportPhone,
    supportEmail: s.supportEmail,
    classes: s.classes,
    schedule: { minMinutes: s.scheduleMinMinutes, maxDays: s.scheduleMaxDays },
    serviceAreaPolygon: s.serviceAreaPolygon,
    fareWording: 'Fare confirmed by dispatcher',
  };
}
