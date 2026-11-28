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

- Check everywhere (2026-11-22): the project is large. When you fix a problem or change behaviour, search the whole
  codebase for the same pattern — passenger, driver, admin, fleet, share, pre-booking, server and worker — and fix or
  list every other place it occurs. Tell the operator where you checked and what else you found.
- A changed rule is changed everywhere it is told (2026-11-27): when a rule, price, time or limit changes (fees,
  waiting minutes, discounts, who sees what button when), update every text that describes it in the same change —
  info «ⓘ» cards, the /welcome page, driver and passenger hints, confirm sheets, push texts (`public/sw.js`), e-mails,
  admin help — in all languages. Prefer reading the number from the server setting over writing it into the text.
  Tell the operator which texts you changed.
- Language (2026-11-22): every person (passenger, driver, staff) first gets the phone's / browser's language; once
  they choose a language it stays fixed for them. Screens, e-mails and push notifications all follow it — a new
  notification gets a text key in `public/sw.js` MSG_TEXT (8 languages), never English-only text.
- Pop-ups close on a tap elsewhere (2026-11-27): every small pop-up — a list, an ⓘ note, a menu, a dropdown — closes
  on a tap anywhere else and on Escape, not only with its own button. Use `useDismiss` from
  `src/components/useDismiss.ts` (the tap that closes it presses nothing else). Full-screen windows with a dark
  backdrop close on a backdrop tap. Tell the operator when you add one.
- Everything opened fits the screen (2026-11-28): a window, sheet, pop-up, dropdown or opened menu section is
  never taller than the visible screen (small phones, open keyboard): limit it (`max-h-[calc(100dvh-2rem)]`,
  `max-h-[50dvh]` for lists) and let the content scroll inside, header / title and its main button staying in view.
  If it loads data after opening, keep it in view when it grows (driver `MenuRow` does this with a ResizeObserver).
  Check new windows on a 320×480 screen before showing the operator.
- Resumed apps (2026-11-22): installed phone apps are resumed, not reloaded. A screen that loads data or the position
  once must refresh when it comes back (`useRefreshOnReturn` from `src/components/useRefreshOnReturn.ts`).

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
