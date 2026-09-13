'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api-client';

interface Msg { id: string; sender: 'PASSENGER' | 'DRIVER'; body: string; at: string }

// Collapsible passenger↔driver chat. Polls the given list endpoint and posts to the
// given endpoint; `me` decides bubble alignment. Works for both roles.
export function ChatPanel({ listUrl, postUrl, me, peerLabel }: { listUrl: string; postUrl: string; me: 'PASSENGER' | 'DRIVER'; peerLabel: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [open, setOpen] = useState(true); // chat available (driver assigned, pre-terminal)
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lastSeenRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await api<{ open: boolean; messages: Msg[] }>(listUrl, { timeoutMs: 8000 });
        if (!alive) return;
        setOpen(r.open);
        setMsgs(r.messages);
      } catch { /* transient */ }
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [listUrl]);

  useEffect(() => {
    if (expanded) {
      lastSeenRef.current = Date.now();
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    }
  }, [expanded, msgs.length]);

  const unread = expanded ? 0 : msgs.filter((m) => m.sender !== me && new Date(m.at).getTime() > lastSeenRef.current).length;

  async function send() {
    const b = text.trim();
    if (!b || sending) return;
    setSending(true);
    setErr(null);
    try {
      const r = await api<{ message: Msg }>(postUrl, { method: 'POST', body: { body: b }, timeoutMs: 8000 });
      setMsgs((m) => [...m.filter((x) => x.id !== r.message.id), r.message]);
      setText('');
    } catch (e) {
      if (e instanceof ApiRequestError) setErr(e.body.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-[12px] border border-edge bg-elevated">
      <button type="button" className="flex w-full items-center justify-between px-3 py-2.5 text-left" onClick={() => setExpanded((e) => !e)}>
        <span className="flex items-center gap-2 text-sm font-medium">
          💬 Chat with {peerLabel}
          {unread > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold text-[#10191C]">{unread > 9 ? '9+' : unread}</span>}
        </span>
        <span className="text-xs text-muted">{expanded ? 'Hide' : 'Open'}</span>
      </button>

      {expanded && (
        <div className="border-t border-edge">
          <div ref={scrollRef} className="max-h-56 space-y-2 overflow-y-auto p-3">
            {msgs.length === 0 && <p className="py-4 text-center text-xs text-muted">No messages yet. Say hello 👋</p>}
            {msgs.map((m) => (
              <div key={m.id} className={`flex ${m.sender === me ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-[12px] px-3 py-1.5 text-sm ${m.sender === me ? 'bg-accent text-[#10191C]' : 'bg-panel text-ink'}`}>
                  {m.body}
                  <span className={`ml-2 align-bottom text-[9px] ${m.sender === me ? 'text-[#10191C]/60' : 'text-muted'}`}>{new Date(m.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            ))}
          </div>
          {err && <p className="px-3 pb-1 text-[11px] text-danger">{err}</p>}
          {open ? (
            <div className="flex items-center gap-2 border-t border-edge p-2">
              <input
                className="field !min-h-0 flex-1 !py-2 text-sm"
                placeholder={`Message your ${peerLabel.toLowerCase()}…`}
                value={text}
                maxLength={1000}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
              />
              <button type="button" className="btn-primary !min-h-0 !py-2 text-sm" disabled={sending || !text.trim()} onClick={() => void send()}>Send</button>
            </div>
          ) : (
            <p className="border-t border-edge px-3 py-2 text-center text-[11px] text-muted">Chat is closed for this ride.</p>
          )}
        </div>
      )}
    </div>
  );
}
