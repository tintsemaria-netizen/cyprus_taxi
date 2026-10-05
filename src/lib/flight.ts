// Flight numbers are stored normalised ("W64321"); show them the way they are printed on tickets.
export function formatFlight(f: string | null | undefined): string {
  if (!f) return '';
  return /^[A-Z0-9]{2}\d/.test(f) ? `${f.slice(0, 2)} ${f.slice(2)}` : f;
}
