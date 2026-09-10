import { Logo } from '@/components/Brand';

export default function Privacy() {
  return <LegalShell title="Privacy (beta placeholder)">
    <p>This is a <strong>beta test service</strong> using synthetic demo data. It is not an operating taxi business and does not yet publish a finalised privacy policy.</p>
    <p>During the beta the application processes: the pickup/destination coordinates you enter, the name and phone number you provide for a booking, and — for on-duty drivers — foreground GPS while a trip is active. Tracking links are private bearer credentials scoped to a single booking.</p>
    <p>Technical retention defaults for the isolated beta: latest driver GPS is removed within 24 hours after duty ends; synthetic booking/contact data is purged after 30 days; redacted technical audit is kept up to 90 days. No historical GPS route is collected.</p>
    <p>A real privacy policy, lawful-basis statement and contact details must be supplied by the operator before any real-customer launch. Do not enter real personal data into this beta.</p>
  </LegalShell>;
}

function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-[100dvh] max-w-2xl px-5 py-8">
      <a href="/" className="inline-block"><Logo /></a>
      <h1 className="mt-6 text-2xl font-bold">{title}</h1>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-muted">{children}</div>
      <a href="/" className="btn-ghost mt-8 inline-flex">‹ Back to booking</a>
    </div>
  );
}
