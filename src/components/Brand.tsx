export function Logo({ className = 'h-7' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <path d="M4 20c6-1 9-4 12-9 1.6-2.7 5.2-3 7 0 1.2 2 0 4.5-2 5.5-4.5 2.2-8 4-11 8-1.2 1.6-4.2 1-6-1-1-1.1-1.4-2.7-1-3.5z" fill="#C8FF52" />
        <circle cx="8.5" cy="22.5" r="2.2" fill="#C8FF52" />
      </svg>
      <span className="text-lg font-extrabold tracking-tight">
        TAXI <span className="text-muted font-semibold">CYPRUS</span>
      </span>
    </span>
  );
}
