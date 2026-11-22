'use client';

// Small red «cloud» over everything (2026-11-23, operator): a note that floats on top of the screen next to the
// button that was pressed, with a little tail pointing at it. It does not move the layout and fades out by itself.
export function RedBubble({ text, align = 'start', testid }: { text: string; align?: 'start' | 'end'; testid?: string }) {
  return (
    <span role="alert" data-testid={testid}
      className={`pointer-events-none absolute top-full z-[80] mt-2.5 block w-[min(78vw,300px)] animate-[ily-bubble-in_.18s_ease-out] rounded-[14px] bg-[#D93636] px-3.5 py-2.5 text-[13px] font-semibold leading-snug text-white shadow-[0_8px_24px_rgba(0,0,0,.45)] ${align === 'end' ? 'end-0' : 'start-0'}`}>
      <span aria-hidden className={`absolute -top-1.5 h-3 w-3 rotate-45 bg-[#D93636] ${align === 'end' ? 'end-6' : 'start-6'}`} />
      {text}
    </span>
  );
}
