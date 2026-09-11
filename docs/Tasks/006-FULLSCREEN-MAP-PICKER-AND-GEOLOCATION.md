# Task 006 — Full-screen location picker and browser geolocation

Status: DONE (code, deployed) — full-screen MapPicker + browser geolocation implemented; tsc+build pass. Real-browser and physical-device (Android Chrome / iPhone Safari) verification UNVERIFIED — no browser/device on this headless server; screenshots not captured.
Repository: https://github.com/tintsemaria-netizen/cyprus_taxi
Beta: https://cyprustaxi.ackedberryes.store
Save this task in the root Tasks/ directory and add it to its index.

## Goal and user-reported problem
The mobile booking form covers almost the entire map. Clicking “Set pickup on map” or “Set destination on map” must collapse the form and expose the full map. The browser must request permission to locate the passenger, then center and zoom the map near their actual position.
Keep the existing dark theme with lime accents. Implement this in the current repository, preserving current changes and the work from task 005. Read repository instructions and inspect the current booking/map components before editing. Do not apply older patches blindly.

## 1. Dedicated map selection mode
- Both buttons enter a dedicated full-viewport map selection mode on mobile and desktop. Collapse/hide the booking form and any large header that obstructs the map; retain only compact necessary notices and picker controls.
- Close the software keyboard and disable background page scrolling. Size the map to the actual visible viewport, including mobile browser bars and safe areas. Notify the existing map library after its container resizes so tiles fill the area correctly.
- Show a compact title: “Set pickup location” or “Set destination”. Show Back/Cancel, a clearly visible selection pin, “My location”, and a compact bottom confirmation panel.
- Prefer a fixed center pin: dragging or zooming the map updates a draft coordinate beneath it. The device position marker must be visually distinct from the selection pin.
- Show a resolved address when available, or honest latitude/longitude text if reverse geocoding is unavailable. Do not invent an address or label fixtures as real.
- Use explicit “Confirm pickup” and “Confirm destination” actions. Confirmation updates only the relevant field and coordinates, restores the form, and returns focus to the relevant control.
- Cancel, Escape on desktop, and browser/mobile Back dismiss the picker without committing draft changes. Do not navigate away unexpectedly.
- Preserve all booking fields: the other address, passenger count, ride type, schedule, name, phone and comments. Merely moving the map must not submit or create a booking.
- Reopening an already selected field starts at its saved coordinate. Do not overwrite a previously chosen destination with current GPS coordinates.

## 2. Browser location permission and initial camera
- On the first explicit map-selection action, request location through the browser's standard geolocation API when permission has not already been denied. A custom popup is not a substitute for the browser prompt.
- Already-granted permissions may return without a prompt; denied permissions cannot be forced to prompt again. Handle browsers without the Permissions API as well.
- Prefer an existing field coordinate for the initial camera. For an empty field use an available device position; otherwise show a sensible Cyprus fallback while location resolves. For an empty destination, an existing pickup can serve as a temporary fallback.
- On a successful location response, center near the passenger and zoom to a useful street/neighborhood level, taking reported accuracy into account. A coarse fix must not appear precise. Display a separate user-position marker and accuracy circle where practical.
- A late location response must never move the map after the user has manually positioned it, overwrite an existing field selection, or affect a picker that has been closed or switched to the other field. “My location” is the explicit way to recenter afterward.
- Location retrieval is for passenger convenience, not continuous passenger tracking. Do not add a background watch or transmit/store the passenger's device location just to center the map. Only the explicitly confirmed booking coordinates enter the normal booking flow.
- Use finite timeout and reasonable cache age. Explain permission denied, timeout, unsupported API, insecure context and unavailable location with short actionable messages; manual map selection remains fully usable.
- On denial offer browser-permission guidance without repeatedly requesting permission on every render. Retry/My location may make a new attempt when appropriate.
- If the user is outside Cyprus, show their actual location honestly. Do not replace it with a fake Cyprus fix. Preserve the application's configured service-area validation at confirmation/booking and explain unsupported locations. Do not assume that viewing a location means it is serviceable.

## 3. Implementation details to verify in current code
Use the existing map library and design components. Model editing as a draft selection separated from committed form state. Ignore stale geolocation and reverse-geocoding responses using request identity or equivalent cleanup. Debounce reverse-geocoding if supported; do not request on every animation frame. Preserve coordinate order and accuracy units at API boundaries. Avoid remounting/resetting the entire booking form to hide it. Provide accessible labels, visible focus, keyboard-operable controls and touch targets of at least 44px.

## 4. Acceptance checks
Verify the following meaningful flows in a real browser; mocked geolocation is acceptable for automated permission/outcome cases, but identify it in the report:
1. At 360px and 390px mobile widths, both map buttons hide the form; the map fills the available viewport and all picker controls remain reachable without page scrolling.
2. At 1440px desktop width, selection exposes the full map and does not leave the form covering it.
3. Permission granted: camera reaches supplied device coordinates and the position marker is distinct from the draft pin.
4. Permission denied, timeout and unavailable API: a clear message appears and manual selection still works.
5. Drag, confirm, reopen, and cancel for each field: committed coordinates and all unrelated form inputs are preserved correctly.
6. A delayed location result after manual movement, cancellation or switching fields never hijacks the camera or alters the wrong field.
7. Existing destination remains intact when device location resolves; “My location” changes the camera/draft only until confirmation.
8. Resize/orientation change and opening with the keyboard active produce no blank tiles, clipped buttons or trapped scrolling. Scrolling is restored after closing.
9. Missing reverse geocoding displays coordinate fallback, never a fabricated address. Outside-service-area behavior stays consistent with configured coverage.
10. Test HTTPS permission behavior on a physical Android Chrome and iPhone Safari if available. If unavailable, explicitly report this as unverified; device emulation is not a physical-device test.

Run the relevant existing tests, type checks and production build. Add focused interaction coverage for draft/commit/cancel and asynchronous geolocation races. Do not broaden unrelated scope or use the production database for destructive tests.

## 5. Delivery
Implement, test, commit and push the task and code using your authorized repository access. Deploy only the Taxi Cyprus service to its existing beta host using the project's established procedure. Preserve secrets and unrelated services. Verify the deployed page over HTTPS; record the deployed commit and any blocked checks. Update Tasks/ index and the current handoff/test report with actual evidence. Provide mobile screenshots of the expanded form, full-screen pickup selection and confirmed result. Clearly separate code completion, browser tests, physical-device verification and deployment status.
