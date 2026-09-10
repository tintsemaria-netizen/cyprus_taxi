// Conspicuous banner making it unmistakable this is a test service (SPEC §15).
export function DemoBanner() {
  return (
    <div className="w-full bg-accent/15 border-b border-accent/30 text-center text-[11px] sm:text-xs text-accent py-1.5 px-3">
      BETA · TEST SERVICE — synthetic demo data, not an operating taxi business. Do not enter real personal data.
    </div>
  );
}
