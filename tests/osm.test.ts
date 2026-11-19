import { describe, expect, it } from 'vitest';
import { placeFold } from '@/lib/placeFold';
import { classify, greekToLatin } from '@/server/osm/extract';

describe('own address base — folding', () => {
  it('meets Greek, Latin variants and Russian at one spelling', () => {
    expect(placeFold('Πάφος')).toBe(placeFold('Paphos'));
    expect(placeFold('Pafos')).toBe(placeFold('пафос'));
    expect(placeFold('Ayia Napa')).toBe(placeFold('Αγία Νάπα'));
    expect(placeFold('Larnaca')).toBe(placeFold('Larnaka'));
    expect(placeFold('Limassol')).toBe(placeFold('Limasol'));
    expect(placeFold('Αγίας Φυλάξεως')).toBe(placeFold('агиас филаксеос'));
    expect(placeFold('Μακαρίου')).toBe(placeFold('макариу'));
  });
  it('shows Greek names in Latin letters', () => {
    expect(greekToLatin('Αγίας Φυλάξεως')).toBe('Agias Fylaxeos');
    expect(greekToLatin('Λεμεσός')).toBe('Lemesos');
    expect(greekToLatin('Limassol Marina')).toBe('Limassol Marina');
  });
  it('keeps every kind of named place, skips street furniture', () => {
    expect(classify({ tourism: 'guest_house', name: 'x' })?.kind).toBe('hotel');
    expect(classify({ amenity: 'place_of_worship', name: 'x' })?.kind).toBe('church');
    expect(classify({ natural: 'beach', name: 'x' })?.kind).toBe('beach');
    expect(classify({ amenity: 'clinic', name: 'x' })?.kind).toBe('clinic');
    expect(classify({ place: 'hamlet', name: 'x' })?.kind).toBe('village');
    expect(classify({ amenity: 'bench', name: 'x' })).toBeNull();
  });
});
