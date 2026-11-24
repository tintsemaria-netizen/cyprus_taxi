'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import type { MsgKey } from '@/i18n/I18nProvider';
import { useRefreshOnReturn } from '@/components/useRefreshOnReturn';

// Driver documents in «Водители» (driving licence) / «Машины» (taxi licence, insurance, roadworthiness) (2026-11-24, operator): the row blinks red and moves to the
// top while a new document waits for a check, or one expires within 7 days / has expired with nothing
// uploaded. One shared piece for both lists.

export interface DocItem {
  driverId: string; driverName: string; vehicleId: string | null; plate: string | null;
  applicationId: string; slot: string; section: 'drivers' | 'vehicles';
  kind: 'UPLOADED' | 'EXPIRING' | 'EXPIRED';
  docId: string; oldExpiresAt: string | null; oldExpired: boolean; uploadedAt: string | null; daysLeft: number | null;
}

/** Items of one section, by driver id («Водители») or vehicle id («Машины»). Re-checked every 30 s. */
export function useDocAttention(section: 'drivers' | 'vehicles', url = '/admin/doc-attention'): Record<string, DocItem[]> {
  const [by, setBy] = useState<Record<string, DocItem[]>>({});
  const load = useCallback(() => {
    api<{ items: DocItem[] }>(url).then((r) => {
      const m: Record<string, DocItem[]> = {};
      for (const it of r.items) {
        if (it.section !== section) continue;
        const key = section === 'vehicles' ? it.vehicleId! : it.driverId;
        (m[key] ??= []).push(it);
      }
      setBy(m);
    }).catch(() => {});
  }, [section, url]);
  useEffect(() => { load(); const id = window.setInterval(load, 30_000); return () => window.clearInterval(id); }, [load]);
  useRefreshOnReturn(load);
  return by;
}

/** Rows with something to look at first (uploads, then expired, then the soonest), the rest as they were. */
export function withDocsFirst<T>(rows: T[], keyOf: (r: T) => string, by: Record<string, DocItem[]>): T[] {
  const rank = (r: T) => { const it = by[keyOf(r)]?.[0]; return !it ? 9 : it.kind === 'UPLOADED' ? (it.oldExpired ? 0 : 1) : it.kind === 'EXPIRED' ? 2 : 3; };
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

/** `owner`: the fleet owner's view — no «Проверить», the operator checks. */
export function DocAttentionLines({ items, owner }: { items?: DocItem[]; owner?: boolean }) {
  const { t, fmt } = useT();
  if (!items?.length) return null;
  return (
    <div className="w-full space-y-1" data-testid="doc-attention">
      {items.map((it) => (
        <div key={it.docId} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <span className="font-semibold text-danger">{t(`staff.docs.slot.${it.slot}` as MsgKey)}</span>
          <span className="text-ink">
            {it.kind === 'UPLOADED' ? (owner ? t('staff.docs.uploadedOwner') : it.oldExpired ? t('staff.docs.uploadedExpired', { date: fmt.date(it.oldExpiresAt!) }) : t('staff.docs.uploaded'))
              : it.kind === 'EXPIRED' ? t('staff.docs.expired', { date: fmt.date(it.oldExpiresAt!) })
              : t('staff.docs.expiring', { date: fmt.date(it.oldExpiresAt!), days: it.daysLeft ?? '' })}
          </span>
          {it.kind === 'UPLOADED' && !owner && (
            <a href={`/admin/applications/${it.applicationId}#doc-${it.docId}`} className="rounded-full bg-danger px-2.5 py-0.5 font-semibold text-white" data-testid="doc-check">{t('staff.docs.check')} ›</a>
          )}
        </div>
      ))}
    </div>
  );
}
