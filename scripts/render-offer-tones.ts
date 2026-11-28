// Writes every new-order tone to a WAV file (same notes and envelope as the browser player), so a
// tone can be heard before it is deployed. Usage: npx tsx scripts/render-offer-tones.ts <out-dir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { OFFER_TONES, TONES, toneLength, type ToneNote } from '../src/lib/offer-tones';

const RATE = 44100;
const PEAK = 0.6;

function wave(type: ToneNote['wave'], phase: number): number {
  const p = phase - Math.floor(phase);
  switch (type) {
    case 'square': return p < 0.5 ? 1 : -1;
    case 'triangle': return 4 * Math.abs(p - 0.5) - 1;
    case 'sawtooth': return 2 * p - 1;
    default: return Math.sin(2 * Math.PI * p);
  }
}

// Same shape as WebAudio's exponentialRampToValueAtTime from 0.0001 → peak (20 ms) → hold → 0.0001.
function env(t: number, n: ToneNote, peak: number): number {
  const lo = 0.0001, atk = 0.02, hold = n.hold ?? 0;
  if (t < 0 || t > n.len) return 0;
  if (t < atk) return lo * Math.pow(peak / lo, t / atk);
  if (t < atk + hold) return peak;
  const d = n.len - atk - hold;
  return peak * Math.pow(lo / peak, (t - atk - hold) / d);
}

const out = process.argv[2] ?? '/tmp/tones';
mkdirSync(out, { recursive: true });
for (const tone of OFFER_TONES) {
  const total = toneLength(tone) + 0.05;
  const n = Math.ceil(total * RATE);
  const buf = new Float64Array(n);
  for (const note of TONES[tone]) {
    const peak = Math.max(0.0002, PEAK * (note.level ?? 1));
    for (let i = Math.floor(note.at * RATE); i < n; i++) {
      const t = i / RATE - note.at;
      if (t > note.len) break;
      buf[i] += wave(note.wave, note.f * t) * env(t, note, peak);
    }
  }
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write('WAVE', 8);
  pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(RATE, 24); pcm.writeUInt32LE(RATE * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36); pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
  writeFileSync(join(out, `${tone}.wav`), pcm);
  console.log(tone, total.toFixed(2) + 's');
}
