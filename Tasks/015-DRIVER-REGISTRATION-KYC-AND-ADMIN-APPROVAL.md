> STATUS (2026-09-14): IMPLEMENTED + deployed (release 21868e1). vitest 75/75. Live-verified: nav "Login" + "Register as a driver"; applicant OTP → DRAFT application; admin API ADMIN-gated (401); all 5 existing drivers grandfathered LEGACY (no lockout). Eligibility gate enforced across duty/fleet/candidate/market/accept/assign. Full flow available: register wizard (identity/driving/vehicle/photos), private uploads (Docker volume, magic-byte validated, authenticated streaming), admin review workspace (queue/detail/doc-viewer/decisions), atomic idempotent approval → provisions driver+vehicle+binding off-duty; approved drivers sign in via phone OTP.
> Owner decisions applied: existing drivers grandfathered LEGACY; full accounts+SMS+wizard built.
> UPDATE (2026-09-14, release 31d5781): completion pass. DONE now — malware-scan GATE (clamd INSTREAM adapter; INFECTED rejected on upload; a document can be ACCEPTED only when scanStatus=CLEAN; approval requires all required docs CLEAN — never approve unscanned); expiry enforcement (admin sets document expiry on accept; a worker sets DOCUMENTS_EXPIRED, takes the driver off duty and invalidates unaccepted offers WITHOUT cancelling an active trip; 30/7/1-day reminders via the notification outbox); concurrency-safe review (request-changes/reject now revision-guarded under a row lock, like approve); reliable draft AUTOSAVE (debounced) in the wizard; expanded applicable/conditional document fields + slots (right-to-work, fleet authorization, roadworthiness, taxi sign, registration country, operating area). vitest 78/78. Tests: malware gate, expiry→DOCUMENTS_EXPIRED, revision guards.
> HARD EXTERNAL BLOCKERS (NOT done — do not mark complete):
>  1. REAL SMS verification requires TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN (only the Verify Service SID is provided). Dev OTP is now REFUSED unless SMS_ALLOW_DEV_OTP is explicitly set, and is labelled "Test verification (SMS not configured)" — never a silent substitute. The beta enables it (labelled) so it stays usable; this is NOT real verification.
>  2. REAL malware scanning requires a reachable clamd (CLAMAV_HOST) — none available in this environment, so scans are UNAVAILABLE and approval is correctly BLOCKED (never approve unscanned). The adapter is implemented and will scan once a scanner is configured.
> Also remaining: legacy-driver review queue to retire LEGACY; optional email verification; browser QA screenshots (no browser here — server flows live-smoked). Cyprus required-document set has VERIFY items pending live RTD confirmation.

# Task 015 — Driver registration, document review and admin-controlled activation

Project: IL-Y / Cyprus Taxi
Repository: https://github.com/tintsemaria-netizen/cyprus_taxi
Date: 2026-09-14
Continue Tasks 013–014. This is a separate implementation task, not an amendment that removes passenger authentication or map-first booking.

## Owner requirements

Rename the visible "Staff" navigation entry to "Login". On the login page offer "Register as a driver". Drivers must register in stages, provide complete identity/vehicle information and supporting documents, and obtain explicit administrator approval before working in the system.

Implement the flow end-to-end, test it and deploy to the already authorized beta target. Inspect latest main, repository instructions, existing skills, authentication, driver/vehicle models, admin tools and HANDOFF first. Preserve passenger SMS authentication, operational drivers and unrelated work. Do not merely create upload forms without enforcement or admin review.

## 1. Entry points and access model

- Replace user-visible "Staff" labels with "Login", including mobile/menu variants. Preserve existing URLs or redirect compatibly; do not break staff bookmarks.
- The login screen clearly offers Passenger login, Driver login / "Register as a driver", and unobtrusive existing staff/admin access. Never expose a public admin-registration option.
- Reuse the verified phone/account infrastructure from Task 014 where available; otherwise implement compatible secure verified-phone registration. Support international phone numbers and actual SMS verification. Keep role privileges separate.
- One person may be both passenger and driver without duplicate phone accounts where the identity model supports it. Adding a driver application must not grant driver operational privileges or erase passenger access.
- An applicant can sign in to save/resume onboarding, upload their own documents and see review status. This is not permission to go on duty or receive orders.
- Never allow client-supplied role, active flag, approval status, reviewer id or driver id to grant access.
- No booking job, public fleet visibility, offers, assignment, operational GPS publication or passenger contact/chat access for an unapproved applicant.
- Driver registration remains optional for passengers; do not redirect passenger sign-in into KYC.

## 2. Staged onboarding with saved progress

Use numbered steps, progress indicator, back/next controls and automatic draft saving to the server. Support phone camera capture and file upload. A refresh or logout/login must resume the draft.

### Step 1 — Account and contact verification
- Verified mobile number, legal name, email/contact preference as appropriate.
- If collecting email as verified contact, implement verification and state it accurately; do not block the main workflow on an unconfigured optional email service.
- Explain required documents before starting, with readable examples of acceptable photo quality.
- Show privacy information describing purpose, who reviews documents and retention. Required service acknowledgements must be separate from optional marketing.

### Step 2 — Personal identity
Required fields: full legal name matching document, date of birth, residential address/country, identity document type, issuing country, number and expiry when applicable. Allow authentic documents with no expiry where legally valid; do not invent one.
- Either ID card (front and back where applicable) OR passport biodata/photo page. Do not require both by default.
- Clear current portrait/selfie for manual comparison with identity document.
- Conditional evidence of residence/right to work in the Republic of Cyprus when applicable to the applicant; do not blanket-require immigration documents from everyone.
- Use reviewable fields and readable images. Do not claim a selfie proves liveness or guarantees identity. Do not build face-recognition/biometric scoring or transmit documents to an external KYC/AI service without a separately authorized integration.
- A mismatch, suspected duplicate or suspected manipulation should require review, not automatic fraud accusations.

### Step 3 — Driving and professional taxi qualifications
- Driving licence: issuing country, document number, category, issue/expiry dates and both sides where applicable; eligibility to drive the proposed vehicle in Cyprus must be checked.
- Cyprus professional taxi driver licence: number, issuing authority, category/scope and expiry, plus document images.
- Professional competence/training evidence (taxi category T) if separately needed to verify the licence.
- Configurable additional evidence only where justified and applicable. Review official requirements; distinguish documents needed to obtain a government licence from documents the platform needs to retain to verify an already licensed driver.
- Do not indiscriminately require criminal-record certificates or detailed medical records merely because they are mentioned in a government licensing application. Record verification of an applicable valid licence or narrowly required clearance; introduce sensitive certificates only with a documented applicable basis and restricted review/retention.
- An upload is not official licence validation. Record the actual verification method: manual document review and any genuine issuer verification performed. Never claim a government database check unless implemented and authorized.

### Step 4 — Vehicle information and operating documents
- Registration plate, registration country, VIN, make, model, year, color, passenger seats excluding driver, proposed service class and operating area.
- Vehicle registration certificate and owner details necessary to match it.
- Ownership or permission to operate: lease/rental/fleet authorization if the applicant is not the registered owner; support fleet-owned vehicles.
- Applicable taxi vehicle/operating permit, with number, issuing authority, area/type restrictions and expiry as applicable.
- Valid insurance covering the intended commercial taxi/passenger service.
- Roadworthiness/MOT and road-tax/circulation evidence where applicable.
- Where relevant, taxi meter/inspection evidence and operating restrictions. Verify applicability before turning an item into a universal requirement.
- Driver professional licence and vehicle taxi authorization are separate checks; do not confuse them.
- Model one initial vehicle in onboarding, then allow approved drivers to request a replacement/additional vehicle through review. Never activate an unreviewed vehicle by editing a plate field.

### Step 5 — Vehicle photos
Require distinct labeled upload slots:
1. Front exterior with readable front plate.
2. Rear exterior with readable rear plate.
3. Left exterior.
4. Right exterior.
5. Front passenger cabin.
6. Rear passenger seating.
7. Boot/luggage area.
8. Taxi sign/meter or other required equipment if applicable.

Photos must be clear, current, daylight/readable and of the same vehicle; advise avoiding bystanders/passenger faces. Keep plate detail capture available if the wide shots are unreadable.
Admin compares plate/VIN/model/color with records and photos. Missing, duplicate or unreadable required views prevent submission until corrected. Do not silently substitute stock/generated vehicle photos.

### Step 6 — Review and submit
- Show completed sections and precise missing/invalid fields.
- Driver confirms information is accurate, documents belong to them/authorized vehicle and declares relevant changes must be reported.
- Submit one immutable application revision/snapshot for review. Keep original documents tied to that revision.
- Display "Under review — you cannot accept rides until approved".
- A submitted revision cannot change underneath an admin. Corrections create a new revision, invalidate affected approval checks and preserve audit history.
- No estimated approval time unless configured by the operator.

## 3. Application and operational states

Application states: DRAFT → SUBMITTED → IN_REVIEW → APPROVED, CHANGES_REQUESTED or REJECTED.
CHANGES_REQUESTED permits editing requested sections and resubmitting a new revision. REJECTED shows an applicant-facing reason and the configured reapplication/contact path; no automatic activation.
Use separate operational eligibility states such as ACTIVE, SUSPENDED and DOCUMENTS_EXPIRED; approval of an old application must not permanently override expiry or suspension.

Persist submittedAt, reviewedAt, reviewer, revision, document decisions and reasons. All transitions must be server validated and audited.
Applicant status polling must be scoped to the applicant. Do not reveal other applications by identifier enumeration.

## 4. Admin review workspace

Add an ADMIN-only "Driver applications" section:
- Queue filters by state/submitted date and a count of pending work.
- Detail page with application revision, personal details, vehicle details and private document/photo viewer.
- Each required document/check: pending, accepted or changes required, with expiry and reviewer notes.
- Distinguish internal notes from messages visible to the applicant.
- Highlight missing/expired documents, name mismatch, plate inconsistency and potential duplicate identity/licence/VIN/plate. Flag fleet/shared-vehicle relationships for review rather than automatically rejecting legitimate ones.
- Actions: "Start review", "Request changes", "Reject", "Approve driver".
- Changes requested must identify exact fields/files and actionable reasons. Rejection requires a reason.
- Approval requires all applicable mandatory checks accepted, clean uploaded files, valid documents, approved vehicle and no unresolved blocking findings.
- Approval confirmation shows the exact applicant and vehicle; use revision/concurrency protection. Two admins must not approve stale/conflicting revisions.
- Operational provisioning occurs atomically and idempotently on approval: create/link driver and approved vehicle/binding, establish correct permissions and remain off-duty until the driver chooses to go online.
- Requesting corrections or rejection never creates an operationally active driver.
- Normal dispatchers cannot approve or download identity documents unless an explicit restricted permission is deliberately granted. Driver must never self-approve.

Notify admin in the admin application queue and applicant via their authenticated status page. Reuse already configured notification channels for transactional submission/decision/expiry notices, with retries and no document contents in messages. Do not send real test messages without an explicitly designated test recipient.

## 5. Eligibility enforcement throughout the system

Centralize the eligibility rule:
approved current identity/driver record + active account + not suspended + required unexpired verified documents + approved current vehicle/binding + normal availability/GPS rules.

Apply to:
- Going on duty / available.
- Fleet exposure.
- Candidate selection and offer creation.
- Offer acceptance with eligibility rechecked inside the transaction.
- Manual admin assignment and reassignment.
- Vehicle changes, API mutation paths and old compatibility routes.

Newly approved driver starts off-duty.
Expired licence/insurance/required vehicle documents prevent NEW work and invalidate outstanding unaccepted offers safely.
Do not abruptly terminate/reassign an IN_PROGRESS trip because a document expires or an administrative status changes; preserve necessary trip-completion/safety access and surface an operational alert, then prevent subsequent work. Define safe handling for pre-pickup assignments.
Renewal/remediation requires reviewing the replacement documents; do not reactivate solely because a date was edited.
Send configurable expiry reminders (e.g. 30/7/1 days) and show exact blockers in the driver's portal.
Changing identity, professional licence or vehicle after approval must trigger affected re-review; do not silently bless new content with the old approval.

## 6. Private uploads and data handling

- Store documents in private durable storage outside public/, Git and public asset paths. Use authenticated streaming or short-lived authorized URLs; enforce access when issuing URLs. No permanent public links.
- Applicants may access only their own files; restricted admins may review; passengers see only approved public driver/vehicle display fields, never identity scans, licence numbers or home addresses.
- Validate actual file signatures, size, type and image dimensions. Support JPG/PNG/PDF; support safe HEIC conversion if practical for iPhones. Reject executable/HTML/SVG disguised uploads and malformed files.
- Suggested configurable limits: 10 MB per photo, 20 MB per PDF, bounded files/pages per slot/application. Explain compression/retry without losing the draft.
- Quarantine and scan files before making them reviewable/approvable. Record scan status; do not silently mark an unavailable scanner as clean.
- Use safe preview conversion, encryption at rest/in transit and protected backups. Strip unnecessary GPS EXIF metadata from photo previews; preserve only specifically necessary evidence.
- No passports/document numbers/full addresses in logs, analytics, error traces or push notifications. Audit document access and decisions using record ids; avoid copying sensitive values into generic audit text.
- Define purpose and configurable retention for abandoned/rejected applications and superseded documents; deletion must clean thumbnails/storage too, while retaining minimal legitimate audit evidence. Do not invent a statutory retention period.
- Sessions and uploads need CSRF/auth checks, rate/size limits, secure cookie handling and permission tests.
- Phone verification alone is not KYC; final activation is explicit human review, with no automatic approval based on OCR or successful upload.

## 7. Existing-driver migration

Inspect existing operational drivers before schema changes.
- Do not bulk approve existing drivers or fabricate documents.
- Do not accidentally lock out every existing working driver by setting a new default without a rollout plan.
- Build an explicit migration/review queue and enforcement policy. Preserve current operation under a documented temporary legacy status only where the owner has already authorized it; never silently grant a new exemption.
- New self-registrations must always be gated immediately.
- If existing-driver enforcement needs a concrete operator decision, complete new-registration implementation, tests and a reviewable migration report first; list the affected records using non-sensitive ids and the decision needed.
- Preserve active rides, staff access, account identity and vehicle binding uniqueness. No destructive database resets.

## 8. Cyprus requirements research checkpoint

Before finalizing the required-document matrix, verify current Republic of Cyprus Road Transport Department sources for professional taxi drivers AND vehicles/operating permissions. Write docs/research/DRIVER-ONBOARDING-REQUIREMENTS.md with:
document, purpose, required/conditional, applicant applicability, issuing authority, expiry behavior, source URL/date and manual review criteria.
Separate government licensing requirements from IL-Y onboarding policy and identify unresolved applicability rather than guessing.

Starting source reviewed on 2026-09-14:
https://www.businessincyprus.gov.cy/business-sectors/taxi-driver/
This government page is marked last updated 2021-01-07. It describes professional taxi licensing, including category-T competence evidence and supporting licensing certificates. It is a starting point, not proof that all requirements are current or that every certificate must be collected by this platform.
Official department entry point: https://www.mcw.gov.cy/
Do not copy licensing fees/age limits/permit scopes from memory or commercial onboarding pages as settled law. Complete the software with configurable applicable rules and report any remaining real-world verification requirements.

## 9. Required tests and delivery

Test with synthetic identities and clearly marked specimen documents only:
- Login label and Register as a driver entry on desktop/mobile.
- Verified account registration, SMS error/retry, save/resume each step.
- Required vs conditional documents, passport vs ID alternatives, invalid/expired dates, upload retry, camera/HEIC behavior.
- Private upload ownership, admin permission boundaries, public URL denial, file spoofing/oversize and scan failure.
- Submit once, repeated submit, request changes, revision resubmission, rejection, concurrent admins and idempotent approval.
- Direct API bypass attempts: pending/rejected/suspended/expired cannot go online, appear publicly, receive/accept offers or be manually assigned.
- One account with passenger and pending driver roles retains passenger access without operational driver access.
- Approval provisions exactly one driver/vehicle/binding and starts off-duty.
- Post-approval document/vehicle edits trigger re-review; expiry blocks new work, preserves safe in-trip completion.
- Existing active rides and staff login survive migration.
- Applicant cannot read internal review notes or another applicant's files.

Run applicable Task 013/014 regressions. Provide screenshots of the wizard, upload slots, submitted status, admin queue/detail, requested corrections and approved driver portal at mobile/desktop widths.
Deploy to the established beta, verify actual release SHA and a complete synthetic application→admin approval→go-online flow. Distinguish mocked SMS/scanning from verified services; do not call KYC operational if upload review or enforcement is missing.
Deliver migrations/code, test evidence, deployed SHA, document requirement matrix, retention configuration and exact external blockers. Update Tasks index, HANDOFF and implementation status.

