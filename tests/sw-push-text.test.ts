import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

// Notifications in the app's / phone's language (2026-11-22): every text key the server sends
// must exist in public/sw.js MSG_TEXT in all 8 languages, with the same {placeholders}.
const LANGS = ['ru', 'en', 'el', 'de', 'fr', 'pl', 'he', 'ar'];
const src = readFileSync('public/sw.js', 'utf8');
const ctx: Record<string, unknown> = { self: { addEventListener() {}, navigator: { language: 'en' } }, caches: { open: async () => ({ match: async () => null }) }, Intl };
vm.runInNewContext(`${src}\n;this.MSG_TEXT = MSG_TEXT; this.msgText = msgText;`, ctx);
const MSG = ctx.MSG_TEXT as Record<string, Record<string, [string, string]>>;
const msgText = ctx.msgText as (m: { k: string; p?: Record<string, unknown> }, L: string) => { title: string; body: string } | null;

function serverKeys(): string[] {
  const out = new Set<string>();
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/\bk: '([a-z]+\.[A-Za-z]+)'/g)) out.add(m[1]); } };
  walk('src/server');
  return [...out];
}

describe('notification texts on the phone', () => {
  it('every key the server sends exists in all 8 languages with the same placeholders', () => {
    const keys = serverKeys();
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) {
      expect(MSG[k], k).toBeTruthy();
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      for (const L of LANGS) {
        expect(MSG[k][L], `${k} ${L}`).toBeTruthy();
        expect(ph(MSG[k][L].join(' ')), `${k} ${L}`).toBe(ph(MSG[k].en.join(' ')));
      }
    }
  });
  it('fills values and formats euro cents in the language', () => {
    expect(msgText({ k: 'share.joinGuest', p: { nowC: 4200, wasC: 6000 } }, 'ru')?.body).toBe('Вы едете с попутчиком: 42,00 € вместо 60,00 €.');
    expect(msgText({ k: 'share.assigned', p: { driver: 'Andreas' } }, 'en')?.body).toContain('Andreas is assigned');
    expect(msgText({ k: 'unknown.key' }, 'ru')).toBeNull(); // → the server's English text
  });
});
