import { Logo } from '@/components/Brand';

export default function Terms() {
  return (
    <div className="mx-auto min-h-[100dvh] max-w-2xl px-5 py-8">
      <a href="/" className="inline-block"><Logo /></a>
      <h1 className="mt-6 text-2xl font-bold">Service terms (beta placeholder)</h1>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-muted">
        <p>This is a <strong>beta test service</strong> for demonstration only. No real transport is provided and no payment is collected. Bookings use synthetic demo data.</p>
        <p>Scheduled bookings are requests awaiting dispatcher confirmation, not guaranteed reservations. Fares, where shown, are confirmed by the dispatcher. Payment, when the service is real, is made directly to the driver.</p>
        <p>Final service terms, company details and support contacts must be provided by the operator before a real-customer launch.</p>
      </div>
      <a href="/" className="btn-ghost mt-8 inline-flex">‹ Back to booking</a>
    </div>
  );
}
