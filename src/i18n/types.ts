// Plural entries are objects with an `other` form plus any CLDR categories the language needs
// (Russian: one/few/many/other; English/Greek: one/other). Selected via Intl.PluralRules.
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export type PluralForms = Partial<Record<PluralCategory, string>> & { other: string };

// Another locale's catalog must mirror the English catalog's shape (missing/misspelled keys fail
// the type-check); plural entries may use a different set of categories.
export type Catalog<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends { other: string } ? PluralForms : Catalog<T[K]>;
};

// "a.b.c" paths to plain strings / to plural entries, for typed t() / tp() keys.
export type Path<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends { other: string } ? never : Path<T[K], `${P}${K}.`>;
}[keyof T & string];
export type PluralPath<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? never : T[K] extends { other: string } ? `${P}${K}` : PluralPath<T[K], `${P}${K}.`>;
}[keyof T & string];
