'use client';

import { useT, MsgKey } from '@/i18n/I18nProvider';

export function StatusBadge({ status }: { status: string }) {
  const { t } = useT();
  const map: Record<string, string> = {
    REQUESTED: 'text-warn border-warn/40',
    ASSIGNED: 'text-accent border-accent/40',
    EN_ROUTE: 'text-accent border-accent/40',
    ARRIVED: 'text-accent border-accent/40',
    IN_PROGRESS: 'text-accent border-accent/40',
    COMPLETED: 'text-muted border-edge',
    CANCELED: 'text-danger border-danger/40',
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${map[status] ?? 'text-muted border-edge'}`}>
      {statusLabel(t, status)}
    </span>
  );
}

// Localized status name; unknown codes fall back to the code itself.
export function statusLabel(t: (k: MsgKey) => string, status: string): string {
  const key = `staff.status.${status}` as MsgKey;
  const v = t(key);
  return v === key ? status.replace(/_/g, ' ') : v;
}
