'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useDialog } from '@/components/useDialog';

export const dynamic = 'force-dynamic';

interface Doc { id: string; slot: string; decision: string; decisionNote: string | null; mime: string; scanStatus: string; sizeBytes: number }
interface Detail {
  id: string; status: string; revision: number; submittedAt: string | null; decisionReason: string | null; phone: string;
  identity: Record<string, string>; driving: Record<string, string>; vehicle: Record<string, string>;
  documents: Doc[]; events: { type: string; actorType: string; visibility: string; detail: string | null; at: string }[];
}

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <Detail />}</StaffShell>;
}

function Detail() {
  const id = useParams<{ id: string }>().id;
  const [d, setD] = useState<Detail | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, ask] = useDialog();
  const load = useCallback(async () => { try { setD(await api<Detail>(`/admin/applications/${id}`)); } catch (e) { if (e instanceof ApiRequestError) setBanner(e.body.message); } }, [id]);
  useEffect(() => { load(); }, [load]);

  async function act(path: string, body?: unknown) {
    setBusy(true); setBanner(null);
    try { await api(`/admin/applications/${id}/${path}`, { method: 'POST', body: body ?? {} }); await load(); }
    catch (e) { if (e instanceof ApiRequestError) setBanner(e.body.message); } finally { setBusy(false); }
  }
  const EXPIRY_SLOTS = ['licence_front', 'licence_back', 'taxi_licence', 'insurance', 'roadworthiness', 'vehicle_reg', 'right_to_work', 'passport', 'id_front'];
  async function decide(docId: string, decision: 'ACCEPTED' | 'CHANGES', slot: string) {
    if (decision === 'CHANGES') {
      const note = await ask({ title: 'Request a new document', confirmLabel: 'Send to applicant', input: { label: 'What needs changing? (shown to the applicant)', multiline: true, required: true, minLength: 3 } });
      if (note === null) return;
      await act(`documents/${docId}/decision`, { decision, note });
      return;
    }
    // Capture an expiry date on accept where the document type has one (drives DOCUMENTS_EXPIRED).
    let expiresAt: string | undefined;
    if (EXPIRY_SLOTS.includes(slot)) {
      const d = await ask({ title: 'Accept document', confirmLabel: 'Accept', input: { label: 'Document expiry date', type: 'date', hint: 'Leave empty if this document has no expiry.' } });
      if (d === null) return; // cancelled → nothing is accepted
      if (d) { const dt = new Date(d); if (!Number.isNaN(dt.getTime())) expiresAt = dt.toISOString(); }
    }
    await act(`documents/${docId}/decision`, { decision, expiresAt });
  }

  if (!d) return <div className="p-8 text-muted">Loading…</div>;
  const kv = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => <div key={k} className="flex justify-between gap-4 text-sm"><span className="text-muted">{k}</span><span className="text-right">{v || '—'}</span></div>);

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      {dialog}
      <a href="/admin/applications" className="text-sm text-muted hover:text-ink">‹ Applications</a>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="text-xl font-bold">{d.identity.legalName || '(unnamed)'}</h1>
        <span className="chip">{d.status.replace(/_/g, ' ')}</span>
        <span className="text-xs text-muted">rev {d.revision} · {d.phone}</span>
      </div>
      {banner && <p className="mt-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{banner}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <section className="card p-4"><h2 className="label mb-2">Identity</h2>{kv(d.identity)}</section>
          <section className="card p-4"><h2 className="label mb-2">Driving</h2>{kv(d.driving)}</section>
          <section className="card p-4"><h2 className="label mb-2">Vehicle</h2>{kv(d.vehicle)}</section>
          <section className="card p-4">
            <h2 className="label mb-2">Documents & photos</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {d.documents.map((doc) => (
                <div key={doc.id} className="rounded-[12px] border border-edge p-2">
                  <div className="text-xs font-medium">{doc.slot}</div>
                  {doc.mime.startsWith('image/') ? (
                    <a href={`/api/v1/admin/applications/${id}/documents/${doc.id}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/v1/admin/applications/${id}/documents/${doc.id}`} alt={doc.slot} className="mt-1 h-24 w-full rounded object-cover" />
                    </a>
                  ) : (
                    <a href={`/api/v1/admin/applications/${id}/documents/${doc.id}`} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-accent hover:underline">Open PDF</a>
                  )}
                  <div className="mt-1 text-xs text-muted">scan: {doc.scanStatus}</div>
                  <div className="mt-1 flex gap-1">
                    <button className={`flex-1 rounded px-1 py-1 text-xs ${doc.decision === 'ACCEPTED' ? 'bg-accent text-[#10191C]' : 'bg-elevated'}`} disabled={busy} onClick={() => decide(doc.id, 'ACCEPTED', doc.slot)}>Accept</button>
                    <button className={`flex-1 rounded px-1 py-1 text-xs ${doc.decision === 'CHANGES' ? '!bg-danger/20 text-danger' : 'bg-elevated'}`} disabled={busy} onClick={() => decide(doc.id, 'CHANGES', doc.slot)}>Changes</button>
                  </div>
                  {doc.decisionNote && <p className="mt-1 text-xs text-danger">{doc.decisionNote}</p>}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="label mb-2">Review actions</h2>
            <div className="grid gap-2">
              {d.status === 'SUBMITTED' && <button className="btn-primary" disabled={busy} onClick={() => act('start')}>Start review</button>}
              {['SUBMITTED', 'IN_REVIEW'].includes(d.status) && (
                <>
                  <button className="btn-primary" disabled={busy} onClick={async () => { if (await ask({ title: 'Approve this driver?', body: 'This provisions their driver account and vehicle (off duty). They can then sign in and go online.', confirmLabel: 'Approve driver' })) act('approve', { expectedRevision: d.revision }); }}>Approve driver</button>
                  <button className="btn-ghost !text-warn" disabled={busy} onClick={async () => { const r = await ask({ title: 'Request changes', confirmLabel: 'Send to applicant', input: { label: 'Changes required (shown to the applicant)', multiline: true, required: true, minLength: 3 } }); if (r !== null) act('request-changes', { reason: r, expectedRevision: d.revision }); }}>Request changes</button>
                  <button className="btn-ghost !text-danger" disabled={busy} onClick={async () => { const r = await ask({ title: 'Reject application', confirmLabel: 'Reject', danger: true, input: { label: 'Rejection reason (shown to the applicant)', multiline: true, required: true, minLength: 3 } }); if (r !== null) act('reject', { reason: r, expectedRevision: d.revision }); }}>Reject</button>
                </>
              )}
              {d.status === 'APPROVED' && <p className="text-sm text-accent">Approved — driver provisioned (off-duty).</p>}
              {d.status === 'REJECTED' && <p className="text-sm text-danger">Rejected: {d.decisionReason}</p>}
              {d.status === 'CHANGES_REQUESTED' && <p className="text-sm text-warn">Awaiting applicant changes.</p>}
            </div>
            <p className="mt-2 text-xs text-muted">Approval requires every required document Accepted. Concurrency-guarded by revision.</p>
          </section>
          <section className="card p-4">
            <h2 className="label mb-2">History</h2>
            <ul className="space-y-1 text-xs text-muted">
              {d.events.map((e, i) => <li key={i}>· {e.type}{e.visibility === 'INTERNAL' ? ' (internal)' : ''} — {new Date(e.at).toLocaleString('en-GB')}{e.detail ? ` · ${e.detail}` : ''}</li>)}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
