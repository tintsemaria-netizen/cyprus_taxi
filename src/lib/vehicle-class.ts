// Which orders a car takes (2026-11-25, operator): a Comfort car — Comfort; an XL car — XL and also Comfort,
// unless its driver switched Comfort off in his settings («Брать заказы Comfort»). The passenger pays the class
// he ordered. One rule for automatic offers, the free board, pre-bookings, the stand queue and admin counts.
export type VClass = 'COMFORT' | 'XL';

export function takesClasses(car: string, takesComfort = true): VClass[] {
  return car === 'XL' ? (takesComfort ? ['XL', 'COMFORT'] : ['XL']) : ['COMFORT'];
}

export function carTakes(car: string, takesComfort: boolean | undefined, order: string): boolean {
  return takesClasses(car, takesComfort ?? true).includes(order as VClass);
}
