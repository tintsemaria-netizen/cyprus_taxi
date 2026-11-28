// New-order tones (2026-11-28, operator: «есть что-нибудь бодрее и чуть подлиннее»).
// Pure data, shared by the browser player (driver-alerts.ts) and scripts/render-offer-tones.ts, which
// writes the same notes to WAV files so the operator can listen before a deploy.

export type OfferTone = 'chime' | 'bell' | 'pulse' | 'fanfare' | 'marimba' | 'rhythm' | 'trill' | 'retro';
export const OFFER_TONES: OfferTone[] = ['fanfare', 'marimba', 'rhythm', 'trill', 'retro', 'chime', 'bell', 'pulse'];

export interface ToneNote {
  f: number; // frequency, Hz
  at: number; // start, s
  len: number; // length incl. fade-out, s
  wave?: OscillatorType; // default 'sine'
  level?: number; // 0..1 of the peak, default 1
  hold?: number; // s the note stays at the peak before fading, default 0 (plucked)
}

const C5 = 523.25, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, D6 = 1174.66, E6 = 1318.51, G6 = 1567.98, A6 = 1760;

/** A plucked mallet note: the tone plus a quiet, fast-dying 4th harmonic for the «wooden» click. */
function mallet(f: number, at: number, len: number): ToneNote[] {
  return [{ f, at, len, wave: 'sine' }, { f: f * 4, at, len: Math.min(0.08, len), wave: 'sine', level: 0.25 }];
}

export const TONES = {
  // The three original short tones (2026-11-27).
  chime: [{ f: 880, at: 0, len: 0.16 }, { f: 1320, at: 0.18, len: 0.16 }],
  bell: [{ f: 1046, at: 0, len: 0.5 }, { f: 1568, at: 0.02, len: 0.45 }, { f: 784, at: 0.55, len: 0.5 }],
  pulse: [0, 0.14, 0.28, 0.42].map((at) => ({ f: 990, at, len: 0.09, wave: 'square' as const, level: 0.4 })),

  // Fanfare ≈1.3 s: quick rising arpeggio into a held major chord.
  fanfare: [
    { f: G5, at: 0, len: 0.13, wave: 'triangle' },
    { f: C6, at: 0.12, len: 0.13, wave: 'triangle' },
    { f: E6, at: 0.24, len: 0.13, wave: 'triangle' },
    { f: G6, at: 0.36, len: 0.9, wave: 'triangle', level: 0.65, hold: 0.4 },
    { f: E6, at: 0.36, len: 0.9, wave: 'triangle', level: 0.35, hold: 0.4 },
    { f: C6, at: 0.36, len: 0.9, wave: 'triangle', level: 0.3, hold: 0.4 },
  ],

  // Marimba ≈1.5 s: a bouncy six-note tune.
  marimba: [
    ...mallet(E6, 0, 0.3), ...mallet(G6, 0.15, 0.3), ...mallet(E6, 0.3, 0.3),
    ...mallet(C6, 0.45, 0.3), ...mallet(D6, 0.6, 0.3), ...mallet(G6, 0.78, 0.7),
  ],

  // Rhythm ≈1.6 s: a short «ta-ta-taa» played twice, the second time higher.
  rhythm: [
    { f: A5, at: 0, len: 0.1, wave: 'square', level: 0.6 },
    { f: A5, at: 0.14, len: 0.1, wave: 'square', level: 0.6 },
    { f: E6, at: 0.28, len: 0.3, wave: 'square', level: 0.6, hold: 0.12 },
    { f: C6, at: 0.75, len: 0.1, wave: 'square', level: 0.6 },
    { f: C6, at: 0.89, len: 0.1, wave: 'square', level: 0.6 },
    { f: A6, at: 1.03, len: 0.45, wave: 'square', level: 0.6, hold: 0.18 },
  ],

  // Trill ≈1.3 s: fast up-and-down sparkle, ending on a bright long note.
  trill: [
    ...[C6, E6, C6, E6, D6, G6, D6, G6].map((f, i) => ({ f, at: i * 0.075, len: 0.09, wave: 'triangle' as const })),
    { f: C5 * 4, at: 0.62, len: 0.7, wave: 'triangle', hold: 0.25 },
    { f: E5 * 2, at: 0.62, len: 0.7, wave: 'triangle', level: 0.5, hold: 0.25 },
  ],
  retro: [],
} as Record<OfferTone, ToneNote[]>;

/** Retro ≈1.7 s: an original monophonic tune in the style of a 2000s button phone (square wave).
 *  Deliberately NOT the Nokia tune — that one is Nokia's registered sound trademark. */
const RETRO: [number, number][] = [
  [1046.5, 1], [1318.51, 1], [1567.98, 1], [1318.51, 1], [1396.91, 1], [1760, 1], [1567.98, 2],
  [1174.66, 1], [1396.91, 1], [1318.51, 1], [1174.66, 1], [1046.5, 3],
];
{
  let at = 0;
  TONES.retro = RETRO.map(([f, beats]) => {
    const len = beats * 0.12 - 0.02;
    const n: ToneNote = { f, at, len, wave: 'square', level: 0.5, hold: Math.max(0, len - 0.06) };
    at += beats * 0.12;
    return n;
  });
}

/** Total length of a tone, s. */
export function toneLength(tone: OfferTone): number {
  return Math.max(...TONES[tone].map((n) => n.at + n.len));
}

export function isOfferTone(v: unknown): v is OfferTone {
  return typeof v === 'string' && (OFFER_TONES as string[]).includes(v);
}
