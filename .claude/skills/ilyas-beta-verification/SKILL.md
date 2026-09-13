---
name: ilyas-beta-verification
description: Verify and deploy the IL-Yas autonomous taxi beta with database race, pricing, browser and recovery evidence. Use for release acceptance.
---

Read Task 012 sections 8 and 9 plus current deployment instructions and handoff.
Prove one full trip with no dispatcher session: quote, automatic offer, accept,
live pickup ETA, arrival/wait, confirmed start, completion and receipt.
Test real DB exclusivity and worker recovery; mocks alone cannot prove locking.
Keep load tests and simulated drivers isolated; stub external providers under load.
Run bounded real-provider checks separately and redact keys/contact data in traces.

Record browser/device, commit, environment, command, result and evidence. Distinguish
unit, integration, headless raster, real vector and real-device checks. Failed/unrun
checks remain visible. Verify deployed worker health and migrations, not just web HTTP.
Save handoff before session limits and deploy only to the authorized IL-Yas beta.
