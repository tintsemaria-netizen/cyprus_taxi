import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { searchOsm, nearestPostcode } from '@/server/osm/search';
import { resetActiveBatchCache } from '@/server/osm/importer';
import { placeFold } from '@/lib/placeFold';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);

const row = (id: string, kind: string, name: string, lat: number, lng: number, importance: number, postcode: string | null, extra = '') => ({
  id, kind, name, lat, lng, importance, postcode, postcodeExact: !!postcode, locality: 'Limassol',
  search: ` ${placeFold(`${name} ${extra}`)} ${postcode ?? ''} `, nameFold: ` ${placeFold(name)} `,
});

describe('own address base — search', () => {
  it('finds by the first letters in any script, ranks the name match first, gives postcodes', async () => {
    const run = await prisma.osmImport.create({ data: { status: 'DONE', finishedAt: new Date(), rows: 4 } });
    await prisma.osmPlace.createMany({ data: [
      row('n1', 'airport', 'Paphos International Airport', 34.7180, 32.4857, 99, '8507', 'airport аэропорт'),
      row('n2', 'hotel', 'Amara', 34.7042, 33.1360, 60, '4532', 'hotel отель'),
      row('s3', 'street', 'Agias Fylaxeos', 34.6880, 33.0400, 34, '3025', 'Αγίας Φυλάξεως'),
      row('n4', 'school', 'Lykeio Agias Fylaxeos', 34.6900, 33.0300, 46, null),
    ].map((r) => ({ batch: run.id, ...r })) });
    resetActiveBatchCache();
    expect((await searchOsm('пафос аэро', null))?.[0].label).toBe('Paphos International Airport');
    expect((await searchOsm('ama', null))?.[0].label).toBe('Amara');
    const st = await searchOsm('Αγίας Φυλ', { lat: 34.69, lng: 33.04 });
    expect(st?.[0]).toMatchObject({ label: 'Agias Fylaxeos', postcode: '3025' });
    expect(await nearestPostcode(34.6881, 33.0401)).toBe('3025');
    await prisma.osmPlace.deleteMany({ where: { batch: run.id } });
    await prisma.osmImport.delete({ where: { id: run.id } });
    resetActiveBatchCache();
  });
});
