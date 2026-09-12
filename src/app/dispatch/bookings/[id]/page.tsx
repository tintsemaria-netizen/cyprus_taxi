'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { StaffShell } from '@/components/staff/StaffShell';
import { StatusBadge } from '@/components/staff/StatusBadge';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { api, ApiRequestError } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

interface Detail {
  id: string;
  reference: string;
  status: string;
  revision: number;
  pickup: { lat: number; lng: number; label: string };
  dropoff: { lat: number; lng: number; label: string };
  passengerName: string;
  phone: string;
  note: string | null;
  vClass: string;
  passengerCount: number;
  scheduledAt: string | null;
  createdAt: string;
  allowedNext: string[];
  activeAssignment: null | { driverName: string; plate: string; make: string; model: string; color: string };
  timeline: { type: string; at: string; before: string | null; after: string | null; actorType: string; reason: string | null }[];
}
interface AvailDriver { driverId: string; name: string; vehicle: null | { vehicleId: string; plate: string; vClass: string; seats: number; label: string }; gpsFreshness: string; }

export default function Page() {
  return <StaffShell roles={['ADMIN', 'DISPATCHER']}>{() => <BookingDetail />}</StaffShell>;
}

function BookingDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [d, setD] = useState<Detail | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setD(await api<Detail>(`/dispatch/bookings/${id}`));
    } catch (e) {
      if (e instanceof ApiRequestError) setBanner(e.body.message);
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function doStatus(to: string, reason?: string) {
    if (!d) return;
    setBusy(true);
    setBanner(null);
    try {
      await api(`/dispatch/bookings/${id}/status`, { method: 'POST', body: { to, expectedRevision: d.revision, reason } });
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError) setBanner(e.body.message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function doUnassign() {
    if (!d) return;
    const reason = prompt('Reason for unassigning?') || undefined;
    setBusy(true);
    try {
      await api(`/dispatch/bookings/${id}/unassign`, { method: 'POST', body: { expectedRevision: d.revision, reason } });
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError) setBanner(e.body.message);
    } finally {
      setBusy(false);
    }
  }

  async function doTerminate() {
    if (!d) return;
    const reason = prompt('Reason to terminate this in-progress trip (required):');
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await api(`/dispatch/bookings/${id}/terminate`, { method: 'POST', body: { expectedRevision: d.revision, reason } });
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError) setBanner(e.body.message);
    } finally {
      setBusy(false);
    }
  }

  if (!d) return <div className="p-8 text-muted">Loading booking…</div>;

  const markers: MapMarker[] = [
    { id: 'p', lat: d.pickup.lat, lng: d.pickup.lng, kind: 'pickup', label: d.pickup.label },
    { id: 'dd', lat: d.dropoff.lat, lng: d.dropoff.lng, kind: 'dropoff', label: d.dropoff.label },
  ];

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <a href="/dispatch" className="text-sm text-muted hover:text-ink">‹ Back to queue</a>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl text-accent">{d.reference}</h1>
        <StatusBadge status={d.status} />
        <span className="text-xs text-muted">rev {d.revision}</span>
      </div>

      {banner && <p className="mt-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{banner}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="card overflow-hidden">
          <AutoMapView markers={markers} className="h-64 w-full" interactive={false} />
          <div className="space-y-3 p-4">
            <Field label="Pickup" value={d.pickup.label} dot="accent" />
            <Field label="Destination" value={d.dropoff.label} dot="ink" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Class" value={`${d.vClass} · ${d.passengerCount}p`} />
              <Field label="When" value={d.scheduledAt ? new Date(d.scheduledAt).toLocaleString('en-GB') : 'Immediate'} />
              <Field label="Passenger" value={d.passengerName} />
              <Field label="Phone" value={d.phone} />
            </div>
            {d.note && <Field label="Note" value={d.note} />}
            <p className="text-xs text-muted">Times in Europe/Nicosia. Fare confirmed by dispatcher.</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Assignment */}
          <div className="card p-4">
            <h2 className="label mb-2">Assignment</h2>
            {d.activeAssignment ? (
              <div>
                <div className="font-semibold">{d.activeAssignment.driverName}</div>
                <div className="text-xs text-muted">{d.activeAssignment.color} {d.activeAssignment.make} {d.activeAssignment.model} · <span className="font-mono">{d.activeAssignment.plate}</span></div>
                <div className="mt-3 flex gap-2">
                  <button className="btn-ghost !min-h-0 flex-1 !py-2 text-sm" onClick={() => setShowAssign(true)} disabled={busy}>Reassign</button>
                  <button className="btn-ghost !min-h-0 flex-1 !py-2 text-sm" onClick={doUnassign} disabled={busy}>Unassign</button>
                </div>
              </div>
            ) : d.status === 'REQUESTED' ? (
              <button className="btn-primary w-full" onClick={() => setShowAssign(true)} disabled={busy}>Assign a driver</button>
            ) : (
              <p className="text-sm text-muted">No active assignment.</p>
            )}
          </div>

          {/* Status actions */}
          <div className="card p-4">
            <h2 className="label mb-2">Actions</h2>
            <div className="flex flex-wrap gap-2">
              {d.allowedNext.filter((s) => s !== 'ASSIGNED').map((s) => (
                <button
                  key={s}
                  className={`btn-ghost !min-h-0 !py-2 text-sm ${s === 'CANCELED' ? '!border-danger/40 !text-danger' : ''}`}
                  onClick={() => (s === 'CANCELED' ? confirm('Cancel this booking?') && doStatus(s, 'dispatcher canceled') : doStatus(s))}
                  disabled={busy}
                >
                  {actionLabel(s)}
                </button>
              ))}
              {d.status === 'IN_PROGRESS' && (
                <button className="btn-ghost !min-h-0 !py-2 text-sm !border-danger/40 !text-danger" onClick={doTerminate} disabled={busy}>Terminate trip</button>
              )}
              {d.allowedNext.filter((s) => s !== 'ASSIGNED').length === 0 && d.status !== 'IN_PROGRESS' && (
                <p className="text-sm text-muted">No further actions.</p>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="card p-4">
            <h2 className="label mb-2">History</h2>
            <ul className="space-y-2 text-xs">
              {d.timeline.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-accent">•</span>
                  <span className="text-muted">
                    <span className="text-ink">{t.type.replace(/_/g, ' ').toLowerCase()}</span> · {t.actorType.toLowerCase()} · {new Date(t.at).toLocaleTimeString('en-GB')}
                    {t.reason ? ` · ${t.reason}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {showAssign && <AssignDialog bookingId={id} revision={d.revision} isReassign={!!d.activeAssignment} onClose={() => setShowAssign(false)} onDone={() => { setShowAssign(false); load(); }} />}
    </div>
  );
}

function AssignDialog({ bookingId, revision, isReassign, onClose, onDone }: { bookingId: string; revision: number; isReassign: boolean; onClose: () => void; onDone: () => void }) {
  const [drivers, setDrivers] = useState<AvailDriver[] | null>(null);
  const [sel, setSel] = useState<AvailDriver | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ drivers: AvailDriver[] }>('/dispatch/drivers-available').then((r) => setDrivers(r.drivers)).catch(() => setDrivers([]));
  }, []);

  async function submit(ack: boolean) {
    if (!sel || !sel.vehicle) return;
    setBusy(true);
    setErr(null);
    try {
      const path = isReassign ? `/dispatch/bookings/${bookingId}/reassign` : `/dispatch/bookings/${bookingId}/assign`;
      const body: Record<string, unknown> = { driverId: sel.driverId, vehicleId: sel.vehicle.vehicleId, expectedRevision: revision, acknowledgeNoGps: ack };
      if (isReassign) body.reason = reason || 'reassigned by dispatcher';
      await api(path, { method: 'POST', body });
      onDone();
    } catch (e) {
      if (e instanceof ApiRequestError) {
        if (e.body.code === 'GPS_WARNING') {
          if (confirm('This driver has no fresh GPS. Assign anyway?')) return submit(true);
        }
        setErr(e.body.message);
      } else setErr('Failed to assign.');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{isReassign ? 'Reassign driver' : 'Assign a driver'}</h3>
          <button className="text-muted hover:text-ink" onClick={onClose}>✕</button>
        </div>
        {err && <p className="mt-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
          {drivers === null && <p className="text-sm text-muted">Loading available drivers…</p>}
          {drivers?.length === 0 && <p className="text-sm text-muted">No available on-duty drivers bound to a suitable vehicle.</p>}
          {drivers?.map((dr) => (
            <button
              key={dr.driverId}
              disabled={!dr.vehicle}
              onClick={() => setSel(dr)}
              className={`flex w-full items-center justify-between rounded-[12px] border px-3 py-2.5 text-left disabled:opacity-40 ${sel?.driverId === dr.driverId ? 'border-accent bg-accent/10' : 'border-edge bg-elevated'}`}
            >
              <span>
                <span className="block text-sm font-medium">{dr.name}</span>
                <span className="text-xs text-muted">{dr.vehicle ? `${dr.vehicle.label} · ${dr.vehicle.plate} · ${dr.vehicle.vClass} · ${dr.vehicle.seats}p` : 'no bound vehicle'}</span>
              </span>
              <span className={`text-[10px] ${dr.gpsFreshness === 'fresh' ? 'text-accent' : 'text-warn'}`}>GPS {dr.gpsFreshness}</span>
            </button>
          ))}
        </div>
        {isReassign && (
          <input className="field mt-3 text-sm" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        )}
        <button className="btn-primary mt-4 w-full" disabled={!sel || !sel.vehicle || busy || (isReassign && reason.trim().length < 3)} onClick={() => submit(false)}>
          {busy ? 'Assigning…' : isReassign ? 'Reassign' : 'Assign'}
        </button>
      </div>
    </div>
  );
}

function actionLabel(s: string): string {
  return { EN_ROUTE: 'Mark en route', ARRIVED: 'Mark arrived', IN_PROGRESS: 'Start trip', COMPLETED: 'Complete trip', CANCELED: 'Cancel' }[s] ?? s;
}

function Field({ label, value, dot }: { label: string; value: string; dot?: 'accent' | 'ink' }) {
  return (
    <div>
      <div className="label flex items-center gap-2">{dot && <span className={`inline-block h-2 w-2 rounded-full ${dot === 'accent' ? 'bg-accent' : 'bg-ink'}`} />}{label}</div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}
