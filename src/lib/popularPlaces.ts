import { foldText } from './nearHint';

// Popular places of Cyprus (2026-11-18): typing a town («пафос», «Πάφος», «paphos») or a kind
// («аэропорт», «марина») suggests these first — the nearest to the passenger first, then further
// ones — so «пафос» offers Paphos airport at once. `at` = checked coordinates (same as the demo
// fixtures); places without `at` are looked up once on the server (Google, only when it returns
// that exact place, never a town centre) and cached.
export interface PopularPlace {
  name: string; // shown, English like the road signs
  city: 'Limassol' | 'Paphos' | 'Larnaca' | 'Nicosia' | 'Ayia Napa' | 'Protaras' | 'Troodos';
  rank: number; // 1 = most asked for within its town
  words: string; // search words in ru / el / en (besides the town names)
  query?: string; // what to look up when `at` is missing
  at?: { lat: number; lng: number };
}

const TOWN_WORDS: Record<PopularPlace['city'], string> = {
  Limassol: 'limassol lemesos лимассол лимасол λεμεσός',
  Paphos: 'paphos pafos пафос πάφος',
  Larnaca: 'larnaca larnaka ларнака λάρνακα',
  Nicosia: 'nicosia lefkosia никосия λευκωσία',
  'Ayia Napa': 'ayia napa agia айя напа αγία νάπα',
  Protaras: 'protaras протарас πρωταράς',
  Troodos: 'troodos троодос τρόοδος',
};
// Rough town centres — only to order suggestions «near first».
export const TOWN_AT: Record<PopularPlace['city'], { lat: number; lng: number }> = {
  Limassol: { lat: 34.68, lng: 33.04 }, Paphos: { lat: 34.77, lng: 32.42 }, Larnaca: { lat: 34.92, lng: 33.63 },
  Nicosia: { lat: 35.17, lng: 33.36 }, 'Ayia Napa': { lat: 34.99, lng: 34.0 }, Protaras: { lat: 35.01, lng: 34.06 }, Troodos: { lat: 34.92, lng: 32.88 },
};

const AIRPORT = 'airport аэропорт аэропорта аеропорт αεροδρόμιο αεροδρομιο';
export const POPULAR: PopularPlace[] = [
  { name: 'Paphos Airport (PFO)', city: 'Paphos', rank: 1, words: `${AIRPORT} pfo`, at: { lat: 34.7180, lng: 32.4857 } },
  { name: 'Larnaca Airport (LCA)', city: 'Larnaca', rank: 1, words: `${AIRPORT} lca`, at: { lat: 34.8751, lng: 33.6249 } },
  { name: 'Paphos Harbour', city: 'Paphos', rank: 2, words: 'harbour port порт гавань λιμάνι kato като', at: { lat: 34.7536, lng: 32.4076 } },
  { name: 'Limassol Marina', city: 'Limassol', rank: 1, words: 'marina марина μαρίνα', at: { lat: 34.6706, lng: 33.0413 } },
  { name: 'Limassol Old Port', city: 'Limassol', rank: 2, words: 'old port старый порт παλιό λιμάνι', at: { lat: 34.6512, lng: 33.0447 } },
  { name: 'Limassol Castle', city: 'Limassol', rank: 3, words: 'castle замок κάστρο', at: { lat: 34.6722, lng: 33.0426 } },
  { name: 'Larnaca Finikoudes', city: 'Larnaca', rank: 2, words: 'finikoudes финикудес φοινικούδες promenade набережная beach пляж', at: { lat: 34.9128, lng: 33.6377 } },
  { name: 'Nicosia city centre', city: 'Nicosia', rank: 1, words: 'centre center центр κέντρο', at: { lat: 35.1748, lng: 33.3644 } },
  { name: 'Ayia Napa Harbour', city: 'Ayia Napa', rank: 1, words: 'harbour port порт гавань λιμάνι', at: { lat: 34.9884, lng: 34.0006 } },
  { name: 'Protaras beach', city: 'Protaras', rank: 1, words: 'beach пляж παραλία', at: { lat: 35.0125, lng: 34.0583 } },
  { name: 'Troodos Square', city: 'Troodos', rank: 1, words: 'square площадь πλατεία', at: { lat: 34.9223, lng: 32.8792 } },
  { name: 'Kourion', city: 'Limassol', rank: 6, words: 'kourion курион κούριον archaeological', at: { lat: 34.6644, lng: 32.8880 } },
  { name: 'Nissi Beach', city: 'Ayia Napa', rank: 2, words: 'nissi нисси νησί beach пляж παραλία', query: 'Nissi Beach, Ayia Napa' },
  { name: 'Fig Tree Bay', city: 'Protaras', rank: 2, words: 'fig tree bay фиг три бэй beach пляж παραλία', query: 'Fig Tree Bay, Protaras' },
  { name: 'My Mall Limassol', city: 'Limassol', rank: 4, words: 'my mall май молл мол торговый центр εμπορικό', query: 'My Mall, Limassol' },
  { name: 'Kings Avenue Mall', city: 'Paphos', rank: 3, words: 'kings avenue mall кингс авеню молл мол торговый центр εμπορικό', query: 'Kings Avenue Mall, Paphos' },
  { name: 'Mall of Cyprus', city: 'Nicosia', rank: 2, words: 'mall of cyprus молл мол торговый центр εμπορικό', query: 'Mall of Cyprus, Nicosia' },
  { name: 'Metropolis Mall', city: 'Larnaca', rank: 3, words: 'metropolis mall метрополис молл мол торговый центр εμπορικό', query: 'Metropolis Mall, Larnaca' },
  { name: 'Limassol General Hospital', city: 'Limassol', rank: 5, words: 'hospital больница госпиталь νοσοκομείο', query: 'Limassol General Hospital' },
  { name: 'Paphos General Hospital', city: 'Paphos', rank: 4, words: 'hospital больница госпиталь νοσοκομείο', query: 'Paphos General Hospital' },
  { name: 'Larnaca General Hospital', city: 'Larnaca', rank: 4, words: 'hospital больница госпиталь νοσοκομείο', query: 'Larnaca General Hospital' },
  { name: 'Nicosia General Hospital', city: 'Nicosia', rank: 3, words: 'hospital больница госпиталь νοσοκομείο', query: 'Nicosia General Hospital' },
];

const index = POPULAR.map((p) => ({ p, words: foldText(`${p.name} ${p.words} ${TOWN_WORDS[p.city]}`).split(' ') }));

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

/** Popular places matching every typed word (by word start), nearest town first, then importance. */
export function matchPopular(query: string, near?: { lat: number; lng: number } | null, max = 3): PopularPlace[] {
  const typed = foldText(query).split(' ').filter((w) => w.length >= 2);
  if (!typed.length) return [];
  const hits = index.filter(({ words }) => typed.every((w) => words.some((x) => x.startsWith(w)))).map(({ p }) => p);
  const dist = (p: PopularPlace) => (near ? km(near, p.at ?? TOWN_AT[p.city]) : 0);
  return hits.sort((a, b) => (near ? Math.round(dist(a) / 15) - Math.round(dist(b) / 15) : 0) || a.rank - b.rank).slice(0, max);
}
