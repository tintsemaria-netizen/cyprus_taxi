# Session handoff

## 2026-11-15 — Car class choice moved to the final step, with sedan / minibus pictures
- **Form step:** the Comfort/XL list was removed. The CTA now reads «Заказать · от ≈ {cheapest quote}» (`booking.cta.requestFrom`), or «Заказать поездку» without a route.
- **Review step (before the final order):** `classPicker` is shown under the trip details.
  - Each card has an own SVG side view (`CarClassIcon`): a sedan for Comfort, a minibus for XL. The selected one is lime.
  - Text: «до {n} человек» (`booking.form.upToPeople`, n = class maxPassengers), plus price and range.
  - The confirm button reads «Заказать {class} · ≈ price».
  - The «Класс» review row was removed (the picker shows it).
- en/ru/el keys added.
- Playwright (local, iPhone 13): form has 0 class radios and CTA «Заказать · от ≈ 9,50 €»; review has 2 radios with icons and «до 4/6 человек»; choosing XL → «Заказать XL · ≈ 9,50 €»; no errors.

## 2026-11-15 — Collapsed sheet with a chosen route: addresses + order button (no «Куда едем?»)
**Collapsed peek with a route (`peekRoute` = mobile + collapsed + pickup & dropoff + form step):**
- the eyebrow/title are hidden;
- the route box (`data-route-box`) and the sticky «Заказать … · ≈ price» footer are shown.
- Peak height = handle + content padding + route box + 14 px + footer (its safe-area padding excluded, since the card adds the inset).
- Expanding brings the title back.

**Bug fixed:** the sheet's `onFocusCapture` expanded the sheet for ANY focus. On Android/Chromium the handle (tabIndex 0) takes focus after a tap, so tapping the handle to collapse re-expanded it immediately. Now only an editable form field (`input:not([readonly]), textarea, select`) expands it.

**Check:** Playwright (local, iPhone 13 + SE):
- route chosen and collapsed → card 236 px, no title, route box fully visible, «Заказать Comfort · ≈ 9,50 €» visible;
- handle tap → expanded with the title;
- handle collapse/expand toggles both ways;
- no errors.

## 2026-11-15 — Two points: ⇅ swap; with a stop: drag ≡ (editor + sheet)
- **RouteEditor:**
  - 2 points → «+» and ⇅;
  - 3 points (stop) → no ⇅; each row gets ≡ and is dragged with pointer capture (row height 53 px → target index by rounding); `onReorder(from, to)`.
  - The right column is hidden when empty.
- **Sheet:** 2 points → a ⇅ button beside the address box, no ≡; 3 points → ≡ per row, no ⇅.
- **BookingApp:** shared `reorderRoute(from, to)` (also used by the sheet drag) and `swapRoute()`.
- **Playwright (local):**
  - sheet with 2 points: swap 1 / drag 0;
  - editor with a stop: swap 0 / drag 3 / add 0;
  - dragging the stop row up one row → [Castle, current, Marina];
  - sheet after close: swap 0 / drag 3 with the same order;
  - no errors.

## 2026-11-15 — Booking sheet: address box like the route editor
- The «Откуда/Куда» labels and separate fields were removed. The sheet now shows one box: a row per point with a dot (lime ring = from, amber square = stop, lime disc = to) joined by a lime line.
- Each row has the address (read-only; a tap opens the route editor on that row), a lime map icon («На карте»), × for the stop, and ≡ to drag-reorder.
- Errors: the box gets a red border, with the messages under it. The input has aria-invalid, so ErrorFocus still finds it.
- «＋ Добавить остановку» adds the stop and opens the editor on it.
- The peek measurement now targets the first read-only address input.
- BookingApp no longer uses PlacesInput (it is still used on /account).
- Playwright (local, iPhone 13): no labels; the 3-row box renders with aligned icons; editor flow unchanged (route.mjs all green); peek 178 px with the field visible; no errors.

## 2026-11-15 — Route editor back to the app's dark theme
- At the user's request the white background was dropped. RouteEditor now uses the theme classes (bg-page / bg-elevated / text-ink / text-muted / border-edge).
- Dots: lime ring (from), amber square (stop), lime disc (to). The connector line is translucent lime and the map-pick button lime.
- Layout and behaviour unchanged.
- Playwright (local, iPhone 13): same flow as before (open, recent with km, search, add/remove stop, pick → price, swap, close); no errors; screenshots reviewed.

## 2026-11-15 — Full-screen route editor (light), recent places moved out of the sheet
**Request:** typing an address was cramped and the suggestions took too much space. The user wanted a «Маршрут» screen like the reference app (white background) — similar but not a copy — and the recent places removed from the initial sheet.

**New `src/components/booking/RouteEditor.tsx`:** light full-screen dialog (desktop: a 380 px card on the left).
- Top bar: × close, title «Маршрут».
- Route box: from → [stop] → to, joined by a line. Own dots: lime pickup ring, amber stop square, graphite destination with a lime core.
- Map-pick button in the active field; × on the stop row.
- Right column: «+» add stop (hidden when a stop exists), «⇅» swap start/destination.
- List:
  - empty field → home/work + recent destinations with a clock icon and distance (km from the device location or the pickup);
  - typing → /places/search results with pin icon and distance.
- Picking fills the field, jumps to the next empty field, or closes when the route is complete (prices show in the sheet).
- New keys `booking.route.*` (en/ru/el).

**BookingApp:**
- The sheet's address fields are now read-only triggers (`PlacesInput.onActivate`, fired on focus and on click). A tap on a collapsed sheet expands it and moves the field, so the click alone was unreliable.
- A hidden proxy input is focused synchronously in the tap, so iOS opens the keyboard and keeps it while focus moves into the editor.
- The «Недавние» and home/work chips were removed from the sheet.
- Drag ≡, «+ Добавить остановку», «На карте» and the × reset stay in the sheet.

**Check:** Playwright (local, iPhone 13 + 1280 desktop):
- the sheet has no recent chips;
- tap «Куда» → editor with the destination focused and recent «Larnaca Airport (LCA) · 55 км»;
- typing «Lima» → 3 results with km;
- + adds the stop row (focused), × removes it;
- picking a result closes the editor and shows the price (≈ 9,50 €);
- ⇅ swaps start/destination; × closes;
- no page errors.
- **Not verified:** the iOS keyboard handoff on a real device.

## 2026-11-15 — ErrorFocus: every repeated attempt points at the unfixed error
**Problem:** ErrorFocus only reacted to NEW errors. A second «Заказать» with the same missing phone did nothing (user report).

**Fix:**
- After a PROCEED press (`button[type=submit]`, `input[type=submit]`, `.btn-primary`, or a form submit), if no new error appeared within 300 ms, the first existing visible error is scrolled to the centre, its field is focused, and the field briefly shakes (`.ily-err-shake` in globals.css).
- Other clicks keep the old behaviour (new errors only), so the page doesn't jump on unrelated taps.

**Check:** Playwright (local, iPhone 13, booking without a phone): the form is scrolled back to the top before each of 3 attempts; every attempt brought the phone field into view and focused it; no errors.

## 2026-11-15 — × on the finished-ride sheet
- TrackApp: when the ride is COMPLETED or CANCELED, a × (48 px, top-right corner of the sheet, same style as the booking reset ×) links to «/», the new-booking start.
- New key `track.closeToStart` (en/ru/el).
- Playwright (local, COMPLETED ride): × at 7 px from the corner; tap → «/» with «Куда едем?»; no errors.
- Test helper (local only): /tmp/ui/mkdone.ts creates a completed ride. The driver must be moved to the pickup before `arriveAtPickup`.

## 2026-11-15 — iPhone keyboard pushed the header under the status bar
**Cause:** with the keyboard open, iOS shrinks and pans the visual viewport, while the `fixed inset-0` app root stays on the layout viewport. The header ended up under the time/battery (user's screenshot).

**Fix:** new `src/components/useKeyboardViewport.ts`. While a keyboard is open (`innerHeight − visualViewport.height > 80`), the root is pinned to the visual viewport (`top = offsetTop`, `height = vv.height`), and the focused input is scrolled into view. Otherwise the root stays `inset: 0`.
- Used by BookingApp, TrackApp and /share.

**Check:** Playwright with a mocked `visualViewport` (iPhone 13, local):
- keyboard open (top 300, h 360) → root at 300 px / 360 px high, header at 300, the «Куда» field inside the visible band;
- keyboard closed → back to inset 0;
- no errors.
- Not verified on a real iPhone keyboard here.

## 2026-11-15 — Route reset × in the sheet corner, 2× size; collapsed peek fits the «Куда» field
- The reset × moved from the address block to the booking sheet's top-right corner. It is now 48 px with a 36 px glyph (was 28/18) and is shown on the form step while the sheet is open.
- **Regression fixed:** the collapsed peek was a fixed 170 px, but the «Куда» input ends at 189 px. Without a bottom safe area (Android, iPhone Safari tab) the field was half-cut, and useHideClipped then hid it entirely, so the collapsed sheet could only be opened by the handle.
  - The peek height is now measured: input bottom + 14 px, clamped 150 px … 60 % of the viewport, re-measured on content resize. `peekPx` state replaces the constant.
- Playwright (local): iPhone 13 / SE / 440 px, logged in and anon → peek 203 px, field visible; × at 7 px from the card corner, 48 px, resets the route; no errors.

## 2026-11-15 — Fix: passenger track sheet could only be moved by its handle
**Cause:** `useSheetDrag` used a plain ref and attached its touch listeners in an effect keyed on `open`. TrackApp renders a loader first, so the panel mounted later and the effect never re-ran.
- At IN_PROGRESS the auto-collapse changed `open` and attached the listeners by luck.
- At ASSIGNED / EN_ROUTE / ARRIVED the panel only moved by its handle (user's iPhone screenshot at «Водитель на месте»).

**Fix:** the panel ref is now a callback ref stored in state, and the effect depends on the element.

**Check:** Playwright CDP touch (local, ARRIVED):
- swipe down on the driver card → collapsed;
- swipe up → open;
- swipe down on the body at top → collapsed;
- no errors.

## 2026-11-15 — Scroll to the first error after a blocked step (app-wide)
- New `src/components/ErrorFocus.tsx`, mounted once in the root layout. On a button click or form submit it snapshots the visible error elements (`.border-danger`, `[aria-invalid=true]`, `.text-danger`, `[role=alert]`).
- If a NEW error appears within 2.5 s, it smooth-scrolls the first one (document order) to the centre and focuses its field. This works inside nested scroll containers such as the booking sheet.
- Ignored: buttons/links, map internals, `[data-no-error-focus]`. Live validation while typing never scrolls, because only errors appearing after a user action count.
- BookingApp.validate also expands a collapsed mobile sheet when there are errors.
- Playwright (local):
  - booking with a missing phone (form scrolled to the top) → the phone field is scrolled into view and focused;
  - /login with a wrong password → the error is in view;
  - no errors.
- Note: some forms disable the button until valid (e.g. /register «Продолжить»); they show no error, so there is nothing to scroll to.

## 2026-11-15 — Passenger's live position for the driver: near the pickup only, every 2 s, gone when the app closes
**Purpose:** the passenger's ACTUAL position (not the pickup point), so the driver can find someone who set a wrong pickup.

**Server:**
- `passengerLocationForDriver(b, now, driverPos)`: shown only when the booking is ARRIVED, or the driver's latest location is within `SHOW_NEAR_PICKUP_M` (300 m) of the pickup.
- Positions older than `SHOW_MAX_AGE_MS` (now 8 s) are hidden.
- `driverCurrentTrip` passes the driver's latest location.
- The /tracking/location POST rate limit is raised to 45/min.

**Passenger (ShareLocationToggle, opt-in as before):**
- Sends every 2 s while visible.
- On `visibilitychange→hidden` and `pagehide` it sends DELETE (`fetch keepalive`), so the marker disappears at once. The 8 s age is the fallback.

**Driver app:** current trip is polled every 1 s while ASSIGNED / EN_ROUTE / ARRIVED (otherwise 5 s); the dashboard stays at 5 s.

**Tests:**
- passenger-location.db.test updated: near/far/ARRIVED gating; 7 s shown, 9 s hidden.
- Playwright two-browser e2e (local), passenger sharing 60 m from the pickup:
  - driver ~500 m away → no marker;
  - driver drives in → marker shown;
  - passenger page closed → marker gone after ~1 s;
  - no errors.

## 2026-11-15 — «Оценка стоимости устарела» on order: quotes kept fresh + silent re-quote
**Cause:** server quotes live 2 min (`QUOTE_TTL_MS`, Task 012 §6.3). A passenger who waited longer before «Заказать» got QUOTE_EXPIRED.

**Fix (BookingApp):**
- Quotes are re-fetched when they are older than 90 s: checked every 10 s while the page is visible, and when the page becomes visible again.
- On submit, QUOTE_EXPIRED / QUOTE_MISMATCH / QUOTE_NOT_FOUND triggers a fresh quote for the chosen class.
  - Same total → the booking is retried once automatically with the new quoteId.
  - Different total → the new price is shown with `booking.form.priceUpdated` (en/ru/el) and the passenger confirms again. An unseen price is never charged.
- The server is unchanged and still rejects expired quotes.

**Check:** Playwright (local): route chosen; all Quote rows set to expired in the DB; confirm order → one extra /quote call, booking created (/track «Ищем водителя»); no errors.

## 2026-11-15 — Person marker: plain grey outline
- At the user's request the light badge, the lime frame and the tie were removed. The marker is now only the grey two-tone outline, with a thin dark halo so it reads on dark and light map tiles.
- Checked by rendering the SVG on dark and light backgrounds (local).

## 2026-11-15 — Driver on an order: navigation arrow with a standing-still pulse
- New `navArrowEl` in carMarker.ts: a rounded arrow in darker IL-Y lime (#7FA620) with a white outline. It uses the same `.car svg > g` rotation as the car, so `orientVehicle` and map-rotation handling work unchanged.
  - A translucent lime circle pulses around it (CSS keyframes injected once).
  - The class `ily-moving` hides the pulse.
- `MapMarker.nav` / `MapMarker.moving` (Google + MapLibre). Google toggles `ily-moving` in place (no re-create).
- DriverNavigation: the own marker is `nav: true`. `moving` means ≥10 m in the last 8 s of GPS; it falls back to standing after 10 s without fixes. Off an order the driver home map keeps the car.
- Playwright (local, EN_ROUTE): standing → pulse animation running; after 6 GPS moves → `ily-moving`, no animation; no errors.

## 2026-11-15 — New person marker and pickup pin
- `personMarkerEl` redrawn from the user's reference: a man in a shirt and tie raising his hand, grey two-tone outline on a light rounded badge with a lime border, 42 px.
  - Shown only while the passenger's app is open: on their own map from live GPS; on the driver's map only when the shared position is under 60 s old (`SHOW_MAX_AGE_MS`).
  - ShareLocationToggle now re-sends the last fix every 10 s while the page is visible (heartbeat), so a passenger standing still doesn't vanish, and nothing is sent while hidden or closed.
- New `pickupPinEl`: a needle with a round lime head (#C8FF46). The tip is the point (Google default bottom anchor; MapLibre `anchor: 'bottom'`). It is used for every `pickup` marker (passenger, driver, admin).
- Playwright (local): booking map shows the pin and person; driver map (EN_ROUTE with fresh passenger location) shows the pin and person; no errors.

## 2026-11-15 — Driver map shows only the current target
- DriverNavigation markers: on the way to or waiting at the pickup, only the pickup (plus own car and the opted-in passenger) is shown. Before, the destination marker was included and the map zoomed out to the whole route; the user's screenshot showed «Ожидание» framing Limassol–Larnaca.
- Stop leg → only the stop; dropoff leg → only the destination.
- GoogleMapView: a multi-marker fit is capped at zoom 17, so car+pickup a few metres apart don't zoom in absurdly.
- Playwright (local, ARRIVED): no destination marker; map framed on car/pickup; no errors.

## 2026-11-15 — No half-cut text in collapsed sheets; full-screen roots
- New `src/components/useHideClipped.ts`. While a sheet is collapsed or being dragged, any element only partly visible at the sheet's bottom edge is hidden (visibility), so the peek never shows half a line or half a box. It re-checks on resize, drag and content changes.
  - Used by the booking sheet (mobile, collapsed or dragging) and the driver navigation panel (collapsed).
- Driver nav collapsed:
  - a one-line «⚠ GPS выключен — включить» replaces the big GPS box (new key `driver.navigation.gpsOffShort` en/ru/el);
  - the destination line is single-line with an ellipsis;
  - peek height is 72/96 px.
- BookingApp, TrackApp and /share root containers are now `fixed inset-0` instead of `h-[100dvh]`. The user's iPhone screenshot showed a band under the sheet where 100dvh fell short of the screen.
- Playwright (440×956, safe-area override top 62 / bottom 34, local): no partly visible text in the collapsed booking sheet or the collapsed driver panel; screenshots reviewed.

## 2026-11-15 — iPhone status bar overlapped the header (safe-area top)
- The apps use `viewportFit: cover` + `statusBarStyle: black-translucent`. Installed on a notched or Dynamic Island iPhone (e.g. 16 Pro Max), page headers were drawn under the time/battery.
- Every top header now adds `env(safe-area-inset-top)` to its top padding:
  - PassengerTopBar, BookingApp header, StaffShell header (driver + admin), /share header;
  - driver home top overlay: top = 64px + inset;
  - /dispatch grid height subtracts the inset.
- Already handled before: DriverNavigation banner and the map pickers.
- Playwright with CDP `Emulation.setSafeAreaInsetsOverride` (top 62, 440×956, local): header padding 70–72 px; logo starts below the status-bar zone on /, /account, /track, /driver, /dispatch.

## 2026-11-15 — Multi-device UI audit + responsive fixes
**Audit:** Playwright, 11 viewports (280 Fold, 320, 375, 390, 412, 430, 844×390 landscape phone, 768 iPad mini, 1180 iPad landscape, 1280, 1920) × 24 pages (anon, passenger, driver, admin) = 264 page renders.
- Checks: horizontal overflow, off-screen controls, controls covered by other elements (elementFromPoint), clipped text, page errors; plus visual review of screenshots.
- Script: /tmp/ui/audit.mjs (local only; not committed).

**Results:**
- No horizontal overflow and no off-screen controls on any page or device.
- No page errors.

**Fixed:**
- StaffShell: on 768–1279 px the inline nav ran under the language/logout buttons. The inline nav is now shown only at ≥1280 px (xl); below that the scrollable second-row nav is used.
- Maps:
  - Zoom +/- buttons were hidden under the bottom sheets on phones. They are now shown only with a mouse (pointer: fine); touch uses pinch.
  - Google zoom control moved to RIGHT_CENTER; cameraControl is off.
- DriverNavigation ≥640 px: the action button and sheet stretched across the whole screen. They are now a 420 px left column (rounded card), and the map fit pads the left side.
- TrackApp <360 px: the driver card hid the driver name. The avatar is hidden and the plate made smaller there.

**Known false positives:**
- The native language `<select>` is reported as "clipped".
- Phone landscape shows the intentional portrait-lock cover (passenger/driver apps are portrait-only since 2026-11-12).
- The sticky «Заказать поездку» button over the scrolled booking form is reported as covering fields.
- The driver nav (fullscreen) covers the driver app header by design.

## 2026-11-15 — Removed the "BETA · TEST SERVICE" banner from the passenger app
- At the user's request, the DemoBanner was removed from BookingApp and its component deleted.
- The `auth.demoBanner` strings are left in the catalogs, unused.
- Note: SPEC §15 asked for a conspicuous test-service banner. The user explicitly overrode that for the client version.

## 2026-11-15 — Passenger rating defaults to 5 stars
- RateTripModal (inline on /track and the rides modal) now starts at 5 stars; positive tags are shown immediately.
- Playwright (local): a COMPLETED ride's /track page showed 5 stars checked; no page errors.

## 2026-11-15 — Map-overlay sheets drag by the whole panel (passenger tracking + driver navigation)
- New `src/components/useSheetDrag.ts`: native touch listeners on the panel.
  - Collapsed: any vertical swipe moves it, with rubber-band feedback.
  - Open: a downward pull while the body is scrolled to the top collapses it; otherwise the body scrolls.
  - The panel follows the finger (translateY) and snaps on release. Inputs and `[data-no-sheet-drag]` are ignored; taps still work.
- Used by TrackApp (`track-sheet`) and DriverNavigation (`nav-sheet`). The handles still tap/swipe as before. The booking sheet already had this behaviour.
- Playwright with CDP touch events (local, iPhone 13): on both sheets, swiping up on the panel body opened it and swiping down collapsed it; no page errors.

## 2026-11-15 — Driver navigation: info sheet floats over the map; separate action button; rating defaults to 5
- DriverNavigation: the map now fills the screen. Recenter, the stage action (On my way / Arrived / start code / stop actions / Complete trip) and the info sheet are an absolute overlay at the bottom.
- The action is a separate floating bar above the info sheet.
- The sheet collapses by itself when the status becomes IN_PROGRESS (also starts collapsed if opened mid-trip). Handle tap/swipe toggles it manually.
- RatePassengerSheet is preselected to 5 stars.
- Playwright (local, iPhone 13, andreas): sheet open at ARRIVED → collapsed after the start code; actions above the sheet, map under the sheet; tap expands; complete → fare preview → rating shows 5 preselected; no page errors.

## 2026-11-15 — Passenger tracking: collapsible info sheet; close car follow during the trip
- TrackApp sheet has a handle (tap or swipe). Collapsed shows only the pinned header (status + driver/plate); the body (route, chat, share, details) is hidden.
- It collapses by itself when the status becomes IN_PROGRESS and re-opens on ARRIVED, COMPLETED or CANCELED.
- During IN_PROGRESS the map follows the car closely (`follow`, zoom 16, north-up, no tilt). A gesture frees the map, and it returns after 4 s (`idleReturnMs`).
- Playwright check (local, IN_PROGRESS ride): collapsed on load, chat hidden; car at the map centre (0/1 px); expanding shows the chat; no errors.

## 2026-11-15 — Driver navigation: car faces forward, collapsible panel, fare check before completing, driver rates passenger
- Car orientation:
  - `orientVehicle(el, mapHeading, bearing)` in carMarker.ts: the car rotation is the compass bearing minus the map's heading (marker content is screen-space, the nav map is heading-up).
  - Re-applied on Google `heading_changed` and MapLibre `rotate` (class `.ily-vehicle`). `MapMarker.heading`: the own car in navigation uses the route/travel heading.
  - Google ignores sub-4 m GPS jitter when deriving a bearing.
- DriverNavigation layout:
  - The info panel (ETA, target, passenger, waiting, quick buttons, chat, details) collapses to ~64 px via the handle (tap or swipe).
  - The stage action buttons are a separate always-visible action bar below it.
- Close-out:
  - «Завершить поездку» opens `FarePreviewSheet`, which reads `GET /api/v1/driver/bookings/[id]/fare-preview`: estimate + pickup waiting + stop waiting = total, with a note that the meter is final for regulated rides.
  - Only «Завершить поездку окончательно» calls complete; «Назад» returns to navigation.
- Driver rates the passenger:
  - After completion, `RatePassengerSheet` asks for 1–5★ plus an optional comment (`POST /api/v1/driver/bookings/[id]/rate-passenger`). New table `PassengerRating`, migration `20261115030000_passenger_rating`. Once per ride, completing driver only, COMPLETED only.
  - Admin «Клиенты» shows ★ average (count).
- Server code: `src/server/trip-close.ts`. Tests: `tests/trip-close.db.test.ts` (the preview equals the recorded waiting; rating rules).
- Playwright check (local, driver andreas, booking with a stop):
  - car rotation ≈0° on the heading-up map;
  - the panel collapses while the action stays visible;
  - the fare sheet appears while still IN_PROGRESS, and «окончательно» moves it to COMPLETED;
  - rated the passenger 4★;
  - no errors.

## 2026-11-15 — Finished ride: map on the destination + 5-star rating on the track screen
- TrackApp: when COMPLETED, the map marker/fit is the destination (as during IN_PROGRESS), not the pickup.
- 5-star rating right on the finished screen. `RateTripModal` gained `inline` and `postUrl` props: stars, then tags (positive for 4–5, constructive for 1–3) and an optional comment.
- New `POST /api/v1/tracking/rating`: FULL tracking session only; rates for the booking's passenger account via `rateTrip`. `trackingView` returns `myRating`; once rated, the screen shows «Ваша оценка: ★★★★★».
- Playwright check (local, completed test ride): the map shows the destination marker, not the pickup; rated 5★ + «Вовремя»; after reload it is still rated and the card is gone; no errors.

## 2026-11-15 — Address rows: ≡ handles on the right; × reset in the top-right
- Drag handles moved to the right of each row (after the stop's remove ×).
- New × (top-right of the address block, `resetRoute`) appears once the route has been touched. It clears the destination and stop, closes «Откуда» (only «Куда» left) and restores the auto-detected pickup (`autoPickupSaved`). i18n `booking.form.resetRoute`.
- Playwright check: handle is right of the field; after × only «Куда» remains and it is empty; no errors.

## 2026-11-15 — Stop waiting priced like the taximeter
- Owner decision: paid waiting at the stop is calculated the same way as the taximeter's waiting and added on top of the fare.
- `meterWaitingCents(start, end)` in `src/lib/tariff.ts`: urban waiting tariff €17.00/h day (06:01–20:30) and €19.00/h night (20:31–06:00), Europe/Nicosia. Accrued per second, split at the minute boundaries, rounded once.
- Used by `stopWaitCentsFor` (lifecycle). The driver meter shows the live amount and «По тарифу таксометра: N € в час».
- `DISPATCH_WAITING_RATE_CENTS_PER_MIN` is no longer used for the stop; it still governs pickup waiting, which stays 0/disabled by default.
- Research doc updated. Tests: `tests/tariff-waiting.test.ts` (day/night hour, 20:30 boundary, per-second).

## 2026-11-15 — Removed the «Используем ваше текущее местоположение…» hint under «Откуда»
- Owner request. The auto-filled pickup still works; only the hint line is gone.

## 2026-11-15 — Booking form rework + one intermediate stop (end-to-end)
- **Passenger form** (`BookingApp`):
  - Only «Куда» is shown at first. Touching it (or choosing a destination) reveals «Откуда» above it, auto-filled from the device.
  - Each address field has «⌖ На карте» inside on the right (`PlacesInput.trailing`).
  - «＋ Добавить остановку» adds one stop field; × removes it.
  - Every row has a ≡ handle: drag it up/down to reorder the route. Values move; roles follow position (first = from, middle = stop, last = to).
  - The map pickers support `kind 'stop'`.
  - Route preview (`/routes/estimate` `via`), quote (`stop`) and booking (`stop`) all go through the stop. The review shows the stop.
- **Server:**
  - Migration `20261115020000_booking_stop` adds Booking.stopLat/Lng/Label, stopArrivedAt, stopWaitStartedAt, stopDepartedAt, stopWaitCents.
  - `createBookingSchema.stop` is optional; the stop must be inside the service area; the idempotency hash includes it only when present.
  - Quote: `QuoteInput.stop`; the hash adds `s` only when present; `googleRoute(..., { via })` uses Routes API `intermediates`; the fallback distance goes through the stop.
- **Driver:**
  - `POST /api/v1/driver/bookings/[id]/stop {action: arrived|wait|continue}` → `driverStopAction` (lifecycle.ts). Allowed only IN_PROGRESS; the status stays IN_PROGRESS.
  - Stop waiting is a meter at `DISPATCH_WAITING_RATE_CENTS_PER_MIN` (no grace). `stopWaitCents` is added to `Fare.waitingCents` at completion (`closeStopWaiting`).
  - DriverNavigation legs are pickup → stop → dropoff (server `/driver/navigation` targets the stop too). Buttons: «Прибыл на остановку» → «Включить платное ожидание» (live meter) + «Продолжить к конечной точке» → «Завершить поездку». «Через остановку» is shown on the pickup leg; offers and free orders show the stop.
- **Passenger tracking:** a stop row plus «Водитель на остановке» / «идёт платное ожидание»; stop marker (yellow). Admin booking detail: Stop row with the waiting amount. Receipt shows the stop.
- **Also:** map containers have `isolation: isolate` so marker z-indexes never cover panels.
- **Waiting rate:** `DISPATCH_WAITING_RATE_CENTS_PER_MIN` defaults to 0. Prod value unknown — the owner was asked for the rate.
- **Tests:** `tests/booking-stop.db.test.ts`; suite 221 passed / 1 skipped.
- **Playwright:**
  - form: only «Куда» → tap shows «Откуда» → add stop → drag reorder works → the quote and booking carry the stop;
  - driver UI: on the way → arrived → start (code) → «К остановке» → arrived at stop → paid waiting meter → continue → complete → COMPLETED.

## 2026-11-15 — Cars 15% smaller
- Single vehicle 84→71 px (carMarker default); fleet overlays 72→61 px (MapView + GoogleMapView).

## 2026-11-15 — Car palette per owner: own car model, white fleet, yellow busy on admin
- `carMarker.ts`:
  - driver's own car (`state 'self'`) is a new original model `selfCarSvg`: silver-white gradient body, dark glossy cabin, red tail-light bar, no lime glow; still zIndex 1000;
  - every other car is white (#FFFFFF);
  - on-trip (`busy`) cars are yellow (#FFC83D), used only on the staff/dispatch map (`MapMarker.busy`); plate tags take the same colour.
- Fleet overlays (passenger home, driver home) always render white: MapView/GoogleMapView fleet now use `state: 'available'`.
- Checked: standalone render of self + white + white-with-plate + yellow-with-plate.

## 2026-11-15 — Passenger «you are here» marker + opt-in location sharing with the driver
- Map: new `MapMarker.kind 'person'` (`personMarkerEl` in carMarker.ts: a blue disc with a figure, centred) on both MapView and GoogleMapView. `fitKeyOf` (`src/components/mapFit.ts`) ignores moving markers (vehicle, person), so they never re-fit the map; MapLibre now fits only when the fixed points change.
- `src/components/useLiveLocation.ts`: watchPosition while the page is visible; only if permission is already granted unless `prompt`.
  - Home: a person marker «Вы здесь».
  - Track: a person marker before IN_PROGRESS.
- Opt-in sharing (only the FULL tracking session; never a share link): `ShareLocationToggle` on the track screen, «Показать водителю, где я», shown only for ASSIGNED / EN_ROUTE / ARRIVED.
  - Sends every 10 s to `POST /api/v1/tracking/location`; DELETE when switched off or after pickup.
  - Not automatic, because the booker may order for someone else.
- DB: migration `20261115010000_booking_passenger_location` adds Booking.passengerLat/Lng/LocAccuracyM/LocAt.
- `src/server/passenger-location.ts`:
  - saves only pre-pickup;
  - `passengerLocationForDriver` returns only pre-pickup fixes younger than 60 s;
  - the worker `purgePassengerLocations` wipes positions after pickup, at ride end, or after 5 min.
- Driver: `driverCurrentTrip` includes `passengerLocation`. DriverNavigation shows a person marker plus «🧍 Клиент делится местоположением: в N м от точки подачи» (or «на точке подачи» if ≤30 m).
- Privacy page: paragraph added.
- Tests: `tests/passenger-location.db.test.ts`.
- Playwright end-to-end (local): the passenger 120 m from pickup turns sharing on → the driver sees the marker and «в 123 м от точки подачи» → switched off → the driver line disappears. No errors.

## 2026-11-14 — FIX: cars drawn on the neighbouring street (Google map anchor)
- Google `AdvancedMarkerElement` anchors content at the bottom-centre. Our cars and dots are centred, so every Google marker was drawn half its height north of its real position. After the ×2 car size, the 84 px own car sat 42 px off: correct when zoomed in, the next street at normal zoom.
- `centerOnPoint()` in GoogleMapView (`translateY(50%)`) is applied to vehicle, pickup/dropoff and fleet markers; the picker's blue device dot gets the same.
- MapLibre (local) already anchors at the centre, so this never reproduced locally.

## 2026-11-14 — Driver GPS quality: filter, coarse-mode retry, accuracy badge
- `src/lib/gpsFilter.ts` (pure, unit-tested in `tests/gps-filter.test.ts`). It decides which raw fix becomes the driver's position, i.e. what is sent to `/driver/location` and drawn:
  - a poor fix (>50 m) is ignored while a good fix is younger than 30 s; otherwise a rough fix is still used;
  - a jump of >60 m at >50 m/s is ignored unless 3 in a row agree.
- `driver/page.tsx`:
  - The watch callback runs the filter.
  - The coarse fallback (`enableHighAccuracy: false` after a high-accuracy error) used to be permanent; now it retries precise GPS every 30 s (`retryTimer`, `highModeRef`).
  - The GPS pill shows a raw-accuracy badge «±N м»: green ≤20, amber ≤50, red >50 + «слабый сигнал». i18n `driver.home.gpsM` and `gpsWeak`.
- Not done: snapping to the road outside navigation (Google Roads API, paid). Navigation already snaps to the route within 30 m.
- Playwright (local, driver andreas): good ±8 м → a 300 m-away ±180 fix showed the red badge, and the samples sent stayed at the good position → ±9 м. No errors.

## 2026-11-14 — Driver navigation: map movable while driving
- The follow camera (DriverNavigation) used to be broken only by Google/MapLibre `dragstart`. A pinch or wheel zoom never broke it, and every GPS fix re-applied zoom 17 and the heading, so while moving the map could not be zoomed or moved.
- `useIdleReturn` now takes `{onStart, onReturn}`. Any pointerdown or wheel on the map calls `onFollowBreak` immediately, and the follow effect is skipped while a gesture is active.
- New map prop `onIdleReturn`. DriverNavigation passes `idleReturnMs={4000}` and `onIdleReturn={() => setFollowing(true)}`, so follow resumes 4 s after the last gesture. The «К моей позиции» button still works manually.
- Playwright (local, driver andreas with an assigned test trip, GPS moving every 1 s): a gesture on the map shows «К моей позиции» and the view stays free through 3 s of driving; at ~6 s follow has resumed. No errors.

## 2026-11-14 — Driver map: free pan/zoom, auto-return after 4 s idle
- Root cause: the camera re-framed on every GPS fix. The focus effect is keyed on position, and MapLibre also re-fits on every markers change.
- `src/components/useIdleReturn.ts`: pointer/wheel listeners on the map container.
  - While a gesture is in progress, and for N ms after the last one, `active` is set and the automatic camera effects (fit, focus) are skipped.
  - Then `returnTick` increments and those effects re-run, restoring the default view.
- New prop `idleReturnMs` on MapView/GoogleMapView (via AutoMapView). DriverHomeMap (fullscreen and card) uses 4000.
- The passenger maps are unchanged (no prop). The navigation follow camera is unchanged.
- Playwright (local MapLibre, driver andreas with GPS): own car at (153,290) → dragged to (-7,130) → a new GPS fix 2 s later did not snap the view → at ~5.5 s back to (153,290). No errors.

## 2026-11-14 — Passenger back arrow = one step back; profile settings grouped into categories
- `src/lib/navTrail.ts` keeps a per-tab trail of passenger URLs in sessionStorage. It is recorded by PassengerTopBar and the home BookingApp (on mount + pageshow).
  - ‹ pops the trail and calls `history.back()`. A deep link or new tab goes to the fallback.
  - If the page was left through the account menu (`markLeftViaMenu`), coming back reopens the menu (`consumeMenuReopen`).
- /account is now collapsible categories (one open at a time): Личные данные, Пароль и вход, Сохранённые места, Уведомления, Ваши данные. Выйти stays separate. `#places` (and other ids) open that category, including on hashchange. New i18n keys `auth.cat.*` (en/ru/el).
- Playwright (iPhone 13, local build):
  - home → menu → settings → ‹ gives home with the menu open;
  - home → rides → settings → ‹ gives rides with the menu open; ‹ again gives home;
  - a deep link ‹ gives home;
  - categories expand; `#places` opens places;
  - no errors.

## 2026-11-14 — Cars ×2; driver's own car darker and on top
- Car marker sizes doubled: single vehicle 42→84 px; fleet 36→72 px (MapView + GoogleMapView).
- New `VehicleState 'self'`: slate-teal body (#4E6A72) with a lime roof light and a soft lime glow, darker than the pearl fleet cars.
- `MapMarker.self` marks the driver's own car (DriverHomeMap and DriverNavigation `id: 'me'`).
- Z-order: self z-index 1000 (MapLibre element style, Google AdvancedMarkerElement `zIndex`); fleet zIndex 1. The own car stays above others at any zoom.
- Checked: a standalone render of an overlapping self + fleet car shows self on top and darker. The local driver map could not show cars (no GPS share, no fresh fleet in the test DB).

## 2026-11-14 — Passenger pages: shared top bar with back arrow
- New `src/components/PassengerTopBar.tsx`: ‹ back arrow, logo (→ /), compact LanguageSwitcher, and the AccountMenu avatar (initial), or «Войти» when signed out.
  - Back uses `history.back()` when the referrer is same-origin; otherwise it goes to the fallback href (default /, /rides for a receipt).
  - Sticky at the top.
- Used on /account, /rides, /rides/[id], /prebookings, /privacy, /terms, and /track (the live view and the "no ride" / error screens).
- The home screen keeps its own header (logo, language, avatar). Login/register keep their in-card logo, language switcher and back link.
- Playwright (iPhone 13, local build, signed in): all 6 pages show back, logo, language and avatar. Back from /account returns to /. No errors.

## 2026-11-14 — Car markers: bigger, new palette, plate labels on staff maps
- `src/components/carMarker.ts`: a generic sedan.
  - Third-party hood emblem removed.
  - Free: pearl-white body (#F4F2EC) with a lime roof light. On a trip: soft slate (#9AA7B4). Neutral shadow instead of the lime glow.
  - Sizes: single vehicle default 34→42 px; fleet markers 28→36 px (MapView + GoogleMapView).
  - New `tag` option renders a plate label under the car.
- `MapMarker` has new `tag` and `busy` fields. GoogleMapView re-renders a vehicle when its tag or busy state changes (`dataset.sig`).
- `fleet()` (`src/server/views.ts`) now returns `plate` from the active DriverVehicleBinding. The dispatch map shows the plate under each car (falls back to the name), busy cars in slate, and the title "PLATE · Name".
- Checked: tsc and build OK. Admin map DOM shows the KXY 248 / MCE 512 / VAN 900 labels; a standalone close-up of the marker variants looks right.

## 2026-11-14 — Drivers/staff can change their own password
- `POST /api/v1/auth/password` takes `{current, next}` and checks the current password. It is rate-limited to 10 per 10 min.
- On success it bumps `sessionVersion` (signs out every other device), re-issues this device's session and writes the AuditEvent `CHANGE_OWN_PASSWORD`.
- UI: `src/components/StaffPasswordForm.tsx` («Сменить пароль»). It is in the driver app under Профиль (bottom) and on /staff/security for admin/dispatcher.
- Drivers sign in either by SMS code (/driver/login) or by login + password (/staff/login, which redirects to /driver). The password matters for the second way.
- Tests: `tests/staff-password.db.test.ts`. Playwright check (local build, iPhone 13, driver andreas): the change works, this device stays signed in, and the new password logs in.

## 2026-11-14 — Readable temporary passwords for clients
- `readablePassword()` in `src/server/admin-passengers.ts`: format `XXXX-XXXX-XXXX` from an alphabet without 0/O/1/l/I (~69 bits of entropy).
- The admin page shows it large, in monospace, with a hint to copy it or type it with the dashes.
- Reason: the owner typed a temp password by hand and mixed up l/1/0.
- Known flaky DB tests (dispatch offers / fare-breakdown), which depend on leftover test-DB state: a different 1–3 fail per run; unrelated to this change.

## 2026-11-14 — Admin client details + password reset; client password change
- In admin «Клиенты», expanding a client shows the full profile: ID, name, login (email), phone and its verification, whether a password is set, signed-in device count, last sign-in, last update, saved places, then their rides.
- Passwords are bcrypt hashes and cannot be shown. The admin can «Сбросить пароль» instead:
  - `POST /api/v1/admin/passengers/[id]/reset-password` returns a temporary password once;
  - all the client's sessions are revoked;
  - an AuditEvent `RESET_PASSENGER_PASSWORD` is written, without the password.
- Client side: the /account page has «Сменить пароль» (or «Задать пароль» if the account has none). `POST /api/v1/passenger/password` checks the current password and is rate-limited. `/passenger/me` now returns `hasPassword`.
- Tests: `tests/admin-passengers.db.test.ts` (+ reset). Playwright end-to-end on a local build: register → admin resets → old session gives 401 → sign-in with the temporary password → change the password in the account. All OK, no page errors.

## 2026-11-14 — Bottom sheet: swipe on the form body too
- Native touch listeners (`passive: false`) are attached to the sheet body (`contentRef`).
- Collapsed: any vertical swipe moves the sheet.
- Expanded: a downward pull while the form is at scrollTop 0 collapses it; otherwise the form scrolls normally. Taps on inputs are unaffected.
- The handle still works.
- Checked with Playwright CDP touch on iPhone 13: a swipe up on the title expands (170→452). A pull down while scrolled only scrolls to the top; the next pull collapses (452→170). Tapping an input expands. No errors.

## 2026-11-14 — Passenger home: draggable bottom sheet (mobile)
- On phones (<640px) the booking panel is a bottom sheet with two snap points, both changed by dragging the handle (pointer events, `touch-none`):
  - full height of the area under the header;
  - collapsed peek strip `PEEK_PX=170` (+ safe area), showing «Куда едем?» and the top of the form. Phones open collapsed.
- Tapping the handle toggles the sheet. Focusing any input expands it. A non-form step (review/done) expands it. The CTA is shown only when the sheet is expanded.
- Desktop keeps the side panel with the collapse/expand button.
- Checked with Playwright on iPhone 13 (local build): heights are 170 → 452 (full) → 170, and focusing an input gives full height. No page errors.

## 2026-11-14 — Admin «Клиенты» (passenger accounts)
- New page `/admin/passengers` (nav «Клиенты», ADMIN only). It shows passenger accounts with name, phone, email, registration date, last sign-in, and ride counts (total / completed / canceled).
- Search by name, phone or email; the newest 200 are shown. Clicking a client lists their rides, each linking to `/dispatch/bookings/[id]`.
- Server code is in `src/server/admin-passengers.ts`. API: `GET /api/v1/admin/passengers?q=` and `GET /api/v1/admin/passengers/[id]`.
- Rides made without an account (legacy or anonymous, `passengerId` null) are not listed here; they are only in the dispatch queue.
- StaffShell header no longer squeezes the logo.
- Tests: `tests/admin-passengers.db.test.ts`; the suite is at 210 passed / 1 skipped. Playwright (local build, RU): list, expand and links work, no page errors.

## 2026-11-14 — Passenger home: map is the background again, collapsible booking panel
- `BookingApp`: the map (with the live fleet) is always shown behind the booking form. The plain logo background from 2026-11-13 is removed.
- The panel has a handle button at the top: «Свернуть ▼» / a collapsed bar «Куда едем? … Развернуть ▲» (keys `booking.sheet.*` in en/ru/el). The panel re-expands on any step change.
- `fitPadding` follows the collapsed state, so the route stays visible.
- Checked with Playwright (iPhone 13 and desktop, local build): collapse and expand work, no page errors. The config-error banner in local screenshots comes from the local environment.

## 2026-11-14 — Admin/dispatch consoles localized (RU)
- New i18n namespace `staff` (`src/i18n/messages/{en,ru}/staff.ts`; `el` reuses English for now).
- Translated: StaffShell nav and role, StatusBadge (`statusLabel()` helper), dispatch queue and booking detail, admin drivers/vehicles/settings/applications (+detail)/reliability/analytics, staff/security, useDialog default Cancel, and ConfirmSheet validation.
- StaffShell header now has a compact LanguageSwitcher (EN/ΕΛ/РУ). The choice is saved in the `lang` cookie, so an admin picks РУ once.
- Dates in these pages now use `fmt` (Europe/Nicosia, locale-aware) instead of hardcoded en-GB.
- Checks: tsc and eslint clean (warnings only, all pre-existing); vitest 209 passed / 1 skipped; build OK. Playwright with the `lang=ru` cookie on a local build: all 8 staff pages render in Russian with no page errors.

## Passenger "My pre-bookings" + 1-hour reminder (2026-11-13)
- New page `/prebookings` ("My pre-bookings"; account menu item under "My rides"):
  - Upcoming scheduled rides, soonest first: time, from/to, note, "Driver: <name>" once a driver pre-booked it.
  - Rides within the hour are highlighted. "Open" mints a tracking grant and opens /track.
  - Account-wide notifications toggle; "Order another" link.
  - API `GET /api/v1/passenger/prebookings` (own rides, active statuses, `soon` = pickup within 60 min).
- Home reminder: for a signed-in passenger, the booking form shows an accent card "Your pre-booked ride soon · Pickup at HH:MM · from → to · Open" when a pre-booking is within the hour (polled every 60 s).
- Push reminder: `runPassengerReminders` (`src/server/dispatch/passenger-reminders.ts`) runs each worker tick after `runPreassignments`. For rides with pickup in (now, now+60 min], an active status and `passengerRemindedAt` null, it claims the column (conditional update) and enqueues one push (dedupe `passenger-remind:<id>`, url /prebookings). Migration `20261113010000_booking_passenger_reminder`.
- Account-wide passenger push:
  - `POST /api/v1/passenger/push` saves `PASSENGER_ACCOUNT:<passengerId>`.
  - `/tracking/push` saves the account audience when the tracked ride belongs to the signed-in passenger; others stay per-ride.
  - `deliverToAudience` uses `audiencesFor()`, so `PASSENGER:<bookingId>` also reaches the owner's account devices. This fixes "subscribing for ride B stopped pushes for ride A", since an endpoint holds one audience.
- The "Pre-booking placed" screen has the notifications toggle (account audience).
- Push texts are English, like the other passenger pushes.
- Tests: `tests/passenger-prebookings.db.test.ts` (3): list order and soon flag, reminder exactly once only within the hour and not for cancelled, account audience. Suite 209/1 skipped ×2. Playwright: home card, menu item, /prebookings.

## Passenger can keep ordering after a pre-booking (2026-11-13)
- The server never limited a passenger to one booking. Checked: pre-booking, then NOW, then another pre-booking, all 201.
- The UI used to jump to /track right after a pre-booking. Now `BookingApp` shows a "Pre-booking placed" step: pickup time (Cyprus), a short note, "Order another ride" (`orderAnother()` resets the form and the idempotency key), "My rides" and "Open pre-booking" (/track). Immediate rides still go to /track.
- /track for a pre-booking (REQUESTED) has a "＋ New order" button.
- Playwright: full UI pre-booking → done screen → order another (empty form) → /track shows New order.
- Pre-bookings will later be paid by card (no payment code yet; nothing promised in the UI).

## Show/hide password everywhere (2026-11-13)
- `src/components/PasswordInput.tsx`: a drop-in for `<input type="password">` with an eye button that toggles show/hide. It has aria-label/aria-pressed and en/ru/el strings `common.showPassword` / `common.hidePassword`; margin classes move to the wrapper.
- Used on all password fields: passenger /login, /register, the passenger login modal on the booking page, /staff/login, /staff/security. Driver login uses an SMS code, so it has no password field.

## Pre-bookings: review before taking (2026-11-13)
- Pre-booking cards (Open and Accepted) have a "View" button instead of Take/Release. It opens `ScheduledDetail` (in `ScheduledRides.tsx`):
  - Full-screen map with pickup and destination markers and the trip route line.
  - Sheet: pickup date/time, airport and class chips, from/to, client name, trip km and min ("≈" when not road-routed), fare (meter/upfront), passenger note, flight if any, this ride's free-until / active-at times.
  - "Fare details" collapsible; sticky "‹ Back" plus "Take ride" (open; disabled on conflict or blocked) or "Release" (accepted, with the existing confirm sheet).
  - After taking, the view switches to Accepted.
- `GET /api/v1/driver/scheduled/[id]` (driver-only, 30/min) → `scheduledRideDetail` in `preassign.ts`. Only rides on this driver's board (available to them, or their own). It adds the passenger name, fare breakdown, coordinates and the trip route (`googleRoute` with a 2.5 s timeout, else straight-line at ~50 km/h). Never the phone. The board list itself still has no passenger identity.
- Test: `preassign.db` +1 (detail fields, mine flag after claim, other driver gets null). Suite 206/1 skipped.

## Driver home: no status/plate pill (2026-11-13)
- Removed the "On duty · waiting for orders · plate" pill from the Home map. The Go online / Go offline button shows the state. The earnings figure stays at top-right; the plate is in Profile.

## Driver: separate Free / Pre-bookings tabs, red count badges (2026-11-13)
- Bottom nav is 4 tabs: Home | Free | Pre-bookings | Profile. The merged "Orders" tab was split again.
- Small red count badges (`bg-danger`) on Free (free orders, polled every 10 s while on duty and without a trip) and on Pre-bookings (open scheduled rides without a conflict, polled every 30 s from `/driver/scheduled`).
- `ScheduledRides` has its own switch: "Open pre-bookings" (with a red count) and "Accepted" (the driver's own commitments, with a neutral count). It defaults to Open.

## Driver: trips & earnings inside Profile; earnings figure on the map (2026-11-13)
- Bottom nav is 3 tabs: Home | Orders | Profile. Profile has a `SubTabs` switch: Profile | Trips | Earnings. The separate "Trips & earnings" tab is gone.
- Home map: a pill at top-right shows today's recorded earnings (`dash.today.recordedEarnings`, "0,00 €" when none) and the label "earned today". Tapping it opens Profile › Earnings.

## Pre-booking cards: per-ride time rules + passenger note (2026-11-13)
- Removed the general explanation paragraph from the top of the driver's Pre-bookings view.
- Each pre-booking card now shows that ride's own times: "Until HH:MM you're free for other rides (pickup −75 min)" and "At HH:MM it becomes your active ride if online and free, else automatic dispatch (pickup −30 min)". The times come from `PROTECT_MIN` / `CONVERT_MIN` in Cyprus time.
- Cards now also show the passenger's note ("💬 …"). Passengers write the flight number, meeting point and bags there. `BoardItem.note` was added for available rides; own rides already had it.

## Driver tabs merged (2026-11-13)
- Bottom nav is now 4 tabs: Home | Orders (`tab 'free'`) | Trips & earnings (`tab 'trips'`) | Profile.
- Orders has a `SubTabs` switch: "Free · N" (FreeOrdersSection) and "Pre-bookings · N" (ScheduledRides; moved out of the Trips tab). The badge still shows the free-orders count.
- Trips & earnings has a switch: "Trips" (history only; the old History/Pre-book toggle was removed) and "Earnings".

## Pre-booking = note only (2026-11-13, later the same night)
- Removed the passengers and bags steppers from the pre-booking form. Every ride is sent as 1 passenger and 0 bags; the car class covers size.
- The only pre-booking extra is the note. Its placeholder is "Flight number, meeting point, number of bags…".
- `Booking.luggageCount` and the driver "🧳 N" display remain; they now only show for API/other clients that send bags.

## Passenger maps: no background map until a route is chosen (2026-11-13)
- Booking page: no background map (and no fleet polling) until BOTH pickup and destination are set (`showMap`). Before that the background is a branded gradient with the logo. Once both stops are set, the map appears with the chosen route and the nearby cars, as before. The "set on map" picker still opens its own map.
- Tracking page: the route line now also shows the ride the passenger chose (pickup→destination) while there is no moving driver: REQUESTED / SEARCHING (incl. the free-orders board) / NO_DRIVER, ARRIVED, or a driver without a fix. Then driver→pickup (ASSIGNED/EN_ROUTE) and driver→destination (IN_PROGRESS), as before.
- Locally `/routes/estimate` (demo, no Google) returns no path, so the line only draws on prod. Checked that the request is made.

## Booking form: extras only for pre-bookings, bags, flight required (2026-11-13)
- Passenger booking form: the "Additional" block (passengers + note) is gone for immediate rides. They are sent as 1 passenger, 0 bags, no note, no flight.
- Pre-booking ("Schedule") now has a details panel under the date:
  - (Flight number field removed again on 2026-11-13. The passenger writes the flight number and meeting point in the note; the placeholder says so. The server still accepts an optional `flightNumber` from other clients.)
  - Passengers stepper and bags stepper (0–10).
  - Optional note.
- The review step shows passengers (pre-booking only), bags (if > 0) and the note.
- New `Booking.luggageCount INT NOT NULL DEFAULT 0` (migration `20261113000000_booking_luggage`), stored from `createBooking`. It does not affect price.
- Bags are shown to the driver as "🧳 N" (when > 0) in the offer, the Free list and details, and the trip/navigation header. Fields come from `views.ts`, `offers.ts` and `free-orders.ts`.
- Test: free-orders.db detail asserts luggageCount stored and exposed. Suite 205/1 skipped.

## Free orders: review before taking (2026-11-12)
- The Free tab list no longer has a direct "Take" button. Each card has "View", which opens `FreeOrderDetailView`, built like a new offer:
  - Full-screen map with the driver's car and the client (pickup), padded above the sheet by `sheetFitPadding()` (~60% of screen height + nav).
  - Sheet: board countdown, big "N min · X km to the client" (road-routed; "approximate" note when the router is unavailable), pickup, To, Client (name, pax, class), Fare, note, flight, schedule.
  - "Fare details" collapsible; sticky "‹ Back" / "Take ride".
  - If the ride disappears (taken, expired, or the countdown hits 0) the view returns to the list with ORDER_GONE.
- `GET /api/v1/driver/free-orders/[id]` (driver-only, 30/min, because each view may road-route) → `getFreeOrderDetail`. It returns only rides on the board that fit the driver's car. It adds the fare breakdown and road ETA/distance from the driver's last fix (Google, 2.5 s timeout, else straight-line at ~40 km/h). No phone.
- The new-offer map uses the same `sheetFitPadding()`. Checked: both markers are above the sheet.
- The "new offer" bar on other tabs is now `relative z-20`, so it shows above full-screen maps.
- Tests: free-orders.db +1 (detail rules + HTTP 404); its beforeEach cancels leftover SEARCHING rides so runOnce is deterministic. Suite 205/1 skipped ×3.

## New-offer view: client on the map, time + km first (2026-11-12)
- On a new offer the driver Home map shows the pickup (client) marker together with the driver's car. The map is framed with `fitPadding` so both stay clear of the offer sheet; fleet cars are hidden while an offer is open.
- Offer sheet order:
  1. Big "N min · X km to the client" and the pickup address.
  2. "To", "Client" (name, pax, class), "Fare" (total + meter/upfront), plus schedule, note and flight when present.
  3. "Fare details" collapsible: breakdown, meter note, phone-after-accept note.
  4. Sticky Decline/Accept.
- `pickupDistanceM` is now the DRIVING distance when the pickup ETA was road-routed: `Candidate.roadDistanceMeters` from `googleRoute.distanceKm`. Straight-line is only the fallback.
- Test: `tests/offer-distance.db.test.ts` mocks the router (2.4 km / 6 min) and checks the offer stores 2400 m / 360 s.

## Driver home = full-screen map + floating controls (2026-11-12)
- Home tab (no active trip) renders `DriverHomeMap fullscreen` (fixed, z-0) behind the sticky header (z-30) and the bottom nav (z-40). Overlays are z-10, each control a single floating element:
  - Top-left: status pill (dot + on/off duty · plate). Under it: banner, blocker, warning, GPS error or "turn on GPS" hint, then the install prompt.
  - Right-aligned under those: "📍 GPS on / Turn on GPS" toggle and the notifications toggle. They sit in the same column, so nothing overlaps; an earlier fixed right column was covered by the install prompt.
  - Bottom: available/busy cars count pill and a big "Go online / Go offline" button, or the "can't go online" pill.
  - A new offer replaces the bottom controls with the offer card as a sheet (scrolls, max-h 100dvh−200px). Decline/Accept are sticky at its bottom, verified clickable.
- Status strings in the catalog start with "●"; the pill strips it and draws its own dot.

## Driver home: today's figures moved to Earnings (2026-11-12)
- Removed the three "today" tiles (earnings, completed, online time) from the driver Home tab.
- The Earnings tab now opens with two tiles for the selected period (today / week / month): "Completed trips" and "Time online". They come from `summary.completedTrips` and `summary.onlineSeconds` of `/driver/earnings`. The earnings card is below them, as before.

## Search flow v2: offers → free-orders board 2 min → NO_DRIVER (2026-11-12)
Supersedes the first free-orders version (board of NO_DRIVER rides for 30 min).
- Worker `processJob`:
  - Offers go to eligible nearby drivers one by one (10 s each).
  - When no candidate is left (all tried, or nobody on duty), or the offering-phase deadline (180 s) passes, the job is OPENED: `DispatchJob.openedAt` is set and `deadlineAt` becomes now + `FREE_BOARD_SEC` (120). An OPENED_TO_FREE_BOARD event is recorded.
  - The booking stays SEARCHING, so the passenger still sees "finding a driver". No more automatic offers are sent.
  - When the board deadline passes → NO_DRIVER. The passenger re-orders with the existing retry.
  - A scheduled ride searched ahead of its time is not opened early; it opens at its deadline.
  - Migration `20261112190000_dispatch_open_board`: nullable column plus index.
- Board (`src/server/dispatch/free-orders.ts`) lists open, unexpired jobs.
  - Class rule `vehicleFits`: COMFORT rides fit COMFORT and XL cars; XL rides fit XL only; seats ≥ passengers.
  - Shows the passenger name and `expiresInMs` (server clock). The phone only after taking.
  - The driver who declined the offer can still see and take it from the board.
- `claimFreeOrder` requires SEARCHING + an open, unexpired job + no live offer under the booking lock. It deletes the job, then ASSIGNED → EN_ROUTE.
- Driver UI: card shows the name, an "N s left" countdown, and hides the card at 0.
- Tests: free-orders.db (9) and dispatch.db, updated for the open phase plus a new deadline-opens-board case. Suite 203/1 skipped ×2. Playwright: the real worker offers to Maria, she declines, the ride appears on her Free tab with name and countdown.

## Driver "Free orders" tab (2026-11-12)
- New driver tab "Free" (`FreeOrdersSection` in `src/app/driver/page.tsx`). The badge shows the count, polled every 10 s while on duty.
- A ride appears ONLY after automatic dispatch offered it to the free drivers nearby and nobody accepted before the search deadline: status NO_DRIVER, changed within `FREE_ORDER_WINDOW_MIN` = 30 min. It must also fit the driver's bound vehicle (class, seats). Sorted by straight-line distance from the driver's last fix.
- The list carries no passenger name or phone; those are revealed after taking, as with offers.
- `GET /api/v1/driver/free-orders` and `POST /api/v1/driver/free-orders/[id]/claim` (driver-only, claim 20/min). Logic in `src/server/dispatch/free-orders.ts`.
- `claimFreeOrder` locks the booking row and re-checks it is still NO_DRIVER and inside the window. It then re-checks the driver: on duty, can work, not busy, no open offer, not protected for a pre-booked ride. It also re-checks the vehicle.
- On success it creates the assignment, sets ASSIGNED → EN_ROUTE (same as an accepted offer), audits FREE_ORDER_CLAIMED + STATUS_EN_ROUTE, and notifies the passenger.
- If the passenger retries the search or cancels first, the claim is refused (ORDER_GONE). Two drivers racing: exactly one wins.
- Tests: `tests/free-orders.db.test.ts` (5). Suite 198/1 skipped, two consecutive runs. Playwright: tab, badge and take → EN_ROUTE.

## Driver home: no trip list (2026-11-12)
- Removed the "Last trips" card from the driver Home tab. Trip history is in the Trips tab only (today / week / month, details, pre-book).
- Driver home map without a GPS fix: zoom 8 (whole island) instead of 9, so coastal cars (e.g. Limassol) are in view on the small map.

## Driver home map with other cars (2026-11-12)
- Driver Home tab (when not on a trip) starts with `DriverHomeMap` (`src/components/driver/DriverHomeMap.tsx`).
  - Shows the driver's own car from the live GPS fix, when sharing is on.
  - Shows the other on-duty cars, available (lime) or busy (grey), with counts below the map.
  - Without GPS it shows a hint to turn sharing on.
- `GET /api/v1/driver/fleet` (driver-only, 30/min): the same anonymised view as `/public/fleet` (lat, lng, stale, state; no ids, names or plates), minus the requesting driver (`publicFleet({ excludeDriverId })`). Polled every 10 s while visible.
- The MapLibre fallback (no Google key) now also draws the `fleet` overlay, as GoogleMapView already did.
- Tests: `tests/driver-fleet.db.test.ts`: own car excluded, no identifying fields, driver-only. Suite 193/1 skipped.

## Portrait-only passenger and driver apps (2026-11-12)
- Both manifests set `"orientation": "portrait"`, which installed Android apps honour.
- `src/components/PortraitLock.tsx` (in the root layout) calls `screen.orientation.lock('portrait')` best-effort. It also renders a full-screen "Turn your phone upright" cover.
- The cover appears through CSS only (`.portrait-lock` in globals.css): landscape AND height ≤ 500px AND coarse pointer. That matches phones held sideways, never tablets or desktops.
- iPhone has no web orientation lock, so the cover is the mechanism there.
- Excluded: /dispatch, /admin, /staff.
- Checked with Playwright: iPhone and Pixel landscape show the cover; portrait, iPad landscape, desktop and /staff/login do not.
- Caveat: drivers with landscape phone mounts must mount the phone vertically.

## Accept = on the way (2026-11-12)
- `acceptOffer` now moves the booking ASSIGNED → EN_ROUTE in the same transaction. Both steps are audited: OFFER_ACCEPTED, then STATUS_EN_ROUTE (actor DRIVER, reason "auto on accept"), plus a `booking.en_route` event. After accepting, the driver sees "Arrived" next. The "On my way" button no longer appears in this flow.
- The button remains only for rides that reach ASSIGNED another way: staff manual assignment, or scheduled pre-assignment conversion (T−30 min, when the driver may not be leaving yet).
- Tests: dispatch.db and lifecycle-guards expect EN_ROUTE after accept.
- Flaky `routes.db` "NO_VEHICLE" test fixed: it now starts with Maria off duty (other suites could leave her on duty). Three consecutive full runs on a fresh DB: 191/1 skipped.

## Driver offer: 10 s window + clock-skew fix (2026-11-12)
- Bug: drivers saw an offer with "0 s" and a disabled Accept button. The countdown used the device clock against the server `expiresAt`, so a device clock running ahead by about 20 s or more killed the offer on screen while it was still valid on the server.
- Fix: `getDriverActiveOffer` returns `expiresInMs`, the time left by the server clock. The driver app turns it into a local deadline on every 2 s poll. The server still decides expiry in `acceptOffer`.
- `OFFER_TTL_SEC` changed 20 → 10. On no answer the worker (2 s tick) expires the offer, records the driver in `triedDriverIds`, and offers the next eligible driver. This was already the behaviour; covered in `dispatch.db`.
- In practice the driver gets about 8–10 s: the offer reaches the screen by polling every 2 s or by push. If that proves too short, change `OFFER_TTL_SEC`.
- Tests: dispatch.db asserts a 10 s window; offer-detail.db asserts `expiresInMs`. Playwright check with a device clock 60 s fast: the countdown is correct and Accept is enabled.

## Passenger phone optional at sign-up (2026-11-12)
- Why: SMS isn't configured on prod, so `/register` failed with SMS_UNAVAILABLE and nobody could sign up.
- `Passenger.phone` is now nullable (migration `20261112170000_passenger_phone_optional`, DROP NOT NULL only). The unique index still applies to non-null phones.
- `POST /passenger/register`: name, email and password are required, phone is optional.
  - No phone: the account is created and signed in immediately (`created: true`).
  - Phone given and SMS works: the OTP flow is unchanged.
  - Phone given but SMS unavailable: a new account is created WITHOUT the phone (`phoneSkipped: true`). The register page then shows "Account created".
  - Security: an unverified number is never stored. Phone-OTP login finds accounts by phone, so a typed-in number could otherwise hand the account to whoever owns that number.
- Booking: an account without a phone enters the contact number in the booking form (`#bk-phone`). `POST /bookings` uses `passenger.phone ?? body.phone`.
- Account page shows "no phone". Account deletion handles a null phone.
- Tests: `tests/passenger-register.db.test.ts` (4). Full suite 191 passed / 1 skipped.
- When Twilio is configured: consider an "add/verify phone" action on /account.

## PWA install for testers (2026-11-12)
- Two installable apps from one site: passenger `public/manifest.webmanifest` (id `/`, opens `/`) and driver `public/manifest-driver.webmanifest` ("IL-Y Driver", id `/driver`, opens `/driver`), set for all `/driver*` pages by `src/app/driver/layout.tsx`. `src/proxy.ts` matcher skips the driver manifest.
- `src/components/InstallPrompt.tsx` + `src/lib/pwa.ts`: on the booking page (mobile only) and the driver Home tab. Android/Chrome shows an Install button from `beforeinstallprompt`, captured at module load. iPhone shows the Share → Add to Home Screen steps. Hidden when already installed (standalone), on desktop, and for 14 days after "Not now" (localStorage `ily.install.dismissed.<app>`).
- `NotifyToggle`: on iPhone in a Safari tab, Web Push is unavailable, so it now explains that notifications need the home-screen app instead of rendering nothing.
- Checked with Playwright on a local build (iPhone 14 / Pixel 7 with a synthetic `beforeinstallprompt` / desktop): banner text, dismiss persistence, prompt() call, no page errors. Not verified yet on physical phones.

## Auto-deploy from GitHub main (2026-11-12)
- Every push to GitHub `main` is deployed automatically. The systemd timer `taxicy-autodeploy.timer` runs every 2 min, as root, and calls `deploy/autodeploy.sh`.
- What one run does: `git fetch` (as the repo owner `claudeuser`) → fast-forward `master` to `origin/main` → `scripts/deploy.sh`, which does backup, build, health gate and rollback.
- It skips the run and does not touch the tree when: there are uncommitted tracked changes, the checkout is not on `master`, or local commits are missing from `origin/main`.
- A commit that failed to deploy is not retried. It is recorded in `/var/lib/taxicy-autodeploy/failed-sha`; the next push or `sudo rm` of that file retries.
- Telegram is notified on success and on failure (`deploy/secrets/telegram.env`).
- Logs: `journalctl -u taxicy-autodeploy`. Unit sources are in `deploy/systemd/`, installed by copying them to `/etc/systemd/system`. The service runs an installed copy `/usr/local/sbin/taxicy-autodeploy` so a merge never rewrites the running script. After editing the script, reinstall it: `sudo install -m 755 deploy/autodeploy.sh /usr/local/sbin/taxicy-autodeploy`.
- Pause: `sudo systemctl stop taxicy-autodeploy.timer`. Resume: `start`.
- Workflow: develop elsewhere and push to `main`. Do not edit this server checkout, or the next deploy is blocked.

## Driver full-screen navigation (2026-10-08)
- Once a driver accepts, `/driver` shows ONLY `src/components/driver/DriverNavigation.tsx`: no tabs, bottom nav or stats. It has a heading-up map that follows the car, a turn-by-turn banner and a compact sheet with the stage action, call, chat, Google Maps and Details (note, flight, release).
- Route: `POST /api/v1/driver/navigation` returns a Google Routes response with `legs.steps.navigationInstruction` in the driver's language (en/el/ru).
  - The target comes from the driver's own active assignment: the pickup until IN_PROGRESS, then the destination. ARRIVED returns no route.
  - The client sends its current fix and travel heading.
  - The route is refetched when off-route by more than 60 m on 2 consecutive fixes, and every 60 s for a traffic-aware ETA.
  - Rate limit: 20 requests per minute per driver.
  - With no router the API returns `available:false` and the UI offers external Google Maps. There is no simulated route.
- Pure geometry lives in `src/lib/nav.ts`: projection, next step, prompt bands and look-ahead.
- Voice prompts use `speechSynthesis`: the departure once, then 800/250/40 m. Mute is stored in localStorage.
- `follow` / `onFollowBreak` props were added to GoogleMapView and MapView. Dragging the map stops following and shows a "Re-centre" button.
- Tests: `tests/navigation.test.ts` and `tests/navigation.db.test.ts`. Playwright: `tests-e2e/driver-nav.spec.ts` with fixture `seed-nav.ts`, navigation API stubbed, run against a local build on :3065.
- Limits: this is web navigation, so the browser tab must stay open. Heading and tilt on Google need the vector map (MAP_ID). Lane guidance and speed cameras are out of scope.

## Staff dialogs + MapLibre worker fix (2026-10-08) — release 2e3ba43, DEPLOYED
- All native confirm()/prompt() in dispatch/admin replaced by in-app dialogs (`useDialog()` +
  `ConfirmSheet` with validated input). None remain in src/.
- **Regression found & fixed:** since Next 16/Turbopack the MapLibre 6 worker could not load its
  hashed shared chunk ("Worker failed to load"); the MapLibre fallback maps (no Google key) were broken
  and the dispatch map drew outside its card. Fix: `scripts/copy-maplibre-worker.mjs` (prebuild/predev)
  → `public/vendor/maplibre/<ver>/` + `setWorkerUrl` in `src/lib/maplibre.ts`. Guard:
  `tests-e2e/maps.spec.ts` (verified failing without the fix). Prod maps use Google — unaffected.
- **Lesson:** visual specs must assert rendering (canvas + no console errors), not only DOM text.
- Next (stage 3): React-Compiler react-hooks warnings refactor (36 sites); flight tracking needs a provider.

## Admin driver reliability (2026-10-08) — /admin/reliability (ADMIN)
- Per-driver counts over 7/30/90 days from Postgres: offers (accepted / rejected / missed; system-withdrawn
  excluded), completed trips, pre-pickup cancels (REMATCH by DRIVER), GPS-loss releases, pre-bookings
  (converted / releases / late releases / lapsed), ratings (avg, count, 1–2★), online hours (duty sessions).
- Flags = review prompts, never automatic sanctions (PWD human review): acceptance < 50% or missed > 30% with
  ≥ 10 offers; ≥ 2 late pre-book releases; rating < 4.0 with ≥ 5; ≥ 3 pre-pickup cancels
  (`FLAG_RULES` in `src/server/admin/reliability.ts`). Detail panel lists recent events incl. low-rating
  comments. API `GET /admin/reliability?days=`, `GET /admin/reliability/[driverId]?days=`.
- Tests: reliability.db (exact counts/flags/detail/window), routes.db (ADMIN-only). Suite 173/1 skipped;
  Playwright reliability-visual 1/1; screenshots docs/qa-screenshots/reliability.

## Task 021 — scheduled-ride pre-assignment (2026-10-05) — see Tasks/021
- Drivers pre-book scheduled rides from a board (Trips → Pre-book); worker converts 30 min before pickup
  or lapses at T−15 into normal search; protection from new immediate offers 75 min before; flight number
  for airport pickups (not live-tracked). Migration `20261005090000_preassignment_flight`.
- Suite 172/1 skipped; Playwright 20/20. Dates in the UI are now always Europe/Nicosia.
- Open: live flight-status tracking (needs a provider); admin view of late releases (events recorded).

## Next.js 16 upgrade (2026-10-02) — release 838f6c5, DEPLOYED via scripts/deploy.sh + live-verified
- next 16.3.8 (Turbopack builds), react 19.3, vitest 5, eslint-config-next 16 (native flat config).
  `src/middleware.ts` → `src/proxy.ts` (export `proxy`, Node runtime). `next build` no longer lints —
  `npm run lint` in CI is the gate. Turbopack: `turbopackIgnore` hints on runtime upload paths in
  `src/server/storage.ts`. vitest config is `vitest.config.mts` (maxWorkers:1; poolOptions removed).
- **npm audit: 0 vulnerabilities** (runtime and dev).
- **Follow-up (not done):** new React-Compiler react-hooks rules (`set-state-in-effect`, `refs`,
  `immutability`, `purity`) are WARNINGS — 36 sites (mostly load-on-mount effects, GPS/offer
  polling, imperative Google Maps markers). Refactor deliberately, with browser tests, before
  promoting them to errors or enabling `reactCompiler`.
- Evidence: tsc clean; lint 0 errors; vitest 161/1 skipped ×5 consecutive runs on one DB; Playwright
  17/17 incl. CSP; live: headers, foreign-origin 403, html lang, live booking spec, logs clean.

## Batch 5 — delivery & quality (2026-10-01) — release 4746bb5, DEPLOYED via scripts/deploy.sh
- **DEPLOY NOW = `sudo scripts/deploy.sh`** (from a clean, committed tree). Steps: backup → build
  `taxicy-taxi-app:<sha>` (nothing restarts if the build fails) → image label must equal the commit
  → up web+worker → health gate (release from the IMAGE via APP_RELEASE_BUILT, status live,
  dispatch+notifications alive, both containers on the new tag) → auto-rollback to the previous
  tag on failure. Options `--skip-backup`, `--allow-dirty`, env `DEPLOY_GATE_SECONDS`.
  Rollback drill done on prod (gate 1 s → rolled back to the previous image, then healthy).
  Migrations are forward-only — keep them additive so a rollback image still runs.
- **Compose:** image tag per commit, json-file log rotation 10m×5 on all services, mem/cpu limits
  (app 1g, worker 768m, db 2g, clickhouse 2g).
- **CI:** `.github/workflows/ci.yml` (typecheck, lint, fresh migrate+seed on Postgres 16, vitest,
  build, `npm audit --omit=dev --audit-level=critical`).
- **Lint:** ESLint 9 flat config, enforced in `next build`; clean.
- **HTTP route tests:** `tests/routes.db.test.ts` (in-memory cookie jar for next/headers).
- **Deps:** maplibre-gl → 6.x (critical XSS fixed), next → 15.5.27. Open: PostCSS advisory bundled
  in Next 15 (high, build-time only) — needs the Next 16 major.
- **robots.txt** disallows private/per-ride/staff paths.
- Suite 161 passed / 1 skipped; Playwright 15/15.

## Batch 4 — data & privacy (2026-10-01) — release 50f69a0, DEPLOYED + live-verified
- **Analytics GPS:** `gps.sample` events now pseudonymous (`driverPseudo` aggregateId), ~500 m grid
  (`coarsenCoord`), no heading; duty events correlate by pseudonym. ClickHouse schema v2 (versioned
  one-time migrations in `src/server/analytics/schema.ts` → `migrationStatements`): TTL
  `CH_GPS_TTL_DAYS` (90) for gps only, legacy exact rows deleted, raw duty ids cleared — validated on a
  throwaway CH 24.8, then live (versions [1,2], TTL present, 0 legacy rows). PG migration
  `20261001180000_privacy_analytics_cleanup` removed 7 legacy gps domain events.
- **KYC files:** scan before write (infected never stored); replaced docs' files deleted;
  `src/server/kyc-retention.ts` in maintenance — REJECTED after `KYC_REJECTED_RETENTION_DAYS` (30),
  abandoned drafts after `KYC_DRAFT_RETENTION_DAYS` (90), orphans after 1 day; `FILES_PURGED` event.
- **Passenger rights:** `GET /passenger/me/export`, `POST /passenger/me/delete {confirm:"DELETE"}`
  (blocked during an active ride; anonymises ride history, keeps financial rows) — `/account`
  "Your data" section (EN/EL/RU). `src/server/passenger-data.ts`.
- **Driver days:** reporting windows + daily chart use Europe/Nicosia days (`startOfNicosiaDay`,
  `nicosiaDayKey` in `src/lib/timezone.ts`).
- **Evidence:** suite 152 passed / 1 skipped; prod backup taken right before deploy
  (pg-20261001T142947Z); live: export/delete 401 unauth, dispatch + analytics alive.
- **Owner decisions still open:** retention periods for bookings/chat/accounts (defaults above are
  conservative placeholders) and the legal basis text in /privacy.

## Batch 3 — i18n EN / EL / RU (2026-10-01) — release 290929a, DEPLOYED + live-verified
- **System:** `src/i18n` — locale from `lang` cookie → Accept-Language → en; `<html lang>` server-side
  (`src/i18n/server.ts`, root layout). `useT()` → typed `t`, plural `tp` (Intl.PluralRules; RU
  one/few/many), `fmt` (dates/money by locale), `tError` (API error codes → localized, fallback to
  server text). Catalogs `src/i18n/messages/{en,el,ru}/<ns>.ts`; el/ru typed `Catalog<typeof en>` so
  missing keys fail tsc; `tests/i18n.test.ts` checks key + placeholder parity. Namespaces: common,
  errors, booking, track, auth, rides, driver, driverReg. Add a namespace = 3 files + register in
  `messages/index.ts`. `<LanguageSwitcher compact? />` on all passenger/driver entry screens.
- **Behaviour:** tracking ETA built from `pickupEtaMin`/`pickupEtaApprox`; labels stored on a
  booking (map pin, current location) stay English for the driver.
- **Not translated (intentional):** admin/dispatch consoles + /staff/security, privacy/terms (await
  lawyer), server tariff line labels, driver dashboard alert texts, free-text server field errors.
- **Evidence:** suite 143 passed / 1 skipped; Playwright `tests-e2e/i18n-visual.spec.ts` (el-GR,
  ru-RU) + batch2 = 15/15 on a local prod build; screenshots `docs/qa-screenshots/i18n/`. Live:
  Accept-Language el→el, ru→ru, de→en, cookie beats header; live booking spec 1/1.
- **Owner TODO:** native-speaker review of Greek (and Russian) copy before public launch — catalogs
  are plain TS files a reviewer can edit directly.
- **Test note:** `getByRole('option')` now also matches the language `<select>` options — scope to
  `getByRole('listbox')` in Playwright specs.

## Batch 2 — passenger + driver UX (2026-10-01) — release afa8780, DEPLOYED + live-verified
- **Booking:** all classes quoted in parallel (price + range per class, list right under the stops);
  sticky "Request <class> · ≈ €X" CTA; contact from the account (verified phone read-only — the typed
  phone was ignored server-side); passengers/note under "Options"; sign-in before review. Sign-in
  modal defaults to **email + password** (phone OTP is unavailable without Twilio).
- **Tracking:** pickup ETA + route from ASSIGNED; pinned status/driver/plate/start code with a
  scrolling body; sheet above map controls; driver rating once ≥5 trips (`PUBLIC_RATING_MIN_COUNT`);
  **Share trip** = read-only VIEW grant (`TrackingGrant.scope`, migration
  `20261001170000_tracking_grant_scope`) → `/share#t=…` (car, plate, status, ETA, live position only;
  never start code/phones/chat/cancel; not exchangeable for FULL; position hidden after the trip);
  Safety sheet with 112; `ConfirmSheet` replaces native confirm/alert for passengers + drivers.
- **Driver:** offer chime + vibration until answered (`src/lib/driver-alerts.ts`), Screen Wake Lock
  while on duty, offer pushes `requireInteraction` + vibrate (public/sw.js), Navigate warning;
  KYC photos re-encoded in the browser under 2 MB (`src/lib/image-compress.ts`).
- **A11y:** labels↔inputs (useId in reusable fields), radiogroup/aria-pressed, live headlines,
  `edge-strong` input borders (≥3:1), min 12px text, /rides error state + retry.
- **Evidence:** suite 138 passed / 1 skipped; Playwright `tests-e2e/batch2-visual.spec.ts` 8/8 at
  390×844 + 320×640 on a local prod build (fixture `tests-e2e/seed-batch2.ts`), live
  `batch2-live.spec.ts` 1/1 on prod (real Google route + per-class prices); screenshots
  `docs/qa-screenshots/batch2/`. Live: tracking/share 401 unauth, share/view bogus → 404, sw.js updated.
- **Not done:** native confirms remain only in staff consoles (dispatch/admin). No on-phone check of
  wake lock/vibration/sound (no device here) — the APIs degrade silently where unsupported.

## Batch 1 — dispatch correctness + security (2026-10-01) — release f96425f, DEPLOYED + live-verified
- **Dispatch (d149583):** `src/server/dispatch/search.ts` (`startSearchTx`/`stopSearchTx`) is the only
  way into/out of SEARCHING — staff →SEARCHING and immediate-ride unassign no longer strand rides
  without a DispatchJob; cancel/NO_DRIVER/manual-assign withdraw the open offer at once; worker
  repairs orphan SEARCHING bookings (`SEARCH_REPAIRED`); createOffer locks the booking; outbox skips
  offers whose booking left SEARCHING; search deadline from config everywhere; matching routes the
  shortlist in parallel (2.5s timeout, ETA cache across radii) + 6s per-tick job budget.
- **Security (4a0017c, f96425f):** atomic `RateLimitBucket` limiter (+ maintenance prune; legacy
  Setting rows dropped); atomic dev-OTP attempts; staff TOTP 2FA for ADMIN/DISPATCHER
  (`/staff/security`, QR, encrypted seeds, replay-proof, `STAFF_MFA_ENFORCE` default off,
  recovery `scripts/reset-staff-mfa.ts`); push endpoints limited to known push services;
  public `/health/live` returns only `{status}` (detail on-host via 127.0.0.1:8097, keyed on nginx
  `X-Real-IP` because Next adds `X-Forwarded-For` itself).
- **Live-verified:** migrations `20261001150000_rate_limit_buckets` + `20261001160000_staff_totp`
  applied; 50 concurrent public requests with forged XFF → exactly 30 passed / 20×429, all keyed to
  the real IP; MFA setup 401 unauth; /staff/security 200; dispatch+notifications alive.
  Suite 133 passed / 1 skipped.
- **Incident (caught, fixed):** a build whose log redirect failed (root-owned dir) left `up -d`
  restarting the OLD image under the NEW `APP_RELEASE` label for a few minutes. Rebuilt; migrations
  then applied. Lesson → batch 5 deploy script must verify the image digest/migrations, not the label.
- **Owner TODO:** enable 2FA on admin accounts at `/staff/security`, then set `STAFF_MFA_ENFORCE=true`.

## Stage 0 ops/UX pass (2026-10-01) — release 991bda3, DEPLOYED + live-verified
- **Monitoring:** `/health/live` → 503 "degraded" if dispatch/notifications heartbeat stale.
  `deploy/watchdog.sh` (root cron every minute, `# taxi-watchdog`) → Telegram alerts; checks origin
  health, public URL, containers, disk, backup freshness/size. Verified: cron runs, all checks OK,
  simulated outage/recovery produce the right messages. **Waiting on owner:** bot token + chat id in
  `deploy/secrets/telegram.env` (see EXTERNAL-ENABLEMENT §9), then `sudo deploy/watchdog.sh --test`.
- **Backups:** backup.sh now bash + pipefail + min-size check; cron switched `/bin/sh`→`/bin/bash`
  (old crontab saved at deploy/watchdog-state/cron.bak). Manual run OK (pg 140K).
- **Booking UX:** review step shows fare estimate/range (no "Confirmed by dispatcher"), automatic
  matching copy; airport (LCA/PFO, 2.5 km) quotes return `airport:true` and show an official
  fixed-fare notice (live-verified). /terms dispatcher sentence corrected.
- **Remaining Stage 0 (owner-dependent):** LEGACY-driver gate (which drivers pass KYC), real
  privacy/terms (lawyer), RTD fixed airport fare table → REGULATED_FIXED engine.

## Security hotfix + team audit (2026-10-01) — release f1294f5, DEPLOYED + live-verified
- **Team audit:** 7 specialist agents (security, backend, QA, UX, product, Cyprus regulatory, ops) +
  synthesis → `docs/AUDIT-2026-10-01.md` (66 findings; staged roadmap Stage 0-3; owner-decision list).
  Verdict: beta OK after the hotfix below; public launch NOT ready (privacy/terms, LEGACY drivers,
  airport fixed fares, monitoring/alerts, booking-review copy are the remaining Stage 0 items).
- **Fixed (P0, commit f1294f5):** (1) OTP codes were returned in API responses on live (DEMO_MODE +
  SMS_ALLOW_DEV_OTP, no Twilio) → account takeover by phone number. Dev OTP now only for
  `SMS_DEV_OTP_ALLOWLIST` (owner chose EMPTY) — sendOtp "unavailable", checkOtp rejects others.
  (2) `clientIp()` picked a client-forged XFF entry → every IP rate limit bypassable. Now walks XFF
  from the right skipping ≤`TRUSTED_PROXY_HOPS` trusted proxies (Cloudflare ranges/private); prod
  `TRUSTED_PROXY_HOPS` changed 2→1 in deploy/.env.production. Tests `tests/client-ip-otp.test.ts`
  (9); suite 116 passed / 1 skipped.
- **Live-verified:** all 4 OTP entry points via the public URL return unavailable / SMS_UNAVAILABLE
  with no code; probe left no Passenger row; dispatch alive.
- **Consequence (owner-accepted):** until Twilio creds are set, NEW passenger sign-up and phone-OTP
  login are unavailable on live; existing passengers use email+password `/login`, drivers use staff
  password login. Add test phones to `SMS_DEV_OTP_ALLOWLIST` if testers need OTP.
- **Next:** remaining Stage 0 items in docs/AUDIT-2026-10-01.md (monitoring/alerts, booking-review
  "dispatcher" copy, LEGACY driver gate, privacy/terms, airport fixed-fare disclaimer).

## Session 2026-10-01 — migration DR fix + Task 020 (rating + receipt) — release f998681, DEPLOYED + live-verified
Goal this session: drive the project to completion. Current beta release **f998681** is live at
`cyprustaxi.ackedberryes.store` origin (`/api/v1/health/live` → release f998681, dispatch+analytics
alive). **vitest 107 passed / 1 skipped** (skip = CH integration) on an isolated pg16 `_test` DB;
`tsc --noEmit` clean; `npm run build` compiles. Git: `master` (push `master:main`), all committed.

- **Migration DR fix (commit d3f1c65):** a FRESH `prisma migrate deploy` was broken — the
  completion migration `20260914085416` altered `ApplicationDocument` before the KYC migration
  `20260914110013` creates it (prod survived only because migrations were applied incrementally).
  Guarded that ALTER with `to_regclass(...) + ADD COLUMN IF NOT EXISTS` and added
  `20260914230500_ensure_application_document_expires_at` so fresh + existing DBs converge. A fresh
  deploy now applies all migrations cleanly (DR / new-env / isolated-test provisioning works).
  Confirmed empirically that `migrate deploy` ignores checksum drift on already-applied migrations,
  so editing 085416 is safe for prod — verified live: prod applied only the 2 new migrations, the
  edited one was skipped, no error.
- **Task 020 — post-trip rating (commit ddfda58):** `TripRating` model (one per booking via
  `bookingId @unique`, immutable; stars 1-5, JSON tags, optional comment) + `Driver.ratingTotal/
  ratingCount` maintained in the SAME tx as the rating. `src/server/ratings.ts` (`rateTrip`,
  `validateRating`, `driverRatingSummary`): locks the booking row, checks ownership + COMPLETED,
  rates the driver who actually COMPLETED (assignment `reason='completed'`), rejects a 2nd rating
  (409; DB unique guards the race), records a `trip.rated` event. API `GET/POST /passenger/rides/
  [id]/rating`; `/passenger/rides` returns `ratedStars`; `/driver/dashboard` returns
  `driver.rating`. UI: Rate-trip / given-stars on My rides (`RateTripModal`), aggregate on driver
  Profile. Migration `20260914231500_t020_trip_rating`. Tests `tests/ratings.db.test.ts` (7).
- **Task 020 — ride receipt (commit f998681):** `src/server/receipt.ts` `passengerReceipt(...)`
  builds a receipt from the IMMUTABLE Fare (endpoints, driver+vehicle snapshot, itemised lines,
  waiting, payment) — honest under regulated metering (finalCents null → estimate + note, no
  fabricated total). API `GET /passenger/rides/[id]/receipt`; UI `/rides/[id]` + "Receipt" link.
  No email transport exists; emailed receipts deferred (see `docs/EXTERNAL-ENABLEMENT.md`). Tests
  `tests/receipt.db.test.ts` (3).
- **Docs:** new `docs/EXTERNAL-ENABLEMENT.md` consolidates every honest-gated capability (real SMS,
  clamd AV, Places New, weather, dynamic pricing, il-y.taxi DNS, off-host backups/DR, emailed
  receipts) with exact env vars + verification. HANDOFF/IMPLEMENTATION_STATUS reconciled (they had
  stopped at Task 017; Tasks 018/019 + this session now recorded).
- **Live verification (2026-10-01):** deployed via `export APP_RELEASE=$(git rev-parse HEAD)` +
  build + `up -d taxi-app taxi-worker`; entrypoint applied both new migrations. Confirmed on prod:
  `TripRating` table + `Driver.ratingTotal/ratingCount` present; `/passenger/rides/[id]/rating` and
  `/receipt` return 401 UNAUTHENTICATED (correctly gated); worker dispatch alive. **Proven working:**
  rating + receipt business logic by DB tests on the same pg16 engine the prod schema now matches.
  **NOT run (honest):** a full authenticated browser/phone click-through on prod (no browser/device
  here; did not seed synthetic bookings into the live DB).

## Tasks 018 + 019 (2026-09-14) — consumer login, sign-up, account menu, saved places, driver offer data
(Recorded here retroactively — these shipped but predated this handoff's prior top entry.)
- **018 (commit 9d00655):** clean consumer `/login` (email+password only) replacing the old
  `/staff/login` target, Bolt-style passenger sign-up (`/register`), "Become a driver" + staff
  sign-in links. Migration `20260914201355_t018_passenger_email_password` (`Passenger.email @unique`
  + `passwordHash`; phone stays the verified identity, email is a 2nd identifier).
- **019 (commits 6c09659, d3bdc29):** signed-in header shows an initials-avatar account menu
  (`AccountMenu.tsx`: identity, My rides, Profile settings, Help/privacy, Log out last) replacing
  the Login link; `/account` profile settings (editable display name; verified phone/email
  read-only). Saved places `SavedPlace` (one HOME/WORK per passenger; migration
  `20260914225845_t019_saved_places`) + `GET/PUT /passenger/places`; Home/Work quick-pick chips in
  booking. Driver offer now returns the FULL fare breakdown + passenger block before accepting.

## Task 017 driver dashboard (2026-09-14) — release 53f42e4, deployed + browser-QA'd
Four-section driver dashboard (Home/Trips/Earnings/Profile) that PRESERVES the working
offer/GPS/nav/arrive/start-code/complete/chat/push flow. vitest **93 passed / 1 skipped**.
- **Data** (migration `20260914190220_t017_duty_sessions_and_settlement`): `DutySession`
  (server-timestamped on/off-duty, one open per driver, events `driver.online/offline`, online-time
  from session∩window — never a browser timer) and `DriverSettlement` (driver-reported actual
  metered amount + optional payment-received, SEPARATE from Fare, revision-appended corrections
  with a reason, audited, completing-driver-only, upfront price protected; booking FK cascades).
- **Server**: `src/server/driver/{duty,settlement,earnings,trips,dashboard,documents,window}.ts`.
  Earnings are financially truthful (recorded = known finals; unknown = pending not zero; estimates
  never income; per-currency, never mixed). Trips are driver-scoped + privacy-safe (a
  reassigned-away driver sees only RELEASED, never later passenger data; no phone in history).
- **APIs**: `/driver/dashboard`, `/driver/trips` (+filters/pagination), `/driver/trips/[id]`,
  `/driver/earnings`, `/driver/earnings/export` (CSV, formula-injection safe, currency+UTC+
  generated-at), `/driver/bookings/[id]/settlement`, `/driver/documents`. Availability route now
  opens/closes the duty session atomically.
- **UI** (`src/app/driver/page.tsx` rebuilt): bottom nav, ≥44px targets, safe-area; GPS/offer/ride
  runtime lives ABOVE the tabs so switching sections never stops it; persistent offer alert +
  return-to-trip bar. Home: status/duty, 3 today figures, active-trip/offer priority, last trips,
  alerts (eligibility blocker replaces online action). Earnings: big recorded amount + daily chart
  + CSV. Profile: vehicle (review-gated), documents (status only), help (configured or honest
  unavailable), sign out. Honest Final/Estimate/Pending labels throughout.
- **Analytics**: driver-utilization metric (deferred in Task 016) now computed from duty events —
  admin `/admin/analytics` shows driver online-time.
- **QA**: screenshots at 390×844 / 320×844 / 1440×900 via a synthetic QA driver that was then
  REMOVED (login now 401; driver count back to 5). No real on-phone journey (no device here).
- **Deploy note**: always `export APP_RELEASE=$(git rev-parse HEAD)` before `up -d` — a bare `up`
  leaves the running release env stale.

## Task 016 data platform (2026-09-14) — release 4a07f34, deployed + live-verified
Postgres operational foundation + ClickHouse analytics + durable pipelines. vitest **90 passed /
1 skipped** (skipped = CH integration test; PASSED separately vs the live container).
- **M1 events:** `DomainEvent` (immutable, sanitized, natural-key unique) + `AnalyticsDelivery`
  (per-sink lease) + `GpsSample` + `WorkerHeartbeat`; outbox hardened (claim-with-lease, precise
  outcomes SENT_TO_PROVIDER/NO_SUBSCRIBERS/RETRY/FAILED/SUPERSEDED). `recordEvent`/notification
  enqueue run INSIDE each domain tx (rollback-safe, ON CONFLICT — no fire-and-forget). Migration
  `20260914202449_t016_data_platform_foundation` applied on prod.
- **M2 workers:** dedicated `taxi-worker` Compose service (same image, `WORKER_ROLE=worker`,
  `RUN_MIGRATIONS=off`); web app owns migrations + does NOT run the loop; four isolated sections
  (dispatch→notifications→analytics→maintenance) each heartbeat; health reads heartbeats
  cross-process and separates operational vs analytics. Verified: app log has no worker start,
  worker log does.
- **M3 ClickHouse:** private `clickhouse-server:24.8-alpine`, no public ports, mem/cpu-bounded,
  least-priv users (`taxi_writer`/`taxi_reader`, default→loopback). Single `domain_events`
  ReplacingMergeTree; canonical dedup queries; exporter claims deliveries with a lease, inserts,
  acks; backfill + lag-aware reconciliation. Live: booking→event→CH export DELIVERED, reconciled.
  **NOTE:** the CH integration test drains the whole local delivery backlog into the configured CH
  DB — it now refuses any `CLICKHOUSE_DB` not ending in `_test` (a run earlier leaked local test
  events into prod CH; prod CH was TRUNCATEd + re-exported clean, verified).
- **M4 analytics UI:** `/admin/analytics` (ADMIN) — ride outcomes, offer acceptance, dispatch
  latency + pickup wait p50/p90, fares-by-currency (recorded-final only; unknown=pending not zero;
  estimates never income), honest *unavailable* cards (driver utilization / provider perf), pipeline
  health panel. Admin-guarded (401 unauth); screenshot captured.
- **M5 backups/docs:** `deploy/backup.sh` (encrypted PG + uploads, daily root cron 03:30 UTC) +
  `deploy/restore-verify.sh` — **restore measured/verified** (10 migrations, 18 bookings, 0 orphan
  FKs). Docs: `docs/architecture/DATA-PLATFORM.md`, `BACKUP-RESTORE.md`, `PIPELINE-OPERATIONS.md`.
- **BLOCKERS (honest, not faked):** no off-host backup destination (`BACKUP_REMOTE` unset → same-disk
  snapshots are not DR); RPO≤15m/RTO≤2h needs WAL/PITR + off-host (daily cadence ≈24h now).
- **DEFERRED to Task 017:** driver on/off-duty session events (needed for driver-utilization
  analytics + online-time) — Task 017 adds duty sessions and coordinates settlement with this model.

## Header nav restyle (2026-09-14) — release 8f5129b, deployed + live-verified
- Desktop top-right menu (**Book · My rides · Privacy · Login**) restyled as a segmented control that reuses the **exact** Now/Schedule classes: container `rounded-[12px] border border-edge bg-elevated p-1`; items `rounded-[9px] px-3 py-2 text-sm font-medium transition`; active (Book) `bg-accent text-[#0d1608]`; inactive `text-muted hover:text-ink`. In `src/components/booking/BookingApp.tsx` (nav was `gap-6 text-lg`). **Now/Schedule control unchanged.** Mobile-only Login button unchanged.
- **Verified live** on `cyprustaxi.ackedberryes.store` (release 8f5129b, `/api/v1/health/live` → `alive:true`): headless-Chromium (Playwright) screenshot confirms the nav and Now/Schedule share the same look (lime-on-dark active, muted inactive, same font/pill). Pushed `master:main`.

## Tasks 013/014/015 completion pass (2026-09-14) — release 31d5781, vitest 78/78, live-verified
- **013 reliability**: chat send validates chat-open + active-assignment ownership ATOMICALLY under the booking row lock (`postMessage(..., {requireDriverId})`); notifications go through a durable **NotificationOutbox** (enqueue in domain writes; worker drains with retries/backoff + dedupe; drops stale/expired offers). DONE.
- **014 passenger accounts**: `Passenger`/`PassengerSession` + SMS OTP; **booking now REQUIRES a signed-in passenger** (`401 LOGIN_REQUIRED`, verified live) with a login modal after route selection; account-linked bookings; **"My rides"** (`/rides`) history + resume-live-tracking; **destination history** chips. Nav Staff→Login, My ride→My rides. See Tasks/014.
- **015 completion**: malware-scan GATE (clamd adapter; accept requires `scanStatus=CLEAN`; approval requires all required docs CLEAN — never approve unscanned); **expiry enforcement** (admin sets doc expiry on accept; worker → `DOCUMENTS_EXPIRED`, off-duty, invalidates unaccepted offers, never cancels an active trip; 30/7/1-day reminders via outbox); concurrency-safe review (request-changes/reject revision-guarded under row lock); wizard **autosave**; expanded document fields/slots.
- **Migration** `20260914085416_t013_t014_t015_completion` (Passenger, PassengerSession, NotificationOutbox, Booking.passengerId, ApplicationDocument.expiresAt).
- **HARD EXTERNAL BLOCKERS (not done, not faked)**: (1) **real SMS** needs `TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN` (only Verify SID present) — dev OTP is refused unless `SMS_ALLOW_DEV_OTP=true` and is labelled "Test verification"; the beta enables it (labelled) to stay usable. (2) **real malware scanning** needs a reachable clamd (`CLAMAV_HOST`) — none here, so scans are UNAVAILABLE and approval is correctly blocked. Both capabilities are implemented and gate correctly; they light up when the external resource is provided.

## Task 015 (2026-09-14) — Driver registration + KYC + admin approval — IMPLEMENTED + deployed
Release **21868e1**. vitest **75/75**. Live-verified on prod.
- **Eligibility gate** `Driver.eligibility` (LEGACY|APPROVED|PENDING|SUSPENDED|DOCUMENTS_EXPIRED); only LEGACY/APPROVED work — enforced at duty, public fleet, candidate selection, market supply, offer accept (in-tx), manual assign/reassign (`src/lib/eligibility-policy.ts`). Migration `20260914110013_driver_applications_kyc` grandfathers pre-existing drivers to **LEGACY atomically** (owner decision) — all 5 prod drivers = LEGACY, no lockout. New self-reg is gated (Driver created only, APPROVED, on admin approval).
- **Applicant accounts + OTP**: `DriverApplicant`/`ApplicantSession`; `src/server/sms.ts` uses Twilio **Verify** when `TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN`+`TWILIO_VERIFY_SERVICE_SID` are set, else a dev-OTP path (code shown only in demo, never logged in prod). Prod has only the Verify Service SID → **dev OTP active (NOT real SMS yet)**. Approved drivers sign in via phone OTP (`/api/v1/driver/otp/*` → staff session).
- **Application** model + states DRAFT→SUBMITTED→IN_REVIEW→APPROVED/CHANGES_REQUESTED/REJECTED + document metadata + event trail (`src/server/applications.ts`). Approval provisions driver+vehicle+binding **atomically, idempotently, off-duty, revision-guarded**; audited.
- **Private storage** `src/server/storage.ts` → Docker volume `taxicy_uploads` at `/app/private-uploads` (env `PRIVATE_UPLOAD_DIR`), outside public/ & Git; magic-byte validation (jpg/png/pdf/heic; rejects exe/HTML/SVG), size limits, sha256; **authenticated streaming only** (applicant own; ADMIN review). `scanStatus=UNAVAILABLE` (no AV scanner — honest).
- **UI**: nav "Staff"→"Login" + "Register as a driver"; `/driver/register` wizard (OTP→identity/driving/vehicle/photos/review, save/resume, camera capture); `/driver/login` OTP; `/admin/applications` queue + detail (doc viewer, per-doc accept/changes, start/request-changes/reject/approve) — **ADMIN only (dispatchers excluded)**.
- Docs: `docs/research/DRIVER-ONBOARDING-REQUIREMENTS.md` (matrix, gov-vs-platform, VERIFY items), `docs/research/EXISTING-DRIVER-MIGRATION.md`.
- **Remaining / blockers**: real SMS needs Account SID + Auth Token (dev OTP until then); AV scanner; expiry reminders + auto DOCUMENTS_EXPIRED (schema ready); legacy-driver review queue to retire LEGACY; email verification; browser QA screenshots (no browser here — server flow live-smoked). Cyprus matrix VERIFY items pending live RTD confirmation.

## Task 013 (2026-09-14) — P0 done, P1 mostly done, P2 partial (code + tests + deploy)
Autonomous-ride correctness + notifications hardening. **vitest 66/66.** Each item's exact status is in Tasks/013's completion matrix (top of file).
- **P0 lifecycle authority**: generic `changeStatus` rejects ARRIVED/IN_PROGRESS/COMPLETED (`USE_LIFECYCLE_ACTION`); shared finalizers in `dispatch/lifecycle.ts` are the only writers; audited staff overrides (`staffMarkArrived/StartTrip/CompleteTrip`, reason + AuditEvent) power the dispatch status route/UI; completion writes exactly one immutable `Fare`, finalizes waiting, releases capacity atomically (upfront→finalCents=accepted, regulated→null).
- **P0 concurrency**: `acceptOffer/rejectOffer/expireOffer` lock the booking row FIRST and re-read the offer under it (single serialization point); GPS-loss rematch verifies exact assignment id+driver and re-checks GPS under lock; per-job try/catch isolates failures. `tests/lifecycle-guards.db.test.ts` (accept-vs-reject/expire/cancel, two-worker single-offer, bypass rejection).
- **P1 ETA**: live pickup ETA passes `departureTime=now` (traffic-aware); ETA cache keyed by booking+driver with eviction (no stale ETA after rematch); approximate fallback labelled "(approx)"; `fetchJsonWithStatus` now times out body parsing too.
- **P1 notifications**: SSRF-safe `saveSubscription` (`isSafePushEndpoint`: https-only, rejects IP-literals/loopback/private/metadata; key validation; per-audience cap 10); notifications for offer/assignment/arrival/no-driver/rematch/cancellation + chat; `NotifyToggle` opt-in on driver duty card + passenger tracking. `tests/push.test.ts`.
- **P1 quote — DONE**: scheduled rides are priced (day/night/holiday) AND routed (traffic-aware future departureTime) for their journey time via `pricingAt`, while quote expiry stays relative to issuance; the quote hash binds scheduled time + luggage + quoteId; Quote persists `pricingAt`+`routeSource` (migration `20260914100140_quote_pricing_at`). "Confirmed by dispatcher" wording removed. Tests in `tests/pricing.db.test.ts`.
- **P2 chat — DONE**: stable (createdAt,id) cursor pagination — latest page + `before` (load older) + `after` (incremental tail) with merge-by-id (identical-timestamp ties handled). ChatPanel polls the tail incrementally, has "Load earlier messages", and remounts on booking change. Tests in `tests/chat.db.test.ts`.
- **Live server-side smoke (2026-09-14) — PASSED.** Created a dedicated synthetic driver (`qa-driver`, bcrypt via a local hash + SQL insert; NOT a real account, NOT a password reset) and drove the full journey against prod release f76e9a6 via the real API: book(COMFORT) → worker offer (real Google ETA, offered in ~1s) → accept → EN_ROUTE → arrive (150m proximity + fresh-GPS gate) → start(code 7279) → complete. Persisted evidence: event trail CREATED→OFFERED→OFFER_ACCEPTED→STATUS_EN_ROUTE→ARRIVED→TRIP_STARTED→COMPLETED; exactly one immutable Fare (REGULATED_METER_ESTIMATE, finalCents null, CASH_TO_DRIVER/PENDING); capacity freed; waiting finalized. Driver GPS was DB test-scaffolding (no physical device), so this proves the dispatch/lifecycle/receipt server flow live, NOT on-device GPS accuracy or handset push delivery. All test bookings cleaned up and the `qa-driver` account was REMOVED afterward (login now 401).
- **Still not run**: a real on-phone browser journey (device GPS + actual push delivery) and multi-tab/desktop+mobile UI regression. To do it, recreate a synthetic driver the same way (do NOT reset real driver passwords) and run on a phone.

## Task 012 M4 (2026-09-13) — mostly DONE (code + tests + deploy)
Release **96abdd2**. Dynamic pricing, weather adapter, Places (New) autocomplete, isolated load test.
- **UPFRONT_DYNAMIC** synthetic pricing (`src/lib/pricing-dynamic.ts`, `src/server/dispatch/market.ts`): bounded [1.0,1.5] deterministic demand/supply multiplier, min-sample threshold, hysteresis, weather-into-demand (capped, non-overlapping), zero-supply→1.0. Applied only to eligible base (initial+distance). **Config-gated** `PRICING_MODE` (default `REGULATED_METER_ESTIMATE` — real charges stay regulated; dynamic is synthetic/TEST). Wired into `createQuote`; upfront = committed price (no ±band).
- **Weather** (`src/server/weather.ts`): timeout + freshness + NEUTRAL fallback; providers `none`(default)/`fixture`/`open-meteo`. Never fabricates weather; open-meteo OFF pending commercial authorization. Env: `WEATHER_PROVIDER`, `WEATHER_MAX_AGE_MINUTES`, `WEATHER_FIXTURE_SEVERITY` (tests).
- **Places (New)**: `googleAutocomplete`/`googlePlaceDetails` (`src/server/google.ts`), `/api/v1/places/{search,details}` with a billing session token + **graceful fallback to forward geocoding** when Places isn't enabled. `PlacesInput` client: session lifecycle, keyboard nav, prediction→details resolution (kept debounce/cancel/stale-guard). **Verified live**: `/places/search?...&session=` returns geocoding (Places API (New) not enabled on the project).
- **Load test** `scripts/load-test.ts` (isolated `_test` DB, Google stubbed): `LOAD_DRIVERS`/`LOAD_BOOKINGS`. Result at 1000 drivers / 100 bookings: 100/100 assigned, ZERO invariant violations, p50/p95 ~4.9s/6.6s (120 drivers: ~1.3s/1.8s). Candidate prefilter scans all drivers — known scaling limit (add a spatial index for production scale).
- **vitest 52/52** (added `tests/pricing.test.ts`, `tests/pricing.db.test.ts`). Migrations unchanged since M3.
- **Remaining M4 (external enablement, not code gaps)**: REGULATED_FIXED airport/zone fixed fares (not implemented); **enable Places API (New)** on the Google project to activate real autocomplete; **authorize a commercial weather provider** to activate real weather. To turn on dynamic pricing for real, set `PRICING_MODE=UPFRONT_DYNAMIC` only once the commercial rule is authorized.

## Production domain il-y.taxi + IL-Y rebrand (2026-09-13) — DONE (server + code + deploy)
Release **8ab7079**. The product is now branded **IL-Y** (visible rebrand only; repo/DB/API/cookies unchanged) on the production domain **il-y.taxi**.
- **nginx**: `/etc/nginx/sites-available/il-y-taxi.conf` (repo copy `deploy/nginx-il-y-taxi.conf`, symlinked in sites-enabled) serves `il-y.taxi` + `www.il-y.taxi` → app on 127.0.0.1:8097, reusing the self-signed origin cert `/etc/nginx/taxicy-ssl/` (works behind Cloudflare "Full"). `cyprustaxi.ackedberryes.store` stays served.
- **App**: `APP_BASE_URL=https://il-y.taxi` + `APP_ALLOWED_HOSTS=il-y.taxi,www.il-y.taxi,cyprustaxi.ackedberryes.store` (in `deploy/.env.production` + wired through docker-compose). Tracking links now derive from the **request host** (allowlisted) — correct on whichever domain the passenger uses. Origin guard already accepts same-host, so no CSRF change needed.
- **Brand**: approved IL-Y kit installed under `public/brand/` and `public/icons/`; `src/components/Brand.tsx` renders the horizontal IL-Y lockup + pin `mark.svg`; favicon/apple-touch/manifest/OpenGraph + all visible "IL-Yas" text → "IL-Y". Source zip `IL-Y-web-assets.zip` gitignored (extracted assets committed).
- **Verified**: forcing the Host to the origin (DNS not live yet), `https://il-y.taxi/` + `www` = 200, `/brand/logo-horizontal-light.svg`, `/icons/favicon.ico`, `/manifest.webmanifest` = 200, `<title>IL-Y — book a ride</title>`; a booking via the il-y.taxi host returns `tracking.url = https://il-y.taxi/track#...`; cyprustaxi still 200. Test booking cleaned up.
- **⚠️ DNS NOT LIVE**: `il-y.taxi` has NO public A/NS record yet (checked 8.8.8.8 + 1.1.1.1). The vhost + app are ready; once you point `il-y.taxi` (and `www`) at 92.39.53.229 it serves immediately. **Confirm whether il-y.taxi will be fronted by Cloudflare** (like the beta) — if so the self-signed origin cert is fine on "Full"; if the origin is exposed directly, issue a real cert (Let's Encrypt/`certbot --nginx -d il-y.taxi -d www.il-y.taxi`, needs DNS pointing here first) or Cloudflare Origin CA.

## Task 012 M2 + M3 (2026-09-13) — DONE (code + tests + deploy)
Release **84c3b1b** live at https://cyprustaxi.ackedberryes.store (verify via /api/v1/health/live `release`; that endpoint also reports `dispatch.alive`).

Autonomous ride-hailing replaces manual-only dispatch (manual assignment kept as an audited admin override).
- **M2** — background dispatch worker (`src/server/dispatch/worker.ts`, started by `src/instrumentation.ts`, DB-backed `DispatchJob`+lease, 2s tick); eligibility + real Google pickup-ETA ranking with 3/7/15km stages (`eligibility.ts`); expiring 20s `DriverOffer` with DB-enforced one-active-per-driver/booking; atomic accept under row lock (`offers.ts`); reject/expire rematch; 180s→NO_DRIVER; passenger retry (`/api/v1/tracking/research`). Driver offer card + passenger SEARCHING/NO_DRIVER UI.
- **M3** — scheduled-ride automation (worker promotes REQUESTED→SEARCHING within a 15-min lead, deadline runs to pickup time); arrival rules (EN_ROUTE→ARRIVED needs fresh GPS ≤150m of pickup, airports exempt) + persisted `WaitingSession` (3-min free grace, pre-pickup paid rate 0 in regulated mode); 4-digit start code (issued at assignment, shown to passenger, driver enters it ARRIVED→IN_PROGRESS); immutable `Fare` receipt at COMPLETED (payment CASH_TO_DRIVER/PENDING, never auto-collected); pre-pickup driver cancel → auto-rematch (fare preserved); prolonged pre-pickup GPS loss (90s) → worker rematch, never for IN_PROGRESS. New driver endpoints `arrive|start|complete|cancel`; driver + passenger UI updated. `src/server/dispatch/lifecycle.ts`. Config tunables in `config.ts` (`config.dispatch.*`, env NAMES: DISPATCH_SCHEDULE_LEAD_MINUTES, DISPATCH_ARRIVAL_RADIUS_METERS, DISPATCH_WAITING_GRACE_SECONDS, DISPATCH_WAITING_RATE_CENTS_PER_MIN, DISPATCH_GPS_LOSS_REMATCH_SECONDS, DISPATCH_WORKER=off to disable).
- Migrations: `20260913153847_dispatch_offers_states` (M2), `20260913160027_m3_waiting_fare_scheduling` (M3). Applied to prod on container start.
- **Tests: vitest 41/41** (`tests/dispatch.db.test.ts`, `tests/lifecycle.db.test.ts` + existing). Test DB: local pg16... actually local **pg12 on :5432**, role `taxi` (needs CREATEDB for `migrate dev` shadow DB), DB `taxi_cyprus_test`; `DATABASE_URL=postgresql://taxi:<pw>@127.0.0.1:5432/taxi_cyprus_test?schema=public DEMO_MODE=true DEMO_PASSWORD=<≥8> npx vitest run`. `vitest.config.ts` runs files sequentially (shared DB).
- **Verified LIVE on prod**: worker ticking; scheduled promotion REQUESTED→SEARCHING with deadline=pickup time + SCHEDULED_PROMOTED event; M2 offer creation with real Google pickup ETA; forced-deadline→NO_DRIVER; all new endpoints present and 401-protected. All live test rows cleaned up.
- **NOT yet done live**: the fully authenticated driver→complete journey (§8.1) on prod — the Sep-11 `beta-access.txt` driver password is STALE (prod rebranded to Ilias/Alex; passwords rotated). The accept→arrive→start→complete→fare chain IS proven by `lifecycle.db.test.ts` against real Postgres. To run it live, obtain current driver creds (or reset one with `npm run bootstrap`-style flow) then walk `/driver/offers`→accept→status EN_ROUTE→arrive→start→complete.
- **Secrets**: a root-owned `Twilio` file (SMS credential) appeared in the repo root this session — added to `.gitignore`, NOT committed. `deploy/.env.production` sets `GOOGLE_MAPS_SERVER_API_KEY` (real Routes/Geocoding in prod).
- **M4 pending**: Places (New) autocomplete (needs Places API enabled), dynamic pricing (synthetic), weather adapter, full acceptance + isolated load tests.

## Current state (2026-09-11)
Beta is IMPLEMENTED, TESTED and DEPLOYED publicly at https://cyprustaxi.ackedberryes.store.
- Host: 92.39.53.229 (`hosted-by`). App runs as Docker Compose project `taxicy` (containers `taxicy-app`, `taxicy-db`), app bound to 127.0.0.1:8097, DB has no published port (volume `taxicy_pgdata`).
- nginx vhost `/etc/nginx/sites-available/cyprustaxi.conf` (symlinked in sites-enabled) routes only `cyprustaxi.ackedberryes.store` → app; self-signed origin cert in `/etc/nginx/taxicy-ssl/`. Cloudflare fronts the hostname and forwards to this origin.
- Secrets in `deploy/.env.production` (chmod 600, git-ignored). Test credentials in `deploy/secrets/beta-access.txt` (chmod 600, git-ignored).
- Project dir `/home/claudeuser/projects/cyprus_taxi` (owned by claudeuser). Git initialised; committed locally. Remote `origin` = github.com/tintsemaria-netizen/cyprus_taxi (NOT pushed — no push credentials in this environment).

## How to operate
- Status: `sudo docker compose --env-file deploy/.env.production ps`
- Logs: `sudo docker logs taxicy-app`
- Rebuild+redeploy: `sudo scripts/deploy.sh` (health-gated, auto-rollback). Do NOT use bare `docker compose up --build` any more.
- Migrations run automatically on container start (`prisma migrate deploy`).
- Re-seed demo / bootstrap admin: `docker compose ... exec -e DEMO_PASSWORD=… taxi-app npm run seed`; `... exec -e ADMIN_LOGIN=admin -e ADMIN_PASSWORD=… taxi-app npm run bootstrap:admin`.

## Task 004 (2026-09-11) — DONE
Applied the code-review corrections in docs/Tasks/Task.md: transaction rollback + row-lock
serialization in assignments.ts, atomic+encrypted idempotency (bookings.ts/tracking.ts/crypto.ts),
GPS pre-assignment/duty/ordering (location.ts), BookingApp focus + Nicosia-tz schedule
(timezone.ts), tracking no-fallback, origin guard (middleware), queue ordering, seed hardening,
and DB-test gating + regressions. Ran guarded legacy receipt migration (scripts/migrate-receipts.ts)
against prod. Rebuilt image, redeployed, smoke-tested live. Isolated test DB: run `taxi_cyprus_test`
in a throwaway postgres, `prisma migrate deploy`, `tsx prisma/seed.ts` (DEMO_MODE=true DEMO_PASSWORD=…),
then `DATABASE_URL=…_test npx vitest run`.

## Tasks 005 + 006 (2026-09-11) — DONE (code + deploy)
Deployed release e8463870 (see /api/v1/health/live `release`). 005: DST fold ambiguity
(timezone.ts + booking UI chooser), live-mode fixture gating, TrackApp outage/recovery,
GPS write-condition/create-retry + driver/vehicle row-lock guards for deactivation/binding,
health release id. 006: full-screen MapPicker (src/components/booking/MapPicker.tsx) +
/api/v1/places/reverse. 24/24 tests on isolated _test DB. UNVERIFIED and left for a session
with a real browser/phone: browser QA + mobile screenshots (Task 006), physical-device GPS,
10-min load test.

## Tasks 008 + 009 (2026-09-12) — DONE (code + browser QA + deploy)
Picker coord/address consistency (versioned draft) + lifecycle; fixed picker-not-loading
(container h-full — was 0-height → 300px canvas); map provider switched to Esri Dark Gray
(OSM 403s apps, Carto watermarks); Referrer-Policy strict-origin on pages / no-referrer on
/track+/api. Root Tasks/ folder created with index; pointer at docs/Tasks/. Browser QA via
Playwright in the official Docker image (host OS too old locally): `docs/BROWSER_QA.md`;
screenshots in `docs/qa-screenshots/`. Totals: vitest 24/24 + Playwright 6/6. Live release
2b8b455 verified (headers + real-tile picker). PENDING: physical Android/iPhone GPS, 10-min
load, real geocoding/routing provider.

## Task 012 (2026-09-13) — M0/M1 done + deployed; M2–M4 staged
Autonomous ride-hailing task. DONE: Cyprus fare research (docs/research/), 4 skills (.claude/skills/),
pricing/quote engine (src/lib/tariff.ts + Quote model + /api/v1/quote + booking fare snapshot),
real Google driver→pickup ETA in trackingView (cached ≤20s), public fleet availability states.
Migration `add_quote_and_fare`. Release 6239837. vitest 27/27.
NEXT (M2, the core): durable auto-dispatch worker — new models (DispatchJob, DriverOffer/Reservation,
booking states SEARCHING/OFFERED/NO_DRIVER), in-process worker with DB job claim, eligibility prefilter +
Google pickup-ETA ranking, 20s expiring offers, atomic accept (reuse assignments.ts SYSTEM actor),
reject/expire/cancel rematch, restart recovery. Then M3 UI (driver offers, passenger SEARCHING/matched)
and M4 (Places New autocomplete, dynamic pricing synthetic, weather, load test). Keep manual dispatch as
the audited admin override.

## Task 010 (2026-09-12) — P0/P1 hotfix DONE + deployed; Google migration PENDING keys
Fixed picker flicker + endless "resolving…" (tolerance-based move detection; 350ms
debounced + deduped reverse; api-client AbortSignal + 8s timeout → coordinate fallback;
stable panel height; per-map generation guard; retry preserves draft). PlacesInput
request-identity + cancel-on-select/unmount. Europe/Nicosia schedule min (Intl). Strict
/places/reverse validation. Public-config retry UI. Release 149e821. Tests: vitest 24/24,
Playwright 10/10 (stability suite run against live). Map provider is MapTiler (streets-v2-dark).

**Google migration (Task 010 §C) NOT started — needs credentials.** To do it, provide a Google
Cloud project (billing on) with: Maps JavaScript API, Places API (New), Geocoding API, Routes API
enabled; a **browser key** website-restricted to https://cyprustaxi.ackedberryes.store (+ dev
origins); a **separate server key** (never NEXT_PUBLIC); and a **Map ID**. Then wire NEXT_PUBLIC_*
(browser key + Map ID) via Docker build args and server key via runtime env, update CSP for Google
hosts, and migrate all map surfaces + Places autocomplete + Geocoding reverse + Routes.

## Task 010 §C/D (2026-09-12) — Google Maps migration DONE + deployed
All map surfaces render Google Maps (browser key + Map ID, dark) via AutoMapView/
AutoMapPicker (MapLibre kept only as no-key dev fallback). GoogleMapPicker reuses the
stability invariants via Google idle/camera events. Backend adapters (server key,
src/server/google.ts): /places/reverse (reverse geocode), /places/search (forward
geocode, Cyprus-biased), /routes/estimate (Routes DRIVE, decoded polyline). Booking
renders the real road route + trip-duration estimate. Keys: NEXT_PUBLIC browser key +
Map ID via Docker build args; GOOGLE_MAPS_SERVER_API_KEY runtime env. Keys are in the
gitignored deploy/.env.production and docs/GoogleMaps only — NEVER committed. CSP updated
for Google hosts. Release 30f16fd. Verified live (map renders no-auth-errors; server
geocode/route 200; full search→route flow; stability 4/4; vitest 24/24).

Caveats / next: **Places API (New) is not enabled** on the Google project (autocomplete
blocked) → search uses Geocoding (real addresses, not typeahead). **Restrict the browser
key** to the beta hostname in the Google console. Physical-device GPS + load test still pending.

## Next actions (optional, not blocking)
- Validate driver GPS on a physical phone over HTTPS; record result.
- Run the ~10-min synthetic load exercise; record machine/results.
- Configure a production map style + geocoder/router provider keys (server-only) and set DEMO_MODE=false when going real.
- Push the repository to GitHub once push credentials are available (`git push -u origin main`).

## Do not
- Do not publish secrets or the beta-access file to git.
- Do not disturb other vhosts/containers (agora, winzilla/fugaso, casino, etc.).
