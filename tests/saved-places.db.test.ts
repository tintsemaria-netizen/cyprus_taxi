import { describe, it, expect, beforeAll, vi } from 'vitest';

// Saved places from the start screen (2026-11-18): Home/Work + the passenger's own named places.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => new Headers(),
}));

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { createEmailPassenger, createPassengerSession } from '@/server/passenger';
import * as route from '@/app/api/v1/passenger/places/route';

const put = (body: unknown) => route.PUT(new Request('http://x/api/v1/passenger/places', { method: 'PUT', body: JSON.stringify(body) }));
const get = async () => (await (await route.GET()).json()) as { home: unknown; custom: { id: string; name: string; label: string }[] };

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  jar.clear();
  const p = await createEmailPassenger({ email: `sp${Date.now()}@example.com`, passwordHash: 'x', name: 'Ana' });
  await createPassengerSession(p.id);
});

describe('saved places', () => {
  it('home is set and removed', async () => {
    expect((await put({ kind: 'HOME', place: { label: 'Agias Sofias 1', lat: 34.68, lng: 33.04 } })).status).toBe(200);
    expect((await get()).home).toMatchObject({ label: 'Agias Sofias 1' });
    await put({ kind: 'HOME', place: null });
    expect((await get()).home).toBeNull();
  });
  it('own named places: add, rename/move, remove; a name is required', async () => {
    expect((await put({ kind: 'CUSTOM', name: '', place: { label: 'X', lat: 34.7, lng: 33 } })).status).toBe(422);
    const r = await (await put({ kind: 'CUSTOM', name: 'Мама', place: { label: 'Molos 3', lat: 34.67, lng: 33.04 } })).json() as { id: string };
    expect(r.id).toMatch(/^C_/);
    await put({ kind: 'CUSTOM', name: 'Спортзал', place: { label: 'Gym', lat: 34.7, lng: 33.05 } });
    let all = (await get()).custom;
    expect(all.map((c) => c.name)).toEqual(['Мама', 'Спортзал']);
    await put({ kind: r.id, name: 'Мама дом', place: { label: 'Molos 5', lat: 34.671, lng: 33.041 } });
    all = (await get()).custom;
    expect(all[0]).toMatchObject({ id: r.id, name: 'Мама дом', label: 'Molos 5' });
    await put({ kind: r.id, place: null });
    expect((await get()).custom.map((c) => c.name)).toEqual(['Спортзал']);
    expect((await put({ kind: 'C_00000000-0000-0000-0000-000000000000', name: 'Z', place: { label: 'Z', lat: 34, lng: 33 } })).status).toBe(404);
  });
});
