// Destination postcode chip (2026-11-19): the area the ride goes to, at a glance, on every order.
export function Postcode({ code, className = '' }: { code?: string | null; className?: string }) {
  if (!code) return null;
  return (
    <span className={`ms-1.5 inline-block whitespace-nowrap rounded-[6px] border border-edge-strong px-1.5 align-middle text-[12px] font-bold leading-[18px] tabular-nums ${className}`} data-testid="postcode" title={code}>
      {code}
    </span>
  );
}
