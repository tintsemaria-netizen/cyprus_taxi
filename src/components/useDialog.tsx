'use client';

import { useCallback, useRef, useState } from 'react';
import { ConfirmSheet, SheetInput } from './ConfirmSheet';

// Promise-based in-app dialog — a drop-in for confirm()/prompt() in staff consoles:
//   const [dialog, ask] = useDialog();
//   if (!(await ask({ title, confirmLabel }))) return;               // confirm → true | null
//   const reason = await ask({ title, confirmLabel, input: { label, required: true } }); // prompt → string | null
// Render {dialog} once in the component.
export interface AskOptions { title: string; body?: React.ReactNode; confirmLabel: string; cancelLabel?: string; danger?: boolean; input?: SheetInput }

export function useDialog(): [React.ReactNode, <O extends AskOptions>(o: O) => Promise<(O['input'] extends SheetInput ? string : true) | null>] {
  const [opts, setOpts] = useState<AskOptions | null>(null);
  const resolver = useRef<((v: unknown) => void) | null>(null);

  const close = useCallback((v: unknown) => { resolver.current?.(v); resolver.current = null; setOpts(null); }, []);
  const ask = useCallback(<O extends AskOptions>(o: O) => new Promise<(O['input'] extends SheetInput ? string : true) | null>((resolve) => {
    resolver.current?.(null); // a newer dialog supersedes an unanswered one
    resolver.current = resolve as (v: unknown) => void;
    setOpts(o);
  }), []);

  const node = opts ? (
    <ConfirmSheet
      key={opts.title}
      title={opts.title} body={opts.body} confirmLabel={opts.confirmLabel} cancelLabel={opts.cancelLabel ?? 'Cancel'} danger={opts.danger}
      input={opts.input}
      onConfirm={(v) => close(opts.input ? (v ?? '') : true)}
      onCancel={() => close(null)}
    />
  ) : null;
  return [node, ask];
}
