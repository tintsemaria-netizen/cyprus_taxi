// Search folding for the own Cyprus address base (2026-11-19). The same function folds the stored
// names and the typed query, so «Πάφος», «Paphos», «Pafos» and «пафос» all meet at «pafos», and
// «Ayia Napa» / «Agia Napa», «Larnaca» / «Larnaka», «Limassol» / «Limasol» match each other.

const GR: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x',
  ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};
const RU: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Lower-case Latin words separated by single spaces. */
export function placeFold(s: string): string {
  let t = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Greek digraphs first (ου → u, αι → e, ει/οι → i, μπ → b, ντ → d, γκ/γγ → g).
  t = t.replace(/ου/g, 'u').replace(/αι/g, 'e').replace(/ει|οι|υι/g, 'i').replace(/^μπ|\sμπ/g, (m) => m.replace('μπ', 'b'))
    .replace(/μπ/g, 'mb').replace(/^ντ|\sντ/g, (m) => m.replace('ντ', 'd')).replace(/ντ/g, 'nd').replace(/γκ|γγ/g, 'g');
  t = t.replace(/[α-ως]/g, (c) => GR[c] ?? c).replace(/[а-яё]/g, (c) => RU[c] ?? c);
  t = t.replace(/[^a-z0-9]+/g, ' ');
  // Latin spelling variants used on Cyprus signs.
  t = t
    .replace(/ph/g, 'f').replace(/th/g, 't').replace(/kh|ch/g, 'h').replace(/ck|c(?=[aou ]|$)/g, 'k').replace(/c/g, 's')
    .replace(/ou/g, 'u').replace(/ai/g, 'e').replace(/ei|oi|ee/g, 'i').replace(/y(?=[aeiou])/g, 'g').replace(/y/g, 'i')
    .replace(/w/g, 'v').replace(/x/g, 'ks').replace(/(.)\1+/g, '$1');
  return t.replace(/\s+/g, ' ').trim();
}

/** Words of a query, folded; empty strings dropped. */
export function queryWords(q: string): string[] {
  return placeFold(q).split(' ').filter(Boolean);
}
