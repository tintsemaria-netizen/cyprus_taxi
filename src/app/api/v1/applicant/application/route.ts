import { apiOk, apiError, Errors } from '@/lib/http';
import { getApplicant } from '@/server/applicant';
import { getOrCreateApplication, saveDraft } from '@/server/applications';

export const dynamic = 'force-dynamic';

function parse(s: string | null) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }

// The applicant's own application (draft data, document slots + decisions, status). Scoped
// to the session — never reveals other applications.
export async function GET() {
  const a = await getApplicant();
  if (!a) return Errors.unauthorized();
  const app = await getOrCreateApplication(a.id);
  if (!app) return Errors.unauthorized();
  return apiOk({
    status: app.status,
    revision: app.revision,
    decisionReason: app.decisionReason,
    identity: parse(app.identity),
    driving: parse(app.driving),
    vehicle: parse(app.vehicle),
    documents: app.documents.map((d) => ({ id: d.id, slot: d.slot, decision: d.decision, decisionNote: d.decisionNote, mime: d.mime })),
    phone: a.phone,
  });
}

export async function PATCH(req: Request) {
  const a = await getApplicant();
  if (!a) return Errors.unauthorized();
  let body: { identity?: unknown; driving?: unknown; vehicle?: unknown };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const r = await saveDraft(a.id, body);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk(r.data);
}
