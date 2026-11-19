import { describe, expect, it } from 'vitest';
import { postcodeFromLabel } from '@/server/postcode';

describe('postcodeFromLabel', () => {
  it('reads Cyprus postcodes from address lines', () => {
    expect(postcodeFromLabel('Leof. Archiepiskopou Makariou III 3, Limassol 3030, Cyprus')).toBe('3030');
    expect(postcodeFromLabel('Agias Fylaxeos 12, Lemesos 3025')).toBe('3025');
    expect(postcodeFromLabel('Λεμεσός 4046, Κύπρος')).toBe('4046');
  });
  it('ignores house numbers and labels without a postcode', () => {
    expect(postcodeFromLabel('Larnaca Airport (LCA)')).toBeNull();
    expect(postcodeFromLabel('Amerikanas 2, Germasogeia')).toBeNull();
    expect(postcodeFromLabel('Pin 34.69320, 33.06450')).toBeNull();
  });
});
