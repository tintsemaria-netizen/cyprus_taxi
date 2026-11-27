// IBAN check (2026-11-27, driver payout details): ISO 13616 mod-97. Spaces and case are ignored; the
// stored form is upper-case without spaces. Cyprus IBANs are 28 characters (CY + 2 + 24).
export function normalizeIban(raw: string): string {
  return (raw || '').replace(/\s+/g, '').toUpperCase();
}

export function isValidIban(raw: string): boolean {
  const s = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  if (s.startsWith('CY') && s.length !== 28) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** «CY17 0020 0128 …» — groups of four for showing. */
export function formatIban(raw: string): string {
  return normalizeIban(raw).replace(/(.{4})(?=.)/g, '$1 ');
}
