# Driver onboarding — document & verification requirements (Task 015 §8)

Date: 2026-09-14. Product: IL-Y (Republic of Cyprus).

**Status of this document:** IL-Y **onboarding policy** (what the platform collects to verify
an already-licensed driver + vehicle) separated from **government licensing** (what the RTD
requires to *issue* a licence). Rules below are **configurable** in code
(`src/server/applications.ts` → required slots + `missingRequirements`). Items marked
**VERIFY** need confirmation against current Road Transport Department (RTD) sources before
being treated as settled law — this environment could not fetch live pages.

Starting government source (provided, last updated 2021-01-07):
https://www.businessincyprus.gov.cy/business-sectors/taxi-driver/ · Dept entry: https://www.mcw.gov.cy/
Do NOT copy fees/age limits/permit scopes from memory or commercial pages as settled law.

## Person (driver)

| Document / field | Purpose | Required? | Applicability | Issuing authority | Expiry behaviour | Review method |
|---|---|---|---|---|---|---|
| Full legal name, DOB, residential address, country | Identity match | Required | All | — | — | Manual field vs document |
| Passport photo page **OR** ID card front+back | Identity evidence | Required (one of) | All | Govt | Passport/ID expiry (VERIFY) | Manual image review |
| Selfie / current portrait | Manual face comparison | Required | All | — | — | Manual compare — **not** liveness/biometrics; no external KYC/AI |
| Right-to-work / residence evidence | Work eligibility | **Conditional** | Non-CY/EU applicants where applicable | Govt | Permit expiry | Manual — do NOT blanket-require from everyone |
| Driving licence (front, back where applicable) | Legal to drive | Required | All | RTD | Expiry blocks work | Manual; category must cover the vehicle |
| Cyprus professional taxi driver licence | Legal to carry passengers for hire | Required | All | RTD | Expiry blocks work | Manual document review |
| Category-T professional competence evidence | Supports the taxi licence | **Conditional (VERIFY)** | If separately needed to verify the licence | RTD | VERIFY | Manual |
| Criminal-record / medical certificates | — | **Not collected by default** | Only with a documented applicable basis + restricted retention | — | — | Excluded unless explicitly configured |

## Vehicle

| Document / field | Purpose | Required? | Applicability | Expiry | Review |
|---|---|---|---|---|---|
| Plate, registration country, VIN, make, model, year, color, seats, class | Identify vehicle | Required | All | — | Manual vs photos/registration |
| Vehicle registration certificate | Ownership/identity | Required | All | — | Manual |
| Ownership / permission to operate (lease/fleet authorization) | Right to operate | **Conditional** | If applicant ≠ registered owner (fleet) | — | Manual — flag, don't auto-reject legit fleets |
| Taxi vehicle/operating permit | Legal to operate as taxi | Required (VERIFY scope) | All | Permit expiry | Manual |
| Commercial/taxi passenger insurance | Cover | Required | All | Expiry blocks work | Manual |
| Roadworthiness / MOT + road-tax | Legal to be on road | **Conditional (VERIFY)** | Where applicable | Expiry | Manual |
| Taxi meter / inspection / taxi sign | Equipment | **Conditional (VERIFY)** | Where applicable | — | Manual (photo slot available) |
| Vehicle photos: front(+plate), rear(+plate), left, right, front cabin, rear seats, boot | Verify same vehicle & condition | Required | All | Current | Manual — compare plate/VIN/model/color |

## Verification method (recorded honestly)

- Verification = **manual document review by an administrator**. No government-database check
  is implemented or claimed. Phone is SMS-verified (Twilio Verify when configured; dev OTP
  otherwise). An upload/OCR/successful verification is **not** licence validation.
- Final activation is explicit human approval; there is no auto-approval.

## Unresolved (VERIFY before activating as hard requirements)

1. Exact current RTD document set + expiry rules for the professional taxi driver licence and
   the vehicle taxi/operating permit (source is dated 2021).
2. Whether category-T competence evidence must be *retained by the platform* vs only needed to
   obtain the government licence.
3. Roadworthiness/road-tax/meter applicability per vehicle/area.
4. Right-to-work document scope for non-CY applicants.
Until verified, these remain configurable and are surfaced as review items, not fabricated law.
