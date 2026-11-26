/** Does this booking pay by card (cashless) through the app? Not yet: every ride is «payment to the driver»
 *  (cash or the driver's own terminal). Card-only rules — the late-cancel fee (2026-11-26) — check this, so they
 *  switch on in one place when card payments are added. */
export function paysByCard(_b: { id: string }): boolean {
  return false;
}
