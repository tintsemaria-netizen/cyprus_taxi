import { AIRPORTS, pinAirportAreas } from '@/lib/airports';

// Since 2026-11-25 an airport is a pickup territory marked «это аэропорт» (no fixed circle). Most tests are about
// something else and expect «at the terminal» to be the airport, so they get a fixed test area: a 2.5 km ring
// around each terminal (the old circle). tests/airport-territory.db.test.ts unpins it and tests the real thing.
const ring = (lat: number, lng: number, m: number): [number, number][] =>
  Array.from({ length: 48 }, (_, i) => {
    const a = (2 * Math.PI * i) / 48;
    return [lat + (m / 110_540) * Math.cos(a), lng + (m / 111_320 / Math.cos((lat * Math.PI) / 180)) * Math.sin(a)];
  });
pinAirportAreas(AIRPORTS.map((a) => ({ code: a.code, polygon: ring(a.lat, a.lng, 2500) })));
