import { describe, it, expect } from 'vitest';
import { takesClasses, carTakes } from '@/lib/vehicle-class';

// «Заказы Comfort & XL» (2026-11-26, operator): an XL driver switches Comfort and XL separately.
describe('which orders a car takes', () => {
  it('Comfort car: Comfort only, whatever the switches say', () => {
    expect(takesClasses('COMFORT', false, false)).toEqual(['COMFORT']);
    expect(carTakes('COMFORT', true, 'XL', true)).toBe(false);
  });
  it('XL car: both by default; each switch on its own; never nothing', () => {
    expect(takesClasses('XL')).toEqual(['XL', 'COMFORT']);
    expect(takesClasses('XL', false, true)).toEqual(['XL']);
    expect(takesClasses('XL', true, false)).toEqual(['COMFORT']);
    expect(carTakes('XL', true, 'XL', false)).toBe(false);
    expect(carTakes('XL', true, 'COMFORT', false)).toBe(true);
    expect(takesClasses('XL', false, false)).toEqual(['XL']); // the API refuses this; the rule stays safe anyway
  });
});
