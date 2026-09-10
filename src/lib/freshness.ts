import { config } from './config';

export type Freshness = 'fresh' | 'stale' | 'disconnected';

// Based on both sample age and receive age (SPEC §6).
export function computeFreshness(sampledAt: Date, receivedAt: Date, now = new Date()): Freshness {
  const ageSec = Math.max(
    (now.getTime() - sampledAt.getTime()) / 1000,
    (now.getTime() - receivedAt.getTime()) / 1000,
  );
  if (ageSec <= config.gps.freshSeconds) return 'fresh';
  if (ageSec <= config.gps.staleSeconds) return 'stale';
  return 'disconnected';
}

export function poorAccuracy(accuracyM: number): boolean {
  return accuracyM > 100;
}
