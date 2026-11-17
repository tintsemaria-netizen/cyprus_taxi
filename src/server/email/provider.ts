// Transactional e-mail provider (2026-11-17). Resend HTTP API — no SDK, just fetch.
// Configure RESEND_API_KEY and EMAIL_FROM (e.g. "IL-Y <receipts@il-y.taxi>") on the server;
// the sending domain must be verified in Resend (SPF/DKIM DNS records). Without the key nothing
// is sent and queued receipts simply wait.

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-side dedupe so a retried send never produces a second e-mail. */
  idempotencyKey?: string;
}

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; retry: boolean; error: string };

export function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(m: OutgoingEmail): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, retry: true, error: 'NOT_CONFIGURED' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(m.idempotencyKey ? { 'Idempotency-Key': m.idempotencyKey } : {}),
      },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: j.id ?? null };
    }
    const body = (await res.text().catch(() => '')).slice(0, 200);
    // 4xx (bad address, unverified domain) will not fix itself — except rate limiting.
    const retry = res.status === 429 || res.status >= 500;
    return { ok: false, retry, error: `HTTP ${res.status} ${body}` };
  } catch (e) {
    return { ok: false, retry: true, error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}
