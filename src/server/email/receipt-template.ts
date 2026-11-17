// Receipt e-mail body (2026-11-17): the same content as the receipt in «My rides», in the
// passenger's language. Plain table layout with inline styles so it renders in mail clients.
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
  const pay = f.paymentMethod === 'CASH_TO_DRIVER' ? tr(locale, 'common.payment.CASH_TO_DRIVER') : f.paymentMethod;
  const note = f.isUpfront ? tr(locale, 'rides.receipt.noteUpfront') : tr(locale, 'rides.receipt.noteMeter');

  const rows: [string, string][] = [
    ...f.lines.map((l) => [l.label, money(l.cents)] as [string, string]),
    ...(f.waitingCents > 0 ? [[tr(locale, 'rides.receipt.waiting'), money(f.waitingCents)] as [string, string]] : []),
  ];
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
${r.driver ? `<tr><td style="${td}${muted}vertical-align:top;">${esc(tr(locale, 'rides.receipt.driver'))}</td><td style="${td}">${esc(r.driver.name)}<br><span style="${muted}font-size:13px;">${esc(r.driver.vehicle)} · ${esc(r.driver.plate)}</span></td></tr>` : ''}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid #e3e7e8;">
${rows.map(([k, v]) => `<tr><td style="${td}${muted}">${esc(k)}</td><td style="${tdEnd}">${esc(v)}</td></tr>`).join('')}
<tr><td style="${td}font-weight:700;font-size:16px;border-top:1px solid #e3e7e8;padding-top:10px;">${esc(totalLabel)}</td><td style="${tdEnd}font-weight:800;font-size:20px;border-top:1px solid #e3e7e8;padding-top:10px;">${esc(total)}</td></tr>
</table>
<div style="margin-top:8px;font-size:12px;${muted}">${esc(note)}</div>
<div style="margin-top:6px;font-size:13px;color:#1d2427;">${esc(tr(locale, 'track.paymentLine', { method: pay }))}</div>
<div style="margin-top:22px;text-align:center;"><a href="${esc(link)}" style="display:inline-block;background:#C8FF46;color:#10191C;font-weight:700;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:12px;">${esc(tr(locale, 'rides.email.open'))}</a></div>
</td></tr>
<tr><td style="padding:14px 24px 22px;font-size:11px;line-height:1.5;${muted}text-align:${align};border-top:1px solid #eef1f2;">${esc(tr(locale, 'rides.email.footer'))}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    tr(locale, 'rides.email.heading'),
    tr(locale, 'rides.email.intro', { date: when }),
    `${tr(locale, 'track.tripRef', { ref: r.reference })} · ${meta}`,
    '',
    ...routeRows.map(([k, v]) => `${k}: ${v}`),
    ...(r.driver ? [`${tr(locale, 'rides.receipt.driver')}: ${r.driver.name} (${r.driver.vehicle} · ${r.driver.plate})`] : []),
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    `${totalLabel}: ${total}`,
    note,
    tr(locale, 'track.paymentLine', { method: pay }),
    '',
    `${tr(locale, 'rides.email.open')}: ${link}`,
    '',
    tr(locale, 'rides.email.footer'),
  ].join('\n');
  return { subject, html, text };
}
