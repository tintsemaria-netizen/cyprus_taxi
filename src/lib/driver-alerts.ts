'use client';

// Driver-side attention helpers (2026-10-01 audit): an offer lives only 10 s, so a silent card on
// a car-mounted phone is easy to miss, and a sleeping screen suspends the page — which stops both
// offer polling and the foreground GPS dispatch depends on.

let ctx: AudioContext | null = null;

// Must be called from a user gesture (e.g. "Go online") so browsers allow audio later.
export function unlockOfferSound(): void {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* audio unavailable — vibration still works */ }
}

// Sound of a new order (2026-11-27, operator: tone, volume, vibration and «Прослушать» in the driver's settings).
// Kept on this phone (localStorage), like the navigator choice. Tones are synthesised — no audio files.
export type OfferTone = 'chime' | 'bell' | 'pulse';
export interface OfferSoundPrefs { tone: OfferTone; volume: number; vibrate: boolean }
const PREFS_KEY = 'ily-offer-sound';
export const DEFAULT_OFFER_SOUND: OfferSoundPrefs = { tone: 'chime', volume: 0.7, vibrate: true };

export function readOfferSound(): OfferSoundPrefs {
  try {
    const j = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') as Partial<OfferSoundPrefs> | null;
    if (!j) return DEFAULT_OFFER_SOUND;
    const tone: OfferTone = j.tone === 'bell' || j.tone === 'pulse' ? j.tone : 'chime';
    const volume = typeof j.volume === 'number' ? Math.max(0, Math.min(1, j.volume)) : DEFAULT_OFFER_SOUND.volume;
    return { tone, volume, vibrate: j.vibrate !== false };
  } catch { return DEFAULT_OFFER_SOUND; }
}
export function writeOfferSound(p: OfferSoundPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

// [frequency Hz, start s, length s] per tone.
const TONES: Record<OfferTone, [number, number, number][]> = {
  chime: [[880, 0, 0.16], [1320, 0.18, 0.16]],
  bell: [[1046, 0, 0.5], [1568, 0.02, 0.45], [784, 0.55, 0.5]],
  pulse: [[990, 0, 0.09], [990, 0.14, 0.09], [990, 0.28, 0.09], [990, 0.42, 0.09]],
};

function play(tone: OfferTone, volume: number): void {
  try {
    if (!ctx || ctx.state !== 'running' || volume <= 0) return;
    const now = ctx.currentTime;
    const peak = 0.6 * volume;
    TONES[tone].forEach(([freq, at, len]) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = tone === 'pulse' ? 'square' : 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, tone === 'pulse' ? peak * 0.4 : peak), now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + len);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(now + at);
      osc.stop(now + at + len + 0.02);
    });
  } catch { /* ignore */ }
}

// The new-order sound with the driver's choice.
export function playOfferChime(): void {
  const p = readOfferSound();
  play(p.tone, p.volume);
}

/** «Прослушать» in the settings: a tap is a user gesture, so audio can start here. */
export function previewOfferSound(p: OfferSoundPrefs): void {
  unlockOfferSound();
  window.setTimeout(() => play(p.tone, p.volume), 60);
  if (p.vibrate) { try { navigator.vibrate?.([300, 150, 300]); } catch { /* unsupported */ } }
}

export function vibrateOffer(): void {
  if (!readOfferSound().vibrate) return;
  try { navigator.vibrate?.([300, 150, 300]); } catch { /* unsupported */ }
}

// Screen Wake Lock while on duty. The lock is dropped by the browser when the page is hidden, so
// callers re-request it on visibilitychange. Returns a release function.
export function keepScreenOn(): () => void {
  let lock: { release: () => Promise<void> } | null = null;
  let stopped = false;
  const request = async () => {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      if (!wl || stopped || document.visibilityState !== 'visible') return;
      lock = await wl.request('screen');
    } catch { /* denied / unsupported (e.g. low battery mode) */ }
  };
  const onVis = () => { if (document.visibilityState === 'visible') void request(); };
  void request();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVis);
    void lock?.release().catch(() => {});
    lock = null;
  };
}
