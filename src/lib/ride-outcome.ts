// How a passenger's ride ended, for «Мои поездки» and the ride page (2026-11-20).
// NO_DRIVER is a dead end once it is not fresh: after this many minutes the passenger can no
// longer «search again» on the same order (it would re-dispatch an old route) — it «did not take place».
export const NO_DRIVER_RETRY_MINUTES = 30;

/** `since` = when the order became NO_DRIVER (its last status event). */
export function noDriverRetryable(status: string, since: Date | null | undefined, now: Date = new Date()): boolean {
  return status === 'NO_DRIVER' && !!since && now.getTime() - since.getTime() < NO_DRIVER_RETRY_MINUTES * 60_000;
}
