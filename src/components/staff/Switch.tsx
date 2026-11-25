'use client';

// Admin on/off switch (operator 2026-11-25): looks like the passenger «Попутчик −30%» switch, a bit smaller, so it is
// obvious whether something is on or off — and every switch asks for a confirmation first (`confirmOn` / `confirmOff`;
// leave both out only for a view filter that changes nothing).
export function Switch({ checked, onChange, label, confirmOn, confirmOff, testid, disabled }: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: React.ReactNode;
  confirmOn?: string;
  confirmOff?: string;
  testid?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-3 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <span className="min-w-0">{label}</span>
      <input type="checkbox" role="switch" aria-checked={checked} checked={checked} disabled={disabled} data-testid={testid} className="peer sr-only"
        onChange={(e) => {
          const on = e.target.checked;
          const ask = on ? confirmOn : confirmOff;
          if (ask && !window.confirm(ask)) return;
          onChange(on);
        }} />
      <span aria-hidden className={`relative h-6 w-10 shrink-0 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${checked ? 'bg-accent' : 'bg-edge-strong'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'start-[18px]' : 'start-0.5'}`} />
      </span>
    </label>
  );
}
