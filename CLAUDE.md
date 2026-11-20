# Taxi Cyprus — implementation instructions

Read docs/SPEC.md in full, then docs/IMPLEMENTATION_STATUS.md and docs/HANDOFF.md. Execute tasks/001-SHIP-BETA.md. The user authorizes full web beta implementation and an isolated test deployment to a configured Taxi Cyprus target. Do not stop at planning or after the first UI milestone. Preserve repository instructions and existing work.

Repository: https://github.com/tintsemaria-netizen/cyprus_taxi

Selected design: dark graphite with lime accents. Web first, native Android/iOS later. Beta includes passenger booking/tracking, driver foreground GPS, admin and durable PostgreSQL data. Payment to driver. Never silently substitute simulated GPS for real tracking.

Operating model (Task 012, supersedes older manual-dispatch text): normal operation is AUTONOMOUS — a background dispatch worker matches passengers to drivers by real road pickup ETA, sends expiring driver offers, and completes assignment on driver acceptance with no dispatcher in the loop. Manual/dispatcher assignment is retained only as an audited admin override, never a dependency of a routine trip. See Tasks/012-AUTONOMOUS-DISPATCH-PRICING-AND-LIVE-ETA.md.

Before session/context limits update docs/HANDOFF.md and task status with exact next actions, Git state and evidence. Resume from those files. Do not bypass limits, switch accounts or invent session-management commands. Verify supported Claude Code continuation commands locally before using them.

No unrelated production deployments. No secrets in Git. Missing hosting access must not stop local development, tests or deployment preparation. Final response must distinguish a deployed beta from a local build, and actual tests from unrun checks.

Confirmed beta target: https://cyprustaxi.ackedberryes.store on 92.39.53.229. Claude is installed on this server according to the user. Read tasks/002-DEPLOY-TARGET.md before deploying.

<!-- BEGIN:nextjs-agent-rules -->

# Operator UI rules (from the operator, keep for every session)

- Every new screen, tab or sub-screen that is not a main screen gets a back arrow «‹» at the top left (use `BackArrow`; driver sub-screens: the arrow in the top bar via the `il-y:driver-back-visible` event). When you add or change such a screen, put the arrow there and tell the operator that you did (or that it was already there).
- Reports are shared tools (2026-11-20): whenever a report / figures screen is added or changed — hours online, km,
  earnings (cash / card), done / not-done trips, analytics, candles — say where else the same tool is needed and offer
  to add it there (driver earnings screen and today card, the admin's per-driver view, a future fleet-owner view).
  Before deploying anything about completed / not-completed trips, list those other places and ask. Build the tool
  once (shared server function + component), not one copy per role.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
