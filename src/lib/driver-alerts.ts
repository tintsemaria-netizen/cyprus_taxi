'use client';

// Driver-side attention helpers (2026-10-01 audit): an offer lives only 20 s, so a silent card on
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

// Short two-tone chime, synthesised (no audio file to load or cache).
export function playOfferChime(): void {
  try {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    [[880, 0], [1320, 0.18]].forEach(([freq, at]) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.35, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.16);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.18);
    });
  } catch { /* ignore */ }
}

export function vibrateOffer(): void {
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
