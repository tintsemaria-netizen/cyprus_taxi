"""Original IL-Y driver ringtones (2026-11-28, operator: «не звуки, а рингтоны»).

All melodies are written here — no samples, no third-party music. Renders WAV with numpy;
encode to MP3 with ffmpeg. Usage: python3 scripts/ringtones/render.py <out-dir>
"""
import sys, os, wave
import numpy as np

SR = 44100
rng = np.random.default_rng(7)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


N = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}


def m(name):  # 'C5' -> midi
    return 12 * (int(name[-1]) + 1) + N[name[:-1]]


def env_adsr(n, a, d, s, r, sus_len):
    t = np.arange(n) / SR
    e = np.zeros(n)
    a_n, d_n = int(a * SR), int(d * SR)
    sl = int(sus_len * SR)
    e[:a_n] = np.linspace(0, 1, a_n, endpoint=False)
    e[a_n:a_n + d_n] = np.linspace(1, s, d_n, endpoint=False)[: max(0, min(d_n, n - a_n))]
    e[a_n + d_n:sl] = s
    rel = n - max(sl, a_n + d_n)
    if rel > 0:
        start = e[max(sl, a_n + d_n) - 1] if max(sl, a_n + d_n) > 0 else s
        e[max(sl, a_n + d_n):] = start * np.exp(-np.arange(rel) / (r * SR))
    return e


def marimba(f, dur):
    n = int((dur + 0.6) * SR); t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 6) + 0.35 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 30) \
        + 0.15 * np.sin(2 * np.pi * f * 9.9 * t) * np.exp(-t * 60)
    return x * np.minimum(1, t / 0.002)


def bell(f, dur):  # FM bell
    n = int((dur + 1.6) * SR); t = np.arange(n) / SR
    idx = 3.5 * np.exp(-t * 3)
    x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * 3.5 * t)) * np.exp(-t * 2.2)
    return x * np.minimum(1, t / 0.003)


def epiano(f, dur):
    n = int((dur + 0.5) * SR); t = np.arange(n) / SR
    idx = 1.6 * np.exp(-t * 5)
    x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    return x * env_adsr(n, 0.005, 0.25, 0.5, 0.25, dur)


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc; y[i] = acc
    return y


def saw_lead(f, dur, cut=3500):
    n = int((dur + 0.15) * SR); t = np.arange(n) / SR
    x = sum(((2 * ((f * k * t) % 1) - 1) * (0.5 if k else 1)) for k in (1, 1.004)) / 1.5
    x = lowpass(x, cut)
    return x * env_adsr(n, 0.008, 0.08, 0.7, 0.06, dur)


def square(f, dur, duty=0.5):
    n = int((dur + 0.05) * SR); t = np.arange(n) / SR
    x = np.where((f * t) % 1 < duty, 1.0, -1.0)
    x = lowpass(x, 6000)
    return x * env_adsr(n, 0.003, 0.05, 0.8, 0.02, dur)


def pluck(f, dur):  # Karplus-Strong guitar
    n = int((dur + 0.8) * SR); p = int(SR / f)
    buf = rng.uniform(-1, 1, p); out = np.empty(n)
    for i in range(n):
        out[i] = buf[i % p]
        buf[i % p] = 0.996 * 0.5 * (buf[i % p] + buf[(i + 1) % p])
    return lowpass(out, 5000)


def bass(f, dur):
    n = int((dur + 0.1) * SR); t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)
    return x * env_adsr(n, 0.005, 0.1, 0.8, 0.05, dur)


def pad(fs, dur):
    n = int((dur + 0.6) * SR); t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.003 * t) for f in fs)
    return x / len(fs) * env_adsr(n, 0.15, 0.2, 0.8, 0.4, dur)


def kick():
    n = int(0.35 * SR); t = np.arange(n) / SR
    f = 50 + 100 * np.exp(-t * 35)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def hat(open_=False):
    n = int((0.25 if open_ else 0.06) * SR); t = np.arange(n) / SR
    x = rng.uniform(-1, 1, n); x = x - lowpass(x, 7000)
    return x * np.exp(-t * (12 if open_ else 60))


def clap():
    n = int(0.2 * SR); t = np.arange(n) / SR
    x = rng.uniform(-1, 1, n); x = lowpass(x - lowpass(x, 900), 5000)
    e = np.exp(-t * 25) + sum(np.exp(-np.maximum(0, t - d) * 200) * (t >= d) for d in (0.01, 0.02))
    return x * e * 0.6


class Song:
    def __init__(self, bpm, beats, tail=1.2):
        self.spb = 60 / bpm
        self.buf = np.zeros(int((beats * self.spb + tail) * SR) + SR)

    def add(self, beat, sig, gain=1.0):
        i = int(beat * self.spb * SR)
        j = min(len(self.buf), i + len(sig))
        self.buf[i:j] += sig[: j - i] * gain

    def notes(self, inst, seq, gain=1.0):
        for b, name, d in seq:
            self.add(b, inst(hz(m(name)), d * self.spb), gain)

    def render(self):
        x = self.buf
        # small room: two feedback delays
        y = x.copy()
        for dl, g in ((0.031, 0.25), (0.047, 0.2), (0.089, 0.12)):
            k = int(dl * SR); z = np.zeros_like(x); z[k:] = y[:-k] * g; y = y + z
        y = y / (np.max(np.abs(y)) + 1e-9) * 0.89  # about -1 dBFS
        nz = np.nonzero(np.abs(y) > 1e-4)[0]
        y = y[: nz[-1] + 1] if len(nz) else y
        fade = int(0.05 * SR); y[-fade:] *= np.linspace(1, 0, fade)
        return y


def chords(song, inst, seq, gain):
    for b, names, d in seq:
        for nm in names:
            song.add(b, inst(hz(m(nm)), d * song.spb), gain / len(names))


def morning():  # «Утро»: marimba pop, 120 bpm
    s = Song(120, 9)
    s.notes(marimba, [(0, 'E5', .5), (.5, 'G5', .5), (1, 'C6', .5), (1.5, 'B5', .25), (1.75, 'C6', .25), (2, 'D6', .5),
                      (2.5, 'C6', .5), (3, 'G5', 1), (4, 'A5', .5), (4.5, 'C6', .5), (5, 'E6', .5), (5.5, 'D6', .25),
                      (5.75, 'C6', .25), (6, 'D6', .5), (6.5, 'B5', .5), (7, 'G5', .5), (7.5, 'B5', .5), (8, 'C6', 1.5)], 1.0)
    chords(s, epiano, [(0, ['C4', 'E4', 'G4'], 2), (2, ['B3', 'D4', 'G4'], 2), (4, ['A3', 'C4', 'E4'], 2),
                       (6, ['A3', 'C4', 'F4'], 1), (7, ['B3', 'D4', 'G4'], 1), (8, ['C4', 'E4', 'G4'], 1.5)], 0.9)
    s.notes(bass, [(0, 'C3', 1.5), (2, 'G2', 1.5), (4, 'A2', 1.5), (6, 'F2', .9), (7, 'G2', .9), (8, 'C3', 1)], 0.55)
    for b in range(8):
        s.add(b, kick(), 0.5 if b % 2 == 0 else 0.0)
        s.add(b + .5, hat(), 0.18)
    return s.render()


def electro():  # «Электро»: synth-pop, 128 bpm
    s = Song(128, 9)
    prog = [('A3', ['A4', 'C5', 'E5']), ('F3', ['F4', 'A4', 'C5']), ('C3', ['C5', 'E5', 'G5']), ('G3', ['G4', 'B4', 'D5'])]
    for bar, (root, tri) in enumerate(prog):
        b0 = bar * 2
        for k in range(8):  # 16th arpeggio
            s.notes(lambda f, d: square(f, d, 0.25), [(b0 + k * .25, tri[[0, 1, 2, 1][k % 4]], .2)], 0.16)
        s.notes(bass, [(b0, root, .45), (b0 + .75, root, .2), (b0 + 1, root, .45), (b0 + 1.5, root, .45)], 0.5)
    s.notes(saw_lead, [(0, 'E5', .5), (.5, 'A5', .5), (1, 'C6', .75), (1.75, 'B5', .25), (2, 'A5', .5), (2.5, 'C6', .5),
                       (3, 'F5', 1), (4, 'E5', .5), (4.5, 'G5', .5), (5, 'C6', .75), (5.75, 'D6', .25), (6, 'B5', .5),
                       (6.5, 'G5', .5), (7, 'D6', .5), (7.5, 'B5', .5), (8, 'A5', 1.5)], 0.55)
    for b in range(8):
        s.add(b, kick(), 0.75)
        if b % 2 == 1: s.add(b, clap(), 0.55)
        s.add(b + .5, hat(True), 0.12)
    s.add(8, kick(), 0.75)
    return s.render()


def bells():  # «Колокола»: bright FM bells over a soft pad, 100 bpm
    s = Song(100, 7, tail=2.0)
    s.notes(bell, [(0, 'G5', .5), (.5, 'D6', .5), (1, 'E6', .5), (1.5, 'G6', .5), (2, 'E6', .5), (2.5, 'D6', .5),
                   (3, 'B5', 1), (4, 'C6', .5), (4.5, 'E6', .5), (5, 'G6', .5), (5.5, 'A6', .5), (6, 'G6', 1.5)], 0.9)
    s.notes(bell, [(0, 'G4', 2), (2, 'B4', 2), (4, 'C5', 2), (6, 'D5', 1.5)], 0.35)
    s.add(0, pad([hz(m('G3')), hz(m('B3')), hz(m('D4'))], 2 * s.spb), 0.35)
    s.add(2, pad([hz(m('E3')), hz(m('G3')), hz(m('B3'))], 2 * s.spb), 0.35)
    s.add(4, pad([hz(m('C3')), hz(m('E3')), hz(m('G3'))], 2 * s.spb), 0.35)
    s.add(6, pad([hz(m('D3')), hz(m('G3')), hz(m('B3'))], 1.5 * s.spb), 0.35)
    return s.render()


def guitar():  # «Гитара»: plucked funky riff, 112 bpm
    s = Song(112, 9)
    riff = [(0, 'E4', .25), (.5, 'G4', .25), (.75, 'A4', .25), (1.25, 'B4', .25), (1.5, 'D5', .5), (2, 'B4', .25),
            (2.5, 'A4', .25), (3, 'G4', .5), (3.5, 'A4', .25)]
    s.notes(pluck, riff, 0.9)
    s.notes(pluck, [(b + 4, n.replace('4', '5') if n.endswith('4') else n.replace('5', '6'), d) for b, n, d in riff[:-1]] + [(7.5, 'E5', .25), (8, 'E5', 1)], 0.85)
    s.notes(bass, [(0, 'E2', .4), (.75, 'E2', .2), (1, 'G2', .4), (2, 'A2', .4), (2.75, 'A2', .2), (3, 'B2', .4),
                   (4, 'E2', .4), (4.75, 'E2', .2), (5, 'G2', .4), (6, 'A2', .4), (6.75, 'B2', .2), (7, 'D3', .4), (8, 'E2', 1)], 0.6)
    for b in range(8):
        s.add(b, kick(), 0.6)
        if b % 2 == 1: s.add(b, clap(), 0.45)
        for q in (.25, .5, .75): s.add(b + q, hat(), 0.12 if q != .5 else 0.2)
    s.add(8, kick(), 0.6)
    return s.render()


def retro():  # «Ретро»: polyphonic button-phone ringtone (original tune), 140 bpm
    s = Song(140, 10)
    sq = lambda f, d: square(f, d, 0.5)
    s.notes(sq, [(0, 'C6', .5), (.5, 'E6', .5), (1, 'G6', .5), (1.5, 'E6', .5), (2, 'F6', .5), (2.5, 'A6', .5), (3, 'G6', 1),
                 (4, 'D6', .5), (4.5, 'F6', .5), (5, 'E6', .5), (5.5, 'D6', .5), (6, 'C6', .5), (6.5, 'E6', .5), (7, 'G6', .5),
                 (7.5, 'B5', .5), (8, 'C6', 1.5)], 0.35)
    s.notes(lambda f, d: square(f, d, 0.25), [(0, 'C4', .4), (1, 'G3', .4), (2, 'F3', .4), (3, 'G3', .4), (4, 'D4', .4),
                                              (5, 'G3', .4), (6, 'C4', .4), (7, 'G3', .4), (8, 'C4', 1)], 0.3)
    return s.render()


TONES = {'morning': morning, 'electro': electro, 'bells': bells, 'guitar': guitar, 'retro': retro}

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ringtones'
    os.makedirs(out, exist_ok=True)
    for name, fn in TONES.items():
        y = fn()
        pcm = (np.clip(y, -1, 1) * 32767).astype('<i2')
        with wave.open(os.path.join(out, f'{name}.wav'), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
        print(name, f'{len(y) / SR:.1f}s')
