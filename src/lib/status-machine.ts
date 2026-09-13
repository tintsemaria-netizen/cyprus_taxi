import { BookingStatus } from '@prisma/client';

// SPEC §4 — the ONLY allowed transitions. `terminate` (exceptional IN_PROGRESS
// cancellation) is handled separately with required reason + audit.
type Actor = 'STAFF' | 'DRIVER' | 'PASSENGER';

const TRANSITIONS: Record<BookingStatus, Partial<Record<BookingStatus, Actor[]>>> = {
  REQUESTED: {
    // Manual admin override (Task 012 keeps manual dispatch as an audited fallback);
    // scheduled rides also start REQUESTED and are promoted to SEARCHING by automation.
    SEARCHING: ['STAFF'],
    ASSIGNED: ['STAFF'],
    CANCELED: ['STAFF', 'PASSENGER'],
  },
  SEARCHING: {
    // ASSIGNED is normally reached by a driver accepting an offer (handled atomically in
    // the dispatch layer); STAFF may also manually assign as an audited override.
    ASSIGNED: ['STAFF'],
    NO_DRIVER: ['STAFF'],
    CANCELED: ['STAFF', 'PASSENGER'],
  },
  NO_DRIVER: {
    SEARCHING: ['STAFF', 'PASSENGER'], // retry the search
    ASSIGNED: ['STAFF'], // manual override
    CANCELED: ['STAFF', 'PASSENGER'],
  },
  ASSIGNED: {
    EN_ROUTE: ['STAFF', 'DRIVER'],
    CANCELED: ['STAFF', 'PASSENGER'],
  },
  EN_ROUTE: {
    ARRIVED: ['STAFF', 'DRIVER'],
    CANCELED: ['STAFF', 'PASSENGER'],
  },
  ARRIVED: {
    IN_PROGRESS: ['STAFF', 'DRIVER'],
    CANCELED: ['STAFF', 'PASSENGER'],
  },
  IN_PROGRESS: {
    COMPLETED: ['STAFF', 'DRIVER'],
    // Note: IN_PROGRESS -> CANCELED is NOT here; only via exceptional terminate.
  },
  COMPLETED: {},
  CANCELED: {},
};

export function canTransition(
  from: BookingStatus,
  to: BookingStatus,
  actor: Actor,
): boolean {
  const allowed = TRANSITIONS[from]?.[to];
  return !!allowed && allowed.includes(actor);
}

export function allowedNext(from: BookingStatus, actor: Actor): BookingStatus[] {
  const map = TRANSITIONS[from] || {};
  return (Object.keys(map) as BookingStatus[]).filter((to) =>
    map[to]!.includes(actor),
  );
}

export const TERMINAL: BookingStatus[] = ['COMPLETED', 'CANCELED'];

export function isTerminal(s: BookingStatus): boolean {
  return TERMINAL.includes(s);
}

// Statuses in which a passenger may cancel (SPEC §3.11).
export const PASSENGER_CANCELABLE: BookingStatus[] = [
  'REQUESTED',
  'SEARCHING',
  'NO_DRIVER',
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
];
