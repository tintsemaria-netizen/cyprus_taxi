import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, Locale, resolveLocale } from './config';

export async function getRequestLocale(): Promise<Locale> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return resolveLocale(jar.get(LOCALE_COOKIE)?.value, h.get('accept-language'));
}
