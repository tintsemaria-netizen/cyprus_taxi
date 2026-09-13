// Bounded, deterministic UPFRONT_DYNAMIC multiplier (Task 012 §6.3). These are OUR OWN
// clearly-labelled TEST defaults, not a law or a competitor's numbers. Real dynamic
// charging stays inactive unless the commercial rule is established (PRICING_MODE gate).
//
// Properties enforced here:
//  - Insufficient evidence (too few samples) → multiplier 1.0 (no surge).
//  - Zero supply → NOT infinite: multiplier 1.0, availability handled by dispatch.
//  - Weather raises the DEMAND signal (bounded), never a separate multiplier stacked on
//    top — documented non-overlap (§6.3).
//  - Result is capped to [1.0, maxMultiplier] and quantised with hysteresis so it does
//    not flicker between quotes.

export const DYNAMIC_VERSION = 'ilyas-dyn-2026-09-13-test';

export const DYNAMIC_DEFAULTS = {
  maxMultiplier: 1.5, // proposed product ceiling (TEST) — not a statutory figure
  minSamples: 3, // combined requests+drivers needed before any surge
  sensitivity: 0.35, // how hard demand:supply pressure pushes the multiplier
  weatherDemandWeight: 0.3, // weather inflates the demand signal by up to +30%
  step: 0.1, // quantisation / hysteresis granularity
};

export interface DynamicInputs {
  activeRequests: number; // demand: recent unserved requests in zone/class/window
  availableDrivers: number; // supply: fresh eligible available drivers in zone/class
  weatherSeverity?: number; // 0..1 (0 or unknown → no weather effect)
  prevMultiplier?: number; // last quote's multiplier, for hysteresis
}

export interface DynamicResult {
  multiplier: number; // [1.0, maxMultiplier]
  applied: boolean; // false → 1.0 for lack of evidence / no supply
  demandSupplyRatio: number | null;
  reasons: string[];
  version: string;
}

export function computeDynamicMultiplier(input: DynamicInputs, opts: Partial<typeof DYNAMIC_DEFAULTS> = {}): DynamicResult {
  const cfg = { ...DYNAMIC_DEFAULTS, ...opts };
  const reasons: string[] = [];
  const demand = Math.max(0, input.activeRequests);
  const supply = Math.max(0, input.availableDrivers);
  const weather = Math.max(0, Math.min(1, input.weatherSeverity ?? 0));

  if (supply === 0) {
    reasons.push('no-supply'); // availability, not price — never divide by zero into an infinite fare
    return { multiplier: 1.0, applied: false, demandSupplyRatio: null, reasons, version: DYNAMIC_VERSION };
  }
  if (demand + supply < cfg.minSamples) {
    reasons.push('insufficient-samples');
    return { multiplier: 1.0, applied: false, demandSupplyRatio: demand / supply, reasons, version: DYNAMIC_VERSION };
  }

  // Weather folds into the demand signal (bounded), not a separate multiplier.
  const effectiveDemand = demand * (1 + weather * cfg.weatherDemandWeight);
  if (weather > 0) reasons.push(`weather+${Math.round(weather * cfg.weatherDemandWeight * 100)}%demand`);
  const ratio = effectiveDemand / supply;

  // Pressure above parity (ratio>1) raises the multiplier; at/below parity → 1.0.
  let m = 1 + Math.max(0, ratio - 1) * cfg.sensitivity;
  m = Math.max(1.0, Math.min(cfg.maxMultiplier, m));
  if (m >= cfg.maxMultiplier) reasons.push('capped');

  // Quantise to `step`, then apply hysteresis: keep the previous value unless the new
  // one differs by at least one step (avoids quote-to-quote flicker).
  m = Math.round(m / cfg.step) * cfg.step;
  if (input.prevMultiplier != null && Math.abs(m - input.prevMultiplier) < cfg.step - 1e-9) {
    m = input.prevMultiplier;
    reasons.push('hysteresis-hold');
  }
  m = Number(m.toFixed(2));

  if (m > 1.0) reasons.push('demand>supply');
  else reasons.push('balanced');
  return { multiplier: m, applied: m > 1.0, demandSupplyRatio: Number(ratio.toFixed(3)), reasons, version: DYNAMIC_VERSION };
}

// Apply the multiplier to ONLY the eligible base components (initial hire + distance),
// so regulated pax/luggage/holiday items are never double-multiplied. Returns the
// integer-cent surcharge to add on top of the regulated estimate.
export function dynamicSurchargeCents(eligibleBaseCents: number, multiplier: number): number {
  if (multiplier <= 1.0) return 0;
  return Math.round(eligibleBaseCents * (multiplier - 1));
}
