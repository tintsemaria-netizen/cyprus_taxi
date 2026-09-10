export function StatusBadge({ status }: { status: string }) {
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
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${map[status] ?? 'text-muted border-edge'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
