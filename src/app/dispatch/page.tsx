'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { StatusBadge } from '@/components/staff/StatusBadge';
import { api } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

interface QueueRow {
  id: string;
  reference: string;
  status: string;
  vClass: string;
  passengerCount: number;
  pickupLabel: string;
  dropoffLabel: string;
  scheduledAt: string | null;
  createdAt: string;
  assignedDriver: string | null;
  dueSoon: boolean;
}
interface FleetVehicle { driverId: string; name: string; lat: number; lng: number; freshness: string; booking: { reference: string; status: string } | null; }

const STATUSES = ['', 'REQUESTED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'];

export default function DispatchPage() {
  return (
    <StaffShell roles={['ADMIN', 'DISPATCHER']}>
      {() => <Dispatch />}
    </StaffShell>
  );
}

function Dispatch() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'list' | 'map'>('list');
  const [stale, setStale] = useState(false);
  const qref = useRef(q);
  qref.current = q;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (qref.current) params.set('q', qref.current);
      const [queue, fl] = await Promise.all([
        api<{ bookings: QueueRow[] }>(`/dispatch/bookings?${params.toString()}`),
        api<{ vehicles: FleetVehicle[] }>(`/dispatch/fleet`),
      ]);
      setRows(queue.bookings);
      setFleet(fl.vehicles);
      setStale(false);
    } catch {
      setStale(true);
    }
  }, [status]);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const markers: MapMarker[] = fleet.map((f) => ({ id: f.driverId, lat: f.lat, lng: f.lng, kind: 'vehicle', label: f.name, stale: f.freshness !== 'fresh' }));

  return (
    <div className="grid h-[calc(100dvh-49px)] grid-cols-1 lg:grid-cols-[minmax(380px,460px)_1fr]">
      {/* Queue column */}
      <div className={`flex flex-col border-r border-edge ${tab === 'map' ? 'hidden lg:flex' : 'flex'}`}>
        <div className="border-b border-edge p-3">
          <div className="flex items-center justify-between">
            <h1 className="font-semibold">Dispatch queue</h1>
            {stale && <span className="chip !text-warn">Reconnecting…</span>}
            <button className="chip lg:hidden" onClick={() => setTab('map')}>Map ›</button>
          </div>
          <div className="mt-2 flex gap-2">
            <input className="field !min-h-0 !py-2 text-sm" placeholder="Search ref or phone" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
            <select className="field !min-h-0 !w-auto !py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s || 'All'}</option>)}
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 && <p className="p-6 text-center text-sm text-muted">No bookings match.</p>}
          {rows.map((b) => (
            <a key={b.id} href={`/dispatch/bookings/${b.id}`} className="block border-b border-edge/60 p-3 hover:bg-panel">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-accent">{b.reference}</span>
                <StatusBadge status={b.status} />
              </div>
              <div className="mt-1 text-sm">{b.pickupLabel} <span className="text-muted">→</span> {b.dropoffLabel}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="chip">{b.vClass} · {b.passengerCount}p</span>
                {b.scheduledAt ? <span className={`chip ${b.dueSoon ? '!text-warn !border-warn/40' : ''}`}>⏱ {new Date(b.scheduledAt).toLocaleString('en-GB')}{b.dueSoon ? ' · due soon' : ''}</span> : <span className="chip">immediate</span>}
                {b.assignedDriver ? <span className="chip !text-accent">👤 {b.assignedDriver}</span> : b.status === 'REQUESTED' ? <span className="chip !text-warn !border-warn/40">unassigned</span> : null}
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Fleet map */}
      <div className={`relative ${tab === 'list' ? 'hidden lg:block' : 'block'}`}>
        <AutoMapView markers={markers} center={{ lat: 34.92, lng: 33.2 }} zoom={9} interactive className="h-full w-full" />
        <button className="chip absolute left-3 top-3 z-10 lg:hidden" onClick={() => setTab('list')}>‹ List</button>
        <div className="absolute right-3 top-3 z-10 chip !bg-page/90">{fleet.length} on-duty vehicle(s)</div>
      </div>
    </div>
  );
}

