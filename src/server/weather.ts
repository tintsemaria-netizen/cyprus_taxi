import { config } from '@/lib/config';

// Weather adapter (Task 012 §6.3). Bounded, with timeout, freshness and a NEUTRAL
// fallback. It never invents weather: with no configured provider it returns
// available:false (severity 0), so pricing/ETA treat weather as unknown, not calm.
//
// Providers:
//  - 'none'    (default): no external call; neutral/unavailable.
//  - 'fixture' (tests):   deterministic severity from WEATHER_FIXTURE_SEVERITY.
//  - 'open-meteo':        real fetch, ONLY if explicitly configured. Open-Meteo's free
//                         endpoint is not licensed for commercial use — leave off unless
//                         a commercial plan/key is authorized (see the task's §6.3 note).

export interface WeatherSnapshot {
  available: boolean;
  severity: number; // 0 (clear) .. 1 (severe); 0 when unavailable
  condition: string; // 'clear' | 'rain' | 'snow' | 'storm' | 'unknown'
  provider: string;
  observedAt: string | null; // ISO
  area: string;
}

const TIMEOUT_MS = 4000;

function neutral(provider: string, area = 'unknown'): WeatherSnapshot {
  return { available: false, severity: 0, condition: 'unknown', provider, observedAt: null, area };
}

export async function getWeather(lat: number, lng: number, at: Date = new Date()): Promise<WeatherSnapshot> {
  const provider = config.weather.provider;
  const area = `${lat.toFixed(2)},${lng.toFixed(2)}`;

  if (provider === 'none') return neutral('none', area);

  if (provider === 'fixture') {
    const sev = Math.max(0, Math.min(1, Number(process.env.WEATHER_FIXTURE_SEVERITY ?? '0')));
    return { available: true, severity: sev, condition: sev > 0.5 ? 'storm' : sev > 0 ? 'rain' : 'clear', provider: 'fixture', observedAt: at.toISOString(), area };
  }

  if (provider === 'open-meteo') {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=weather_code,precipitation,wind_speed_10m`;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let json: unknown;
      try {
        const res = await fetch(url, { signal: controller.signal });
        json = await res.json();
      } finally {
        clearTimeout(t);
      }
      const cur = (json as { current?: { time?: string; weather_code?: number; precipitation?: number; wind_speed_10m?: number } }).current;
      if (!cur) return neutral('open-meteo', area);
      // Freshness: reject a stale observation → neutral.
      if (cur.time) {
        const ageMin = (at.getTime() - new Date(cur.time).getTime()) / 60000;
        if (ageMin > config.weather.maxAgeMinutes) return neutral('open-meteo', area);
      }
      const sev = severityFromWmo(cur.weather_code ?? 0, cur.precipitation ?? 0, cur.wind_speed_10m ?? 0);
      return { available: true, severity: sev, condition: conditionFromWmo(cur.weather_code ?? 0), provider: 'open-meteo', observedAt: cur.time ?? at.toISOString(), area };
    } catch {
      return neutral('open-meteo', area); // timeout / network / parse → neutral, never fabricate
    }
  }

  return neutral(provider, area);
}

// WMO weather-code → coarse severity 0..1 (our own mapping, clearly a test heuristic).
function severityFromWmo(code: number, precip: number, wind: number): number {
  let s = 0;
  if (code >= 95) s = 1.0; // thunderstorm
  else if (code >= 71 && code <= 77) s = 0.7; // snow
  else if (code >= 61 && code <= 67) s = 0.55; // rain
  else if (code >= 51 && code <= 57) s = 0.3; // drizzle
  else if (code >= 45 && code <= 48) s = 0.25; // fog
  s = Math.max(s, Math.min(1, precip / 10)); // heavy precip raises it
  s = Math.max(s, Math.min(1, (wind - 40) / 40)); // gales raise it
  return Math.max(0, Math.min(1, s));
}

function conditionFromWmo(code: number): string {
  if (code >= 95) return 'storm';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 45 && code <= 48) return 'fog';
  return 'clear';
}
