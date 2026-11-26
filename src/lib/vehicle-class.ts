// Which orders a car takes (2026-11-25, operator): a Comfort car — Comfort; an XL car — XL and also Comfort,
// unless its driver switched Comfort off in his settings («Брать заказы Comfort»). The passenger pays the class
// he ordered. One rule for automatic offers, the free board, pre-bookings, the stand queue and admin counts.
export type VClass = 'COMFORT' | 'XL';

// 2026-11-26 (operator): the XL driver has two switches, «Comfort» and «XL»; at least one stays on (the API
// refuses switching off the last one). A Comfort car is not affected by either.
export function takesClasses(car: string, takesComfort = true, takesXl = true): VClass[] {
  if (car !== 'XL') return ['COMFORT'];
  const out: VClass[] = [];
  if (takesXl) out.push('XL');
  if (takesComfort) out.push('COMFORT');
  return out.length ? out : ['XL'];
}

export function carTakes(car: string, takesComfort: boolean | undefined, order: string, takesXl?: boolean): boolean {
  return takesClasses(car, takesComfort ?? true, takesXl ?? true).includes(order as VClass);
}
