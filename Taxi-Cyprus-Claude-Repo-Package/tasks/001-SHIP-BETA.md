# Task 001 — build and release the complete web beta

Status: READY FOR IMPLEMENTATION. Documentation only; development has not been started by this handoff.

Read CLAUDE.md and docs/SPEC.md. Implement the complete specification, run the application, test and fix it, and release the first beta to a configured isolated Taxi Cyprus environment. Work through all milestones autonomously. Do not return only a plan or a frontend prototype.

1. Inspect repository and environment; initialize the project if empty. Record architectural decisions.
2. Implement schema, auth, API contracts, booking state machine and concurrency guarantees.
3. Build passenger booking and scoped tracking in the approved dark/lime responsive design.
4. Build dispatcher assignment/fleet UI and admin tools.
5. Build driver assignment/status/GPS flows and complete the end-to-end trip.
6. Add explicit demo mode, PWA shell and error/offline handling.
7. Execute acceptance tests, responsive QA and available load testing; fix material defects.
8. Prepare and perform isolated beta deployment when target access exists, verify remotely, and deliver docs/BETA_RELEASE.md with URL, commit, test evidence and limitations.

Read the precise requirements and release gate in docs/SPEC.md. Update docs/IMPLEMENTATION_STATUS.md after each milestone. Before context loss or a session change write docs/HANDOFF.md with the next executable step. Resume without starting over.

If deployment credentials are absent, finish a tested locally runnable beta and deployment package first, then report the exact missing target/access. Never claim a reachable beta exists before verifying it.

Deployment destination is now supplied: read tasks/002-DEPLOY-TARGET.md. Missing destination is no longer a blocker; verify actual local server access.
