// Receipt e-mail body (2026-11-17): short — the trip (date, class, route) and the total only, in the
// passenger's language; the full receipt is one tap away in «My rides». Plain table layout with inline styles so it renders in mail clients.
import type { Locale } from '@/i18n/config';
import { INTL_TAG, RTL_LOCALES } from '@/i18n/config';
import { tr, trPlural } from '@/i18n/translate';
import type { Receipt } from '@/server/receipt';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function receiptEmail(r: Receipt, locale: Locale, link: string): { subject: string; html: string; text: string } {
  const money = (c: number) => new Intl.NumberFormat(INTL_TAG[locale], { style: 'currency', currency: r.fare.currency }).format(c / 100);
  const when = r.completedAt
    ? new Intl.DateTimeFormat(INTL_TAG[locale], { timeZone: 'Europe/Nicosia', dateStyle: 'long', timeStyle: 'short' }).format(new Date(r.completedAt))
    : '';
  const rtl = RTL_LOCALES.includes(locale);
  const align = rtl ? 'right' : 'left';
  const alignEnd = rtl ? 'left' : 'right';
  const f = r.fare;
  const subject = tr(locale, 'rides.email.subject', { ref: r.reference });
  const totalLabel = f.isUpfront ? tr(locale, 'rides.receipt.total') : tr(locale, 'rides.receipt.estimatedTotal');
  const total = f.totalCents != null ? money(f.totalCents) : '—';

  const routeRows: [string, string][] = [
    [tr(locale, 'track.pickup'), r.pickup],
    ...(r.stop ? [[tr(locale, 'booking.places.stop'), r.stop] as [string, string]] : []),
    [tr(locale, 'track.destination'), r.dropoff],
  ];
  const meta = `${r.vClass} · ${trPlural(locale, 'common.passengers', r.passengerCount)}`;

  const td = `padding:6px 0;font-size:14px;color:#1d2427;text-align:${align};`;
  const tdEnd = `padding:6px 0;font-size:14px;color:#1d2427;text-align:${alignEnd};white-space:nowrap;`;
  const muted = 'color:#6b7579;';
  const html = `<!DOCTYPE html><html lang="${locale}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef1f2;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f2;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;" dir="${rtl ? 'rtl' : 'ltr'}">
<tr><td style="background:#10191C;padding:18px 24px;text-align:${align};"><span style="font-size:22px;font-weight:800;color:#C8FF46;letter-spacing:.5px;">IL-Y</span></td></tr>
<tr><td style="padding:24px;text-align:${align};">
<div style="font-size:20px;font-weight:700;color:#10191C;">${esc(tr(locale, 'rides.email.heading'))}</div>
<div style="margin-top:6px;font-size:14px;${muted}">${esc(tr(locale, 'rides.email.intro', { date: when }))}</div>
<div style="margin-top:4px;font-size:13px;${muted}">${esc(tr(locale, 'track.tripRef', { ref: r.reference }))} · ${esc(meta)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid #e3e7e8;">
${routeRows.map(([k, v]) => `<tr><td style="${td}${muted}width:34%;vertical-align:top;">${esc(k)}</td><td style="${td}">${esc(v)}</td></tr>`).join('')}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid #e3e7e8;">
<tr><td style="${td}font-weight:700;font-size:16px;border-top:1px solid #e3e7e8;padding-top:10px;">${esc(totalLabel)}</td><td style="${tdEnd}font-weight:800;font-size:20px;border-top:1px solid #e3e7e8;padding-top:10px;">${esc(total)}</td></tr>
</table>
<div style="margin-top:22px;text-align:center;"><a href="${esc(link)}" style="display:inline-block;background:#C8FF46;color:#10191C;font-weight:700;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:12px;">${esc(tr(locale, 'rides.email.open'))}</a></div>
</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    tr(locale, 'rides.email.heading'),
    tr(locale, 'rides.email.intro', { date: when }),
    `${tr(locale, 'track.tripRef', { ref: r.reference })} · ${meta}`,
    '',
    ...routeRows.map(([k, v]) => `${k}: ${v}`),
    '',
    `${totalLabel}: ${total}`,
    '',
    `${tr(locale, 'rides.email.open')}: ${link}`,
  ].join('\n');
  return { subject, html, text };
}
