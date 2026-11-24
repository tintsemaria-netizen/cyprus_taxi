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
    expect(msgText({ k: 'share.joinGuest', p: { pct: 30 } }, 'ru')?.body).toBe('Вы едете с попутчиком: скидка −30%.');
    expect(msgText({ k: 'ride.noShowFee', p: { feeC: 500 } }, 'ru')?.body).toContain('5,00\u00a0€');
    expect(msgText({ k: 'pre.remind30', p: { timeT: '2026-11-23T07:30:00.000Z', place: 'LCA' } }, 'ru')?.body).toBe('Посадка в 09:30 — LCA.'); // Cyprus time
    expect(msgText({ k: 'share.assigned', p: { driver: 'Andreas' } }, 'en')?.body).toContain('Andreas is assigned');
    expect(msgText({ k: 'unknown.key' }, 'ru')).toBeNull(); // → the server's English text
    // 2026-11-24: driver documents, «pre-booking active», chat titles
    expect(msgText({ k: 'driver.docExpiring', p: { days: 7 } }, 'el')?.body).toContain('7 ημ');
    expect(msgText({ k: 'driver.docExpired', p: {} }, 'ru')?.title).toBe('Документы просрочены');
    expect(msgText({ k: 'pre.active', p: { timeT: '2026-11-24T11:00:00.000Z', place: 'LCA' } }, 'ru')?.body).toBe('Подача в 13:00: LCA. Выезжайте к месту подачи вовремя.');
    // 2026-11-24: document renewal — the document's name in the reader's language, capitalised at the start
    expect(msgText({ k: 'drv.docExpiring', p: { slot: 'insurance', days: 7 } }, 'ru')?.body).toBe('Страховка: срок истекает через 7 дн. Загрузите новый: меню → Документы.');
    expect(msgText({ k: 'drv.docExpired', p: { slot: 'taxi_licence' } }, 'en')?.body).toContain('Taxi licence has expired');
    expect(msgText({ k: 'staff.docUrgent', p: { who: 'Andreas · ABC-123', slot: 'insurance', date: '01.12' } }, 'ru')?.body).toBe('Andreas · ABC-123 работает с непроверенным документом (страховка) — старый истёк 01.12');
    expect(msgText({ k: 'chat.fromDriver', p: { text: 'Я на месте {x}' } }, 'el')).toEqual({ title: 'Μήνυμα από τον οδηγό', body: 'Я на месте {x}' });
  });
});
