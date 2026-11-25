import { redirect } from 'next/navigation';

// The share board is gone (operator 2026-11-25): the co-rider is picked in the hour list of the pre-booking.
// Old links (installed apps, earlier pushes) land on «Мои предзаказы».
export default function ShareBoardGone() {
  redirect('/prebookings');
}
