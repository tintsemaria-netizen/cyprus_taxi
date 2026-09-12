# IL-Yas — Tasks index

Canonical location for numbered task documents (root `Tasks/`). The lowercase
`tasks/` folder holds the original ship/deploy briefs (001, 002) and is left as-is.
Task 004 (`docs/Tasks/Task.md`) was completed then removed upstream; its outcome is
recorded in `docs/DECISIONS.md`, `docs/TEST_REPORT.md`, `docs/BETA_RELEASE.md`.

Status legend per stage — **impl** (code), **auto** (unit/DB tests), **browser**
(real-browser interaction/layout), **device** (physical phone), **deploy**.

| Task | Summary | impl | auto | browser | device | deploy |
|---|---|---|---|---|---|---|
| [005](005-BETA-VERIFICATION-AND-REMAINING-FIXES.md) | DST fold, live-mode gating, tracking recovery, GPS/admin concurrency, health release id | ✅ | ✅ | ⬜ | ⬜ | ✅ |
| [006](006-FULLSCREEN-MAP-PICKER-AND-GEOLOCATION.md) | Full-screen map picker + browser geolocation | ✅ | ➖ | ⬜ | ⬜ | ✅ |
| [007](007-IL-YAS-BRANDING-AND-UI.md) | Rebrand to IL-Yas (logo, palette, icons, metadata) | ✅ | ➖ | ⬜ | ⬜ | ✅ |
| [008](008-MAP-PICKER-CORRECTNESS-AND-BROWSER-QA.md) | Picker coord/address consistency, lifecycle, **browser QA** | ✅ | ✅ | ✅ | ⬜ | ✅ |

✅ done · ⬜ pending · ➖ n/a. **Automated + browser QA are done** (24 vitest + 6
Playwright, see `docs/BROWSER_QA.md` and `docs/qa-screenshots/`). The remaining open
gate is **physical-device** GPS on real Android Chrome / iPhone Safari (needs hardware),
plus the separate 10-min load exercise and real geocoding/routing provider.

Next recommended task after 008: real Cyprus address lookup + road routing (replace
demo geocoder/router with an implemented, licensed provider), then a supervised pilot.
