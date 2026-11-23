# Session handoff

## 2026-11-23 — launch fixes, safe part ported (branch `launch-safe`, deployed ~23:55)
- Per-phone code limit 10 wrong codes / 10 min (correct code refunded: `refundRateLimit`); sign-in/code limiter fails closed on storage error.
- Licence front, taxi licence, insurance, roadworthiness need a future expiry to accept/approve (admin dialog makes the date required).
- Scan states CLEAN/INFECTED/ERROR/UNAVAILABLE; maintenance rescans pending documents.
- Driver told when a ride is taken off him: `drv.rideRemoved`, `drv.rideLostGps`, `drv.tripStopped` (sw.js 8 langs) + in-app line `driver.rideRemoved`.
- Admin «Надёжность» → «Состояние системы» (en/ru notes). Production switches (no test OTP, forced staff MFA, boot refusal) are REPORT-ONLY: live APP_ENV unknown, no Twilio.
- NOT ported (conflict with current work or needs a decision): receipt e-mail skip without provider (11-17 design keeps them waiting), meter receipt hold + one-total rule (§6, touches earnings/bookkeeping), deploy abort on failed backup (server backup state unknown), mandatory SMS, commission, SHARE_ENABLED default off.
- Prod public config shows demoMode: true (DEMO_MODE on the server) — operator to check.

## 2026-11-23 — «Попутчик в дороге» (deployed 2026-11-23 ~23:10)
- LIVE co-rider: the passenger in the car is NOT asked (hostAnswer YES at creation), no question push.
- The newcomer is offered to EVERY fitting co-rider car at once (≤5, `proposeLiveAll`), 60 s (SHARE_ANSWER_SEC). LIVE proposals keep activeGuestBookingId NULL; only the winner gets it in finalizeLiveTx (unique → one car).
- `decideLive`: yeses within LIVE_SAME_TIME_SEC (1 s; a 1-s timer settles, the worker is the safety net) of the first count as simultaneous → fewest extra minutes for the in-car passenger, then earlier yes. Others CANCELED + driver push `share.taken`. Settled in answerShare when nobody else can answer, else by the worker (tryLiveShare / expireShares).
- One round only: nobody takes it → ordinary search.
- Not offered if the in-car passenger would exceed his extra minutes or arrive later than «быть на месте» − 10 min.
- After acceptance: one push each — `share.liveHost` {etaT, payC}, `share.liveGuest` {pickT, etaT, payC} (sw.js, 8 languages).
- vitest 387/388.

## 2026-11-23 — Superadmin: staff management + change log with notifications (deployed)

- Operator: «нынешний админ — суперадмин, следующие — просто админы; сделай и залей, по ходу будем менять; не подтверждение, а уведомление — все изменения с уведомлением суперадмину».
- Superadmin = the owner (`StaffUser.isOwner`, see «Бухгалтерия» below). Label «Суперадмин»; his menu starts with «Изменения (N)», «Бухгалтерия», «Сотрудники».
- «Сотрудники» /admin/staff (owner only, API /api/v1/admin/staff, /staff/[id]): create ADMIN / DISPATCHER with a one-time temporary password; switch off (signs out everywhere) / on; new temporary password; reset 2FA; last sign-in. The owner cannot do these to himself. Audit rows in AuditEvent.
- «Изменения» /admin/changes (owner only): every POST/PUT/PATCH/DELETE to /api/v1/** by an ADMIN who is not the owner is logged in `StaffAction` (migration 20261123180000_staff_actions) when requireStaff lets it in (the proxy sets `x-ily-mutation`, always overwriting any client value). Push to the owner (`STAFF:<id>`, key `staff.change`, 8 languages) at most once per 2 min per admin. Opening the page marks all as read. Button «Включить уведомления на этом устройстве» → POST /api/v1/staff/push.
- NOT logged: dispatchers (routine dispatch work would flood it) and the owner's own changes. Logged at request entry — also a request that then fails validation.
- Regular admins keep every other section for now (operator: «по ходу будем менять»).
- Tests: tests/superadmin.db.test.ts, proxy marker in https-redirect.test.ts. Suite 387 passed / 1 skipped.

## 2026-11-23 — «Бухгалтерия» for the owner (deployed 2026-11-23 together with the superadmin)

- Operator: «бухгалтерия для меня в суперадмине; только я; только евро; начинай» (manual entries + reports first; driver subscriptions join automatically once they exist).
- Owner = `StaffUser.isOwner` (an ADMIN). Migration `20261123120000_accounting` marks the OLDEST active ADMIN (the bootstrap admin) as owner; move it on the server with `npm run owner:set -- <login>` (scripts/owner-set.ts, exactly one owner). Not editable from the UI. /auth/me returns `isOwner`; the staff menu shows «Бухгалтерия» only to him. Other admins / dispatchers get 403 on every accounting API.
- Data: `LedgerEntry` (INCOME/EXPENSE, day, cents, category, counterparty, method, note, receipt, soft delete) and `LedgerRecurring` (MONTH/YEAR, nextDay; booked idempotently when the page is opened — unique (recurringId, day), conditional nextDay move).
- src/server/accounting.ts: requireOwner, periodRange (month / quarter / year, prev / next), accountingView (totals, profit, 15 % tax «for information», by category, VAT turnover of 12 months vs 15 600 €, drivers' totals through the SHARED `earningsSummary` summed over all drivers), CSV export (Excel, BOM). Receipts: private store under `ledger/` (same magic-byte checks); the KYC orphan sweep now keeps ledger receipts.
- API /api/v1/admin/accounting (GET, POST), /entries/[id] (PATCH, DELETE), /entries/[id]/receipt (POST, GET), /recurring (POST), /recurring/[id] (DELETE), /export.
- Page /admin/accounting (en/ru texts; other languages use English as for all staff pages). Hint to turn on 2FA if off. Staff top menu now scrolls instead of overlapping the language / sign-out buttons (it overflowed at 1280 px).
- Tests: tests/accounting.db.test.ts (owner only, figures, recurring incl. month end, VAT/periods, receipts + sweep). Suite 381 passed / 1 skipped. Seed marks the demo admin as owner. Screens /tmp/shots/acc-*.png.
## 2026-11-23 (evening) — share-v2 simplified by the operator (deployed 2026-11-23 22:05)
- Auto: pairs only by «быть на месте» windows; route first, then the latest start so the later arrival is ~10 min (ARRIVE_BUFFER_MIN) before the end of the common part; ≤15 extra min each. Old bookings (no terms version) are NOT auto-paired.
- Board: shows rides within ±1 h of my window (BOARD_REACH_MIN); «Поехать вместе» = I adapt to their time; if outside my window → confirm dialog («Ваше указанное время… не пересекаются. Вы уверены…»), then «Вы будете на месте около …»; my window is widened to what I agreed.
- After a ПП booking the board opens (/share-board?booked=REF) with a banner. Pickup-interval editor removed from the form.
- vitest 385/386, build OK.

## 2026-11-23 (later) — share-v2 review fixes (deployed with share-v2)
- One booking end to end (CY-SDFX-6VM9, exact pickup 11:30): stays 11:30 after pairing, at the driver and in the push; receipt 35,20 €. Earlier 12:15 screenshot was a DIFFERENT booking that I had turned into an «old» one in the test DB with +30 min allowance.
- Class step with «Попутчик»: no range; card shows the co-rider price; box «С попутчиком X / Без попутчика (≈ по счётчику) Y» + when each applies.
- Driver pair detail: «Итого за поездку» next to «Взять поездку».
- Co-rider pushes open `/prebookings?open=<id>` (straight to the ride/choice); list shows «Попутчик найден — выберите время до …».
- Review «Когда» line and «Поездка забронирована на …» now formatted via fmt.dateTime (was raw `2026-11-24 11:30 · Europe/Nicosia`).
- vitest 383/384, build OK.

## 2026-11-23 — «Попутчик −30%» TZ stage 1 (branch `share-v2`, LOCAL, not pushed, not deployed)
- Booking: terms snapshot (`shareTermsVersion/At`, `sharePickupFrom/To`, `shareBookedPickupAt`, `shareBookedCents`), migration `20261123020000_share_terms`; consent box with arrival + pickup interval, narrow / exact time; both sums + full-price / €10 no-show text before ordering (8 languages).
- Matching: `fitPair` (src/server/share.ts) used by auto search AND the share board — each passenger keeps own interval, ≤15 extra min, arrival window; choice by `comparePairs` (smaller largest pickup shift, then smaller detour). Board no longer moves anyone to the other's time (`boardMaxShiftMin` now unused).
- Old bookings (`shareTermsVersion IS NULL`): only the old owner answers; card with up to 3 pickup options + «Ни один не подходит»; 30 min, ≤1 h before first pickup; no/silence → full price. `ShareGroup.variants/chosenVariant`, `answerShare(..., variant)`.
- One push per passenger on pairing: `share.found` {pickT, etaT, payC} in sw.js MSG_TEXT (8 languages).
- Tests: full vitest 383/384 passed before the last small fix; share tests re-run after it. Build OK. Screenshots /tmp/ui/tz-*.png.
- Next: operator review → «заливай»; stage 2 «Попутчик в дороге»; count of old active co-rider pre-bookings on prod (no DB access here).

## 2026-11-23 — Booking map zoomed out to the Middle East (branch `map-pad`, deployed 2026-11-23)

- Operator screenshot: «Выберите класс» with «Попутчик» on → the map behind showed Iraq / Afghanistan. Cause: the sheet covers almost the whole map; the bottom padding (`reviewH + 24`) left a few px or less, and Google `fitBounds` then zooms out to the world.
- Fix: `safePadding()` (src/components/mapFit.ts) keeps ≥ 40 px of the map free (trims the larger side first) — used by every fit / centre in GoogleMapView (fit, single point, focus, keep-in-view) and MapView (fitBounds, easeTo). Google fit also never zooms out past zoom 8 (whole Cyprus).
- Locally (MapLibre) the class step looks the same as before; the Google case could not be reproduced locally (the key works only on the live domain) — verify on the phone after deploy. Test: tests/map-padding.test.ts.
- OPEN (operator idea 03:14, waiting for his answers): replace the «крюк» choice for a NOW ride with «Когда готовы выехать, чтобы найти попутчика (−30%)?» — Сейчас · до 15 · 30 · 45 мин · 1 час. Questions asked: no co-rider in time → send a normal taxi at full price?; automatic in-car extra limit (e.g. 15 min) instead of asking?; −30% only when found?

## 2026-11-23 (01:45) — Minimum fixed at booking, stop rules, red bubble — deployed

- Pre-booking minimum is snapshotted: `Quote.minCents/minZone` → `Booking.fareMinCents/fareMinZone` (migration `20261123010000_min_snapshot`; backfill = bookings whose breakdown has a `prebookMin` line, zone «Район Никосии»). Driver offer, free orders, pre-booking board, close sheet, settlement and stop re-pricing read the booking's own minimum — admin price changes / switching areas apply to NEW bookings only (operator).
- Stops: a pre-booking's stop can change only while it is REQUESTED; once started → 409 PREBOOK_STARTED (server) and no stop editing on the tracking screen. At booking, co-rider and stop exclude each other: tapping the other button shows a floating semi-transparent red bubble (`src/components/RedBubble.tsx`; texts share.booking.stopBlocked / shareBlocked, 8 languages). Co-rider rides never had stops (SHARE_NO_STOP) — unchanged. Rides «now» unchanged.
- Tests: pricing.db (snapshot), passenger-stop.db (PREBOOK_STARTED); full suite 372 passed.
## 2026-11-23 — Driver navigation ☰ menu (branch `nav-menu`, deployed 2026-11-23)

- ☰ now sits above the main button (Завершить / На месте …), bottom right, absolutely placed so the map buttons keep their room; it follows the panel (same `sheetDrag.style` as the panel) and is there for the whole trip (before: only top right, only before pickup, only «Отказаться»).
- Menu: comment + flight (if any), «📤 Поделиться поездкой» (new POST /api/v1/driver/trip/share — the driver's own ACTIVE trip only, same view-only share link as the passenger's: car, position, route, no phones; navigator.share or copy), «📋 Подробности о заказе», «Отказаться от поездки» (only before pickup, as before). No «Отмена» button (operator) — a tap outside closes the menu; a small ✕ top right of the menu closes it too (branch `nav-menu-x`, deployed 2026-11-23).
- «Подробности о заказе» — ONLY for a ride-share pair (operator 01:13): sub-sheet with BackArrow (back → menu), the pair's stops with minutes between them (PairLegs, moved here from the panel) plus comment and flight.
- Comment and flight removed from the panel (only in ☰); an amber dot on ☰ when the ride has a comment or a flight.
- Texts in 8 languages (driver.navigation.shareTrip/…/orderDetails/comment/flight). Test: navigation.db «Поделиться поездкой». Suite 371 passed / 1 skipped. Screens /tmp/shots/90-menu-*.png.

## 2026-11-23 — Driver: no «быть на месте», time between the pair's stops instead (branch `pair-legs`, deployed 2026-11-23 — operator: «да, всё верно»)

- Operator: «это ничего не нужно водителю, ему нужно только время в дороге 1→2, 2→3, 3→4».
- Removed the arrival window from every DRIVER screen: DriverNavigation sheet, co-rider sheet (ShareDriver), pre-booking list / pair box / pair stops / detail (ScheduledRides ArriveLine removed). Passenger, share board, dispatch and admin keep it. Server fields for the driver (trip.arrive, hostArrive/guestArrive) are still sent but unused.
- New `PairLegs` (src/components/share/PairLegs.tsx): the 4 stops in order with «↓ N мин» between them; done stops dimmed (✓), next highlighted. In the navigation sheet and in the co-rider sheet. `pairStopsFor` fills `toNextMin` per stop via share-detail `leg()` (Google road time, cached 10 min; estimate otherwise).
- The pre-booking pair detail already had «до следующей точки: N мин · N км» per stop (unchanged).
- Tests 370 passed / 1 skipped; screenshots /tmp/shots/80-legs-b.png, 80-legs-c.png.

## 2026-11-22 (23:55) — Pre-booking window: arrival window only, under «Попутчик»; board only from «Мои предзаказы» — deployed

- Operator: no «Подача в / Быть на месте» tabs. A pre-booking is always «Когда вам нужно быть на месте?» (date, «Не раньше», «Не позже», computed departure); the block sits UNDER the «Попутчик» box, with or without a co-rider (`schedule-arrive`). The share box shows only people/bags + «минимум за 3 ч». `arriveMode` is always true for pre-bookings; arriveCalc only in SCHEDULE.
- Share board link: only on «Мои предзаказы» (removed from the account menu and from under the share box); board back arrow → /prebookings.
- Full suite 364 passed; Playwright: plain and co-rider pre-bookings POST 201.
## 2026-11-22 (23:30) — Notification changes by the operator (branch `co-arrive`, deployed 2026-11-23 on «заливай»)

Branch `co-arrive` also holds: co-rider arrival window in the co-rider sheet / navigation (item 12) and the language rule (I18nProvider saves the language for pushes on every page; rule in CLAUDE.md).
- No prices in notifications: П1/П2/П3 «−30%» (`pct` = group.discountPct); proposal body «· −30% —»; driver proposal «+N% earnings» (`earningsUpPct`). sw.js regexes/texts updated (8 languages).
- П7: pre-bookings are no longer asked — `proposePrebook` creates the group with both YES and runs `finalizePrebookTx` at once (auto pairing and the share board). Live rides still ask the passenger in the car. Board texts (joinSent/sent/subtitle, 8 languages) say «готово, −30%».
- П12 = П11 (`ride.assigned`). П15 removed (was already suppressed for pre-bookings). П16: «К сожалению, водитель не успел выйти на линию вовремя…» (`pre.lapsedLate`; `pre.reassign` for other lapse reasons), now always sent (enqueuePassenger, not DriverNews).
- П19: second passenger reminder 30 min before (`Booking.passengerRemind30At`). В8: second driver reminder 35 min before (`PreAssignment.remind35At`); migration `20261122070000_second_reminders`.
- В8 (operator 23:49): instead of «через 35 минут» a countdown — from 35 to 30 min before pickup (30 = conversion, the driver must be online) one notification `drv.goOnline` «⏱ 5:00 … 1:00 — осталось до выхода на линию», replaced every minute (tag `golive-<booking>`, dedupe per minute, quiet after the first); not sent if the driver is already online.
- REMIND THE OPERATOR (his request): a full second-by-second countdown in the notification becomes possible with the native Android app (notification chronometer / live countdown) — tell him when the native app work starts. Until then only the 5-minute version.
- В3, В6, В7 removed. В4/В5: «Построен новый маршрут» / «Строим новый маршрут», no street; DriverNavigation legKey includes the stop position so a moved stop rebuilds the route too.
- Every remaining push has a MSG_TEXT key (8 languages); `…T`/`…D` params are ISO times shown in Cyprus time in the person's language.
- PARKED (operator): В9 «Pre-booked ride is now active» — «нужно много изменений», still English, untouched.
- PARKED (operator): П6 «поездка с попутчиком не состоялась» (only when nobody takes the pair) — «есть вопросы и решения, потом»; П18 no-show (text and the fee amount) — «там есть о чём поговорить».
- Tests: 371 passed / 1 skipped. Before/after images: /tmp/shots/notif-d-*.png.

## 2026-11-22 (22:30) — Co-rider notifications in the app's / phone's language (deployed)

- NotificationOutbox.msg (JSONB, migration `20261122060000_push_msg`): text key + values next to the English title/body; carried through claim → payload (`PushMsg` in src/server/push.ts; `enqueuePassenger/enqueueDriver/enqueuePassengerDriverNews` accept `msg`).
- public/sw.js `MSG_TEXT` + `msgText`: 8 languages, `{…C}` values are euro cents formatted with Intl for the language; language = the app's saved language (Cache `ily-prefs`) else the phone's. Unknown key / old worker → English.
- Keys now sent: share.joinGuest, share.joinHost, share.confirmed, share.assigned, share.notComing, share.driverLeft, share.notPossible (proposals were already localized by the worker).
- Still English (same mechanism, only keys + texts needed): driver arrived, arrived at stop, no driver available, ride canceled / no-show, driver confirmed / changed / finding another, pre-booking reminder, driver: stop added/removed, start code on/off, upcoming pre-booked ride, pre-booked ride active/update, ride canceled by passenger.
- Tests: tests/sw-push-text.test.ts (every server key in all 8 languages, same placeholders), outbox msg stored.
- Item 12 (arrival window in the co-rider sheet + on the navigation sheet when the co-rider's stop is next) is on branch `push-lang` stash → branch `co-arrive`, NOT deployed (operator: «покажи сперва»).

## 2026-11-22 (21:00) — Lead times in admin, open share board, hint above the date — deployed

- Settings (admin «Настройки»): scheduleMinMinutes 60 (migration `20261122050000_prebook_leads` raises a saved lower value), new `shareMinMinutes` 180 (co-rider pre-booking; server 422 SHARE_TOO_SOON, UI note + validation) and `shareBoardHideMinutes` 240 (board; replaces config boardHideHours 10).
- Open share board: `shareBoard().all` = every other open ride (no names/phones/streets), «Поехать с этим попутчиком» → `/?join=<id>` (BookingApp prefills co-rider + day/window, warns on a different route, proposes after booking via POST /passenger/share-board). GET `/passenger/share-board?ride=<id>`. Entry: account menu «👥 Табло попутчиков», link under the share box. A passenger whose phone is a driver's phone gets no board (`driver: true`) and cannot propose (DRIVER_ACCOUNT). Board error codes translated (8 languages).
- Arrival window: hint «Укажите, когда нужно быть на месте» above the date; the box below only for departure / warnings.
- Full suite 359 passed; Playwright: board → join → booking 201 → proposal sent.
## 2026-11-22 — Ride-share pair: co-rider stops on the driver's live navigation (merged to main, deployed)

- Operator: «начнем с остановки». Before: the live navigation only drove the primary trip; the co-rider's pickup / drop-off were reachable only through the «👥» pill → Google Maps (e.g. host on board → the app routed straight to the host's destination, skipping the co-rider's pickup).
- Now: `src/lib/pair-stops.ts` (`pairStops`, `coRiderNext`) + `src/server/pair-route.ts` (`pairStopsFor`). `driverCurrentTrip` returns `pair: { stops[n, kind, primary, status, name, lat, lng, label, done], next }`.
- `/api/v1/driver/navigation`: when the co-rider's stop is next in the plan, the route goes there (`leg: co-pickup | co-dropoff`; ARRIVED → no route, waiting). Target still comes only from the driver's own accepted pair.
- DriverNavigation: route / hint / sheet follow the next stop; sheet line «Остановка N из 4 · Посадка/Высадка», co-rider name; the stage button becomes «👥 На месте / Посадил / Высадил» and opens the co-rider sheet (event `il-y:open-co-rider`); primary actions hidden while the co-rider's stop is next.
- Map: numbered stop badges (`MapMarker.num/next`, `numberedStopEl`) for every stop still ahead; only the next one is framed (`MapMarker.noFit` for the rest, both Google and MapLibre). The pre-booking pair map (ScheduledRides) now uses the same numbered badges.
- Tests: tests/pair-stops.test.ts, ride-share.db «2026-11-22 … follows the pair's stop order». Full suite 356 passed / 1 skipped.
- Local screenshots /tmp/shots/61-pair-*.png (local map has no tiles and no Google router, so the route line and badges are not visible locally).
- PARKED (operator agreed, «потом вернёмся»): re-plan a pre-booked pair's stop order from the assigned car's position (its location or the end of its current ride), all orders incl. guest-first; only if each passenger stays inside their arrival window / extra-minute limit; price unchanged (SHARED_FIXED); among valid orders pick the least total car km incl. the empty run; once, when the driver is assigned, not later than ~20 min before the first pickup; push to anyone whose pickup time moved. Today `bestPrebookPlan` always starts at the host's pickup (host first). Note: another session reworked pre-booking timing into arrival windows (`arriveFrom/…`, 2026-11-22) — build on that.

## 2026-11-22 (20:00) — Arrival-window fields fit on iPhone, grey «00:00», browser 12/24-hour clock — deployed

- BookingApp `TimeBox`: two equal columns (minmax(0,1fr)), compact, grey «00:00» overlay until a time is chosen; window < 15 min or > 3 h → amber «Окно — от 15 минут до 3 часов» instead of a nonsense departure. globals.css: date/time inputs min-width 0 (iPhone overflow).
- `useT().fmt.time/dateTime` now use the visitor's browser hour cycle (12 h / 24 h) via useSyncExternalStore (language default during hydration); new `fmt.clock('HH:MM')` for wall-clock strings (departure hint). Server-made texts (pushes, board labels) stay 24 h.
- Verified in Playwright: en-US browser «11:06 AM до 12:06 PM», ru-RU «11:06 до 12:06». Full suite passed.

## 2026-11-22 (19:40) — Ride-share pre-booking: «Когда вам нужно быть на месте?» replaces the flexibility choice — deployed

- Operator: «у клиента по заказу ПП нету раздела от и до, она всё ещё про гибкость». With «Попутчик» on in a pre-booking, the share box shows the arrival window (date, «Не раньше», «Не позже», «Выезд примерно с … до …») instead of «Насколько ваше время гибкое?»; the «Подача / Быть на месте» switch and the top inputs are hidden; booking is sent in arrival mode, shareMaxExtraMin = window width (10–60). Share for a ride NOW keeps the detour choice.
- BookingApp: `shareArrive`, `arriveBox` (shared JSX), effect turning arrival mode on. ShareBookingOptions: `arrive` prop. i18n `share.booking.arriveTitle` (8 languages).
- Full suite 357 passed; Playwright: share pre-booking POST 201 with arriveFrom/arriveBy; plain arrival pre-booking POST 201.

## 2026-11-22 (evening) — Town areas for the minimum + arrival window «Быть на месте с … до …» — deployed to main

- Min-fare areas added for Limassol, Larnaca, Paphos, Ayia Napa/Protaras (migration `20261122030000_min_fare_more_towns`), SWITCHED OFF at €20/€20 until the operator prices and activates them. Admin list: Comfort/XL inputs + «Сохранить» per area; every area coloured on the map (off ones labelled «выкл»).
- Arrival window (branch `arrive-window`, rebased, migration renamed to `20261122040000_arrive_window` so it runs after the deployed ones): passenger «Быть на месте» mode, matching/board require both co-riders to arrive inside their windows, a live co-rider never makes a host late (`hostArrivesInTime`), window shown in «Мои предзаказы», driver pre-booking list/pair stops/card, dispatch/admin list + detail, driver current trip (DriverNavigation) and passenger tracking (TrackApp).
- Full suite 357 passed; arrival booking smoke-tested in Playwright (POST 201).
- Open: pushes still English; ShareDriver legs do not show the window yet.

## 2026-11-22 — Pre-booking minimum by AREA, edited in admin — deployed to main

- Replaces the env/town-radius rule of the previous entry. Table `MinFareZone` (name, polygon, comfortCents, xlCents, active); migration `20261122020000_min_fare_zones` seeds «Район Никосии» (whole Nicosia district, approximate outline) at Comfort €20 / XL €20 — the operator sets XL in admin.
- Rule (`src/lib/prebook-min.ts` `minFor` / `bookingMin`, loader `src/server/min-fares.ts` with 30 s cache): pre-booked, pickup AND drop-off in one active area (smallest wins), not fixed/shared → min by class. Used in quote (line `prebookMin`, `minCents`, `minZone`), driver offer / free orders / pre-booking board ranges, close sheet, settlement (422 BELOW_MINIMUM), stop added mid-trip.
- Admin `/admin/min-fares` («Минимум предзаказа» in the nav): map with areas, draw/drag corners, ↶ step back, Comfort/XL prices, on/off, delete; audit events MIN_FARE_ZONE_*. API `/api/v1/admin/min-fares[/id]`. `ZoneEditorMap.airport` is now optional.
- Tests: tests/prebook-min.test.ts, tests/pricing.db.test.ts; full suite 353 passed.

## 2026-11-22 — Pre-booking minimum in Nicosia (€20) — deployed to main

- Operator: a PRE-BOOKED ride inside Nicosia costs at least €20; above €20 the meter counts. Our commercial rule, not a regulated figure.
- `src/lib/prebook-min.ts`: `prebookMinCents` / `bookingMinCents` — scheduled AND pickup + drop-off in the Nicosia area (SHARE_TOWNS NICOSIA, 11 km), never fixed/shared fares. Env `PREBOOK_MIN_NICOSIA_CENTS` (default 2000, 0 = off).
- Quote: total raised to €20 with line `prebookMin`, range clamped, `minCents` returned. `fareRangeCents/Text(…, minCents)` clamp the ±15 % range (driver offer, free orders, pre-booking board).
- Driver close sheet: note + total ≥ minimum; settlement below the minimum → 422 BELOW_MINIMUM. Passenger stop added mid-trip keeps the minimum.
- Passenger: note under the class prices (testid prebook-min). i18n 8 languages.
- Tests: tests/prebook-min.test.ts, tests/pricing.db.test.ts (full suite 351 passed).
- Branch `arrive-window` (arrival window + driver/dispatch display, commit df13862) is still LOCAL, not deployed.

## 2026-11-22 — ride-share option wording (deployed)

**Change:**
- «−30%» is now a lime badge.
- The note «−30% включится, только когда найдётся попутчик» sits in a highlighted box.
- The question is now «Насколько ваше время гибкое?».
- All 8 languages.

**Checked** locally: a live co-rider proposal to a passenger already in the car, and to the driver. Both in-app cards work.

**Found, not fixed — operator to decide:** pushes other than offers and co-rider proposals reach phones in ENGLISH. `public/sw.js` translates only `offer` and `share-p-/share-d-`. Examples:
- «Your driver has arrived»
- «Co-rider joins / Your price is now €…»
- «Shared ride confirmed»
- «Co-rider left the trip»

## 2026-11-22 — refresh when a resumed app returns, applied everywhere (deployed)

New `src/components/useRefreshOnReturn.ts`. It fires on `visibilitychange` after N seconds hidden, and on `pageshow` from the back/forward cache.

**Used on:**
- the passenger home position (60 s);
- /rides, /rides/[id] and the receipt;
- /prebookings and /share-board;
- the driver's EarningsReport, DriverAnalytics and ScheduledRides;
- the driver's pre-booking badge poll.

**Already OK:**
- TrackApp: reloads on visibility, every 5 s.
- DriverHomeMap: reloads on visibility.
- useLiveLocation: restarts its watch.
- The driver's GPS: a fresh fix via keep-alive; it never resends an old fix.
- Driver current-trip: polled every 2 s.

**New rules in CLAUDE.md:** check the whole project for the same pattern, and handle resumed apps.

## 2026-11-21 — passenger position refreshed when the app returns (deployed)

**Problem:** an installed PWA is resumed rather than reloaded, so the home screen kept the pickup from the last visit (80 km away).

**Fix** in `BookingApp.tsx`: on `visibilitychange` after more than 60 s hidden (or on `pageshow` from the back/forward cache), the position is detected again with `maximumAge: 0`. The auto-set pickup moves only if the passenger has not touched it and has no destination yet.

**Checked:** Chromium simulation (airport → Limassol). Not checked on an iPhone.

## 2026-11-21 — share board «Табло попутчиков» (deployed)

The operator asked to deploy it to try it out.
- **Page:** `/share-board`, back arrow in the top bar. Linked from «Мои предзаказы».
- **Code:** server `src/server/share-board.ts`; API `/api/v1/passenger/share-board`.
- **What is listed:** unpaired co-rider pre-bookings on the same corridor (same pickup zone → same drop-off zone, same class, fits in the car).
- **«Поехать вместе»:** calls `proposePrebook(…, { byBookingId })` at the OTHER passenger's time. The proposer is already «yes» and only the other passenger gets the push. The existing answer flow on /prebookings handles the reply.
- **Limits:**
  - a ride is listed until 10 h before pickup (`SHARE_BOARD_HIDE_HOURS`);
  - the proposer moves at most 180 min (`SHARE_BOARD_MAX_SHIFT_MIN`);
  - the area shown is the town/postcode only;
  - a pair declined once cannot be proposed again;
  - 10 proposals per hour per passenger.
- **Open:**
  - no push when a new matching ride appears on the board;
  - no menu entry besides /prebookings.

## 2026-11-21 — ride-share flexibility (deployed)

The booking form's «Насколько вы гибки?» has three choices: Точно (on time, detour ≤10), Немного (±15 min, ≤15, default) and Очень (±45 min, ≤30).
- Pre-booked pairs can now move the pickup **earlier** as well as later, within each passenger's window.
  - Server: `Booking.shareEarlyMin` (additive migration `20261121010000_share_early`) and `prebookTiming(…, hostEarly, guestEarly)`.
  - Passenger proposal: «Выезд в … — на N мин раньше».
- Tests: `share-timing.test.ts` and ride-share «earlier» pairing. Full suite green (334).
- Idea parked by the operator: a public share board where passengers pick each other. A mock-up was shown; not built.

## 2026-11-20 — pre-booking panel: time-zone note removed (deployed)

Operator: the note under the date in «Запланировать» (Europe/Nicosia / «we will pick a driver») is removed (`BookingApp.tsx`). Times are still Europe/Nicosia. The i18n key `booking.form.timezoneNote` is left in place.

## 2026-11-19 — Driver analytics + earnings chart fix (deployed)

- ☰ → Заработок → tile «Выполнено заказов · Подробнее ›» opens `DriverAnalytics` (back arrow): День / Неделя (Mon–Sun), ‹ › or date picker (Cyprus days). Two tiles: «Выполнено» (count + earned, pending finals) and «Не выполнено» (driver-cancelled rides = REMATCH by this driver + offers REJECTED/EXPIRED, «могли заработать» = final or estimate). Tapping a tile opens its list (back arrow).
- API GET /api/v1/driver/analytics?period=day|week&day=YYYY-MM-DD (src/server/driver/analytics.ts). Passenger cancels are computed but not shown (operator removed that card).
- Earnings «По дням» bars were invisible (column without height) — fixed.

## 2026-11-17 — Map labels: English + «street we are on» chip (branch `map-labels`, NOT merged)
- Google Maps loader `language: 'en'` (street names in English for everyone).
- `googleStreetName` (Geocoding result_type=route, language=en) + `GET /api/v1/places/street` (30 m grid cache, 20/min/IP).
- `src/components/useStreetName.tsx`: hook (refresh after ~80 m and ≥8 s) + chip; on driver navigation (top) and passenger tracking EN_ROUTE/IN_PROGRESS (under the status pill).
- Fewer labels at the normal zoom (only main roads; minor streets, shops, bus stops from z17) is a Cloud Console map-style change by the owner (keyzooms) — steps given to the user in chat; no code.
- Preview screenshots used a mocked street name (no Google key locally). Waiting for «заливай».
## 2026-11-19 — Driver sub-screens get a ‹ back arrow; operator rule recorded (deployed)

- StaffShell (DRIVER): `BackArrow` left of the logo while the driver page shows a sub-screen (pre-bookings, free orders); the page announces it with `il-y:driver-back-visible` and listens for `il-y:driver-back` → map. Hooks sit before StaffShell's early return.
- CLAUDE.md «Operator UI rules»: every new non-main screen gets a back arrow, and the operator is told about it.

## 2026-11-19 — Pre-booking board: «Принятые» count red (deployed)

- ScheduledRides tabs: the «Принятые» count is red like «Свободные предзаказы» (was dark).

## 2026-11-19 — Taken pre-bookings count also red (deployed)

- ☰ «Предзаказы»: the «taken» count is red like the «new» one (operator).

## 2026-11-19 — Driver menu «Предзаказы»: taken + new counts (deployed)

- ☰ row shows a lime count of pre-bookings the driver has taken (`mine`) and a red count of open ones he could take; both from the 30 s board poll and from ScheduledRides `onCount(n, pair, mine)`.

## 2026-11-19 — PARKED (operator: «потом, пока тестируем»): contact phone for guest orders

- With guest ordering (`PASSENGER_GUEST = true`) passengers give no phone, so drivers have no «📞 Позвонить» for the host (chat sheet) nor for the co-rider («👥 Попутчик» pill). Proposed: a required «Ваш телефон для водителя» field (no SMS) in guest orders. Do it when the operator returns to it / when sign-in comes back.

## 2026-11-19 — П/ПП button: no «П» flash before «ПП» (deployed)

- Cause: the pre-booking board reported only the count (`onCount(n)`); the «is a pair» flag came from the 30 s poll, so after releasing a pair the button showed «П» until the next poll. Now `onCount(n, pair)` sets both (stable `onPrebookCount`), and the board poll re-runs at once on tab change.
- Checked with a mocked board: release → back to the map → button reads «ПП» from the first frame (sampled 3 s).

## 2026-11-19 — Driver: pre-bookings in ☰ menu, pulsing П / ПП button (deployed)

- Bottom bar: «Главная», «Свободные» only. ☰ drawer: first row «Предзаказы» (red count) → pre-booking board.
- Home map (no offer, no trip, open pre-bookings > 0): round 56 px button, end-3, top 58 %: «П» lime for a pre-booking, «ПП» bright red (#FF2D2D, white text) when any open one is a ride-share pair (better paid). `.ily-fab-pulse` animates own colour ↔ soft red #C46262 with a halo. EN/other locales: P / PS (`driver.prebookFab`).

## 2026-11-19 — Pre-booked rides: calmer text, one «driver assigned» notice, no «Новый заказ» (deployed)

- track.scheduledNote (8 languages): «Ожидайте — мы уведомим вас, когда будет назначен водитель.» «＋ Новый заказ» removed from the scheduled ride screen.
- `enqueuePassengerDriverNews(db, bookingId, 'assigned'|'change', …)` in src/server/push.ts: rides booked NOW unchanged; pre-booked rides get ONE driver notice (marker BookingEvent `PASSENGER_TOLD_DRIVER`), driver changes (released / lapsed / re-matched / converted again) are silent. Used in preassign, offers, free-orders, assignments, lifecycle rematch, share guest join.
- Ride-share notices (co-rider proposal, joins, cancels/no-show, pair split) unchanged. Passengers cannot change a pre-booking's time themselves yet, so there is no «co-rider moved their time» event to notify.
- tests/prebook-driver-news.db.test.ts; preassign test now expects no lapse notice. vitest 313 passed.
## 2026-11-19 — Ride-share pair details (deployed via main)

- Driver pre-booking detail for a pair (src/server/share-detail.ts): numbered stops on the map in trip order with the route through all of them; per stop: passenger 1/2, pickup/drop-off, approximate address (no house number, position on a ~150 m grid; exact ones open with the ride), planned time, people/children/suitcases and that passenger's price; time + km to the next stop; totals (people, suitcases, km, minutes, extra minutes, sum). Board and accepted list also show approximate addresses for pairs.
- Passenger shared badge: «+N мин» (or «почти не изменится») in addition to price, departure/wait, arrival, co-rider counts.
- Not done yet: co-rider stops as markers on the driver's live navigation map (the co-rider pill opens Google Maps).

## 2026-11-19 — Co-rider offer as a push on top of everything (deployed via main)

- Operator: «предложение попутчика должно выходить поверх всего даже если не в приложении или заблокирован телефон; открывать окно предзаказа».
- Proposal pushes have their own tags (share-p-<group> passenger, share-d-<group> driver); public/sw.js shows them in the app language, requireInteraction + long vibration (stay until answered). Format guarded by tests/share-push.test.ts.
- Pre-booking proposal push opens /prebookings?open=<bookingId> → that ride's page with the proposal and details.
- Ride page with «Попутчик» on asks to turn notifications on (iPhone without Home Screen icon: explains Add to Home Screen — Apple only delivers web push to Home Screen apps).
- Proposal card: date shown when not today, own route line, «Свернуть» to a pill.

## 2026-11-19 — Driver bottom nav softer (deployed)

- BottomNav: 18 px (was 16), font-extrabold, inactive `text-muted/75`, active `text-accent/70`; red count badges unchanged.

## 2026-11-19 — Arrow circle without white edge; arrow outline back (deployed)

- Operator meant the white edge of the CIRCLE: `.ily-nav-ring` has no border now (orange tint + shadow stay); the arrow's white outline is restored.

## 2026-11-19 — Arrow without white edge; turn hint 20 % larger (deployed)

- navArrowEl: the arrow path has no white stroke any more (the white ring around it stays).
- DriverNavigation `nav-hint`: all sizes ×1.2 (texts 15→18, 12→14.5, 17→20.5, 14→17, 13→15.5 px; icon 24→29 px; padding, radius, gap; max width 70→78 %).

## 2026-11-19 — Driver arrow ring back; route line +15 % on driver maps (deployed)

- navArrowEl: white ring (`.ily-nav-ring`, 66 % of the marker, orange tint, white 3 px border, shadow) restored on request; pulse while standing unchanged.
- New `routeWidth` prop (GoogleMapView/MapView, default 7); DriverNavigation and DriverHomeMap (offer route to the pickup) use 8 (= +15 %). Passenger maps stay 7.

## 2026-11-19 — GPS taximeter (deployed 2026-11-19 via main)

- Why: a test ride Limassol → LCA at night: app 80.04 € (= estimate 4.80 + 68.4 km × 1.10, the app never measured the ride) vs the car's taximeter 85.23 € (≈ 73.1 km). Operator: «фактический таксометр будет считать правильнее» — show a GPS meter to compare.
- `src/lib/gps-meter.ts`: urban-meter rules on the driver's GPS track since TRIP_STARTED — distance (€/km) when faster than the cross-over speed (≈17–18 km/h), time (€/h) when slower; day/night per stretch; jumps (>250 km/h) and poor fixes (>50 m) skipped; gaps >30 s charged as straight line × 1.2. Extras as in the estimate (luggage, 5–6 pax, XL, holiday).
- Shown live on the driver's navigation screen (card «GPS-таксометр») and in «Стоимость поездки» under «Итого»; saved on completion in Fare.gpsMeterCents/Km/SlowSec/GapSec (migration 20261119120000_gps_meter). The charged price is unchanged.
- Evidence: vitest 308 passed / 1 skipped (tests/gps-meter.test.ts 6, tests/gps-meter.db.test.ts 1); local build screenshot of the driver screen.
- Next: operator test rides comparing car meter vs GPS meter vs estimate; then decide (charge by GPS meter / wider band / own markup).
## 2026-11-19 — Guest ordering: no sign-in at all for passengers (deployed, for testing) — TO TURN OFF LATER

- Operator: «Без ничего просто открыл заказал, чтобы мог тестировать на разных устройствах».
- `src/lib/features.ts` → `PASSENGER_GUEST = true`. POST /bookings without a session creates a guest Passenger (no email/phone/password) + 30-day session cookie; `createGuestBookingSchema` makes the phone optional (stored ''), empty name → «Guest». BookingApp skips the login modal and hides the contact block for guests (`/passenger/me` → `guest: true`). Ride-share driver card hides «Call» without a phone; navigation chat already hid it.
- To restore mandatory sign-in: `PASSENGER_GUEST = false` (and `PASSENGER_SMS = true` for SMS).
- Checked: vitest 301 passed; iPhone 12 Pro emulation (WebKit), fresh device: destination → «Заказать Comfort» → /track, booking SEARCHING with a guest passenger, no login modal.

## 2026-11-19 — Passenger SMS codes switched OFF for testing (deployed) — TO TURN BACK ON LATER

- Operator: «Убери регистрацию или вход через смс пароль для клиента … Потом вернем».
- `src/lib/features.ts` → `PASSENGER_SMS = false`. Effects: login modal has no «phone» tab (email + password only); sign-up form has no phone field; register API never sends a code (account created at once, `phoneSkipped` false). Drivers' phone sign-in unchanged.
- To restore: set `PASSENGER_SMS = true` (tests follow the flag).
- Checked: vitest 301 passed; sign-up on iPhone 12 Pro emulation (WebKit) → signed in, back on «/».

## 2026-11-19 — Ride-share: Limassol added (deployed)

- `SHARE_TOWNS` + LIMASSOL (34.69, 33.04, 10 km: Germasogeia/Agios Tychonas … Ypsonas/Polemidia). All 7 places (LCA, PFO, Larnaca, Nicosia, Paphos, Ayia Napa, Limassol) pair with each other; never within one place.
- tests/ride-share-limassol.test.ts; ride-share.db test updated. vitest 301 passed.

## 2026-11-19 — Ride-share «Попутчик» merged and DEPLOYED (branch `poputchik` from another session)

- User: «Заливай ветку попутчика». Merged origin/poputchik (978aba5) into main. Conflicts only in docs/HANDOFF.md and prisma/schema.prisma (both sides appended models — kept both).
- Migration renamed `20261119010000_ride_share` → `20261119030000_ride_share` so it sorts after the already-deployed `…010000_dropoff_postcode` and `…020000_osm_places`.
- Local: tsc clean, build OK, vitest 300 passed / 1 skipped, smoke of /, /driver, /prebookings without page errors. Ride-share flows themselves not re-clicked here (the other session did); not tried on a phone.
- Details and limits: Tasks/022-RIDESHARE-POPUTCHIK.md.

## 2026-11-19 — Approaching the drop-off: map closes in step by step (driver + passenger)

- User test: passenger lost the car near the drop-off; driver map zoomed out once to show the point and then did not close in as the car got nearer.
- Driver: DriverNavigation map gets `keepInView` — whenever the follow camera is off, car + point + remaining road stay framed and the zoom increases as the car approaches (Google map; MapLibre ignores keepInView locally).
- `useIdleReturn`: a pointer whose «up» never arrives is forgotten after 8 s, so the automatic camera cannot stay frozen.
- Driver GPS keep-alive: no new fix for 8 s → `getCurrentPosition({maximumAge:0})` for a real current fix; the old fix is no longer re-sent (the server rejected it as OUT_OF_ORDER, so after 120 s the car disappeared for the passenger). Headless Chromium returns a cached timestamp, so this was NOT verifiable locally — check on a phone.

## 2026-11-19 — Passenger tracking: trip in progress without the car's position

- User screenshot (Larnaca airport, «В пути», no car on the map): the map was a close-up of the destination with the route cut off. Cause: no live car position (GPS stale/disconnected — e.g. driver app in the background), so only one marker → `framePoint` close-up, route ignored.
- Fix: TrackApp passes `fitRoute` for IN_PROGRESS too; GoogleMapView/MapView frame «one point + route» like two points (whole route above the sheet). With a live car nothing changes (keep-in-view camera).

## 2026-11-19 — Own Cyprus address base (OpenStreetMap) + destination postcodes — DEPLOYED (unattended, user asleep)

- User: load ALL Cyprus places (restaurants, schools, churches, beaches, hospitals, clinics, every village hotel…) with postcodes, refresh weekly, «прям все грузи и заливай».
- `src/server/osm/pbf.ts`: dependency-free .osm.pbf reader. `extract.ts`: `buildPlaces()` → ~75.4k rows (named POIs by kind, towns/villages/hamlets, one row per street per town, ~26k house addresses), Greek shown in Latin (`greekToLatin`). Postcode: own `addr:postcode` → OSM postal_code polygons → nearest known ≤500 m / ≤3 km. Local run: 74.3k of 75.4k rows have a postcode; 12–17 s; ~420 MB peak.
- Sources: movisda.io `admin/CY-latest.osm.pbf` + `admin/CY-XX-latest.osm.pbf` (north); fallback Geofabrik `europe/cyprus-latest.osm.pbf`; override `OSM_SOURCES`. Geofabrik is NOT reachable from the Claude sandbox, movisda is.
- DB: migration `20261119020000_osm_places` (pg_trgm extension, `OsmPlace` (batch,id) + GIN trigram on `search`, `OsmImport` runs). Search reads latest DONE batch (60 s cache).
- Weekly refresh: worker maintenance (~5 min cadence) → `maybeStartOsmImport()` spawns `node tsx scripts/osm-import.ts` (child process) when no DONE import or older than 7 days; FAILED retried after 6 h; `OSM_IMPORT=off` disables. Docker runner image now also copies `src/` + `tsconfig.json`; worker mem_limit 768m → 1280m.
- `/places/search`: own base first (`provider: 'osm'`, attribution «© OpenStreetMap» under suggestions in PlacesInput + RouteEditor, debounce 120 ms); Photon/Google only when the base has no answer. Popular places resolve coordinates from the base before Google.
- Merged branch `dropoff-postcode`: `Booking.dropoffPostcode` (migration `20261119010000`), chip on driver offer / free orders / pre-bookings / navigation. `lookupPostcode`: address text → own base (≤600 m) → Google → Photon. After each import, open bookings without a postcode are backfilled.
- Manual import inside the app container: `node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/osm-import.ts`.
- Check on prod: `select id,status,rows,"withPostcode",error from "OsmImport"`; search response `provider:"osm"`.
## 2026-11-19 — Ride-share «Попутчик» (Task 022) — LOCAL ONLY, not pushed/deployed

- Operator asked: show before uploading. Everything is in the working tree of this session; nothing committed to `main`.
- See Tasks/022-RIDESHARE-POPUTCHIK.md for the rules, files and known limits.
- Round 2 (same day): towns list instead of «intercity», passenger-chosen wait for pre-bookings, answer ≤ 1 h before pickup, €10 no-show, Google road time with traffic + arrival times + stop order, pairs offered online 30 min before (pre-assigned pair driver waited for until 20 min) — ONLY pairs; other pre-bookings unchanged (15 min).
- Evidence: vitest 294 passed / 1 skipped (16 ride-share tests), tsc clean; local build clicked through
  (booking option, live proposal to passenger + driver, both yes → second-passenger pill, pre-booking proposal, board pair, profile switch).
- Next: operator's OK → commit on a branch, push, deploy (migration `20261119030000_ride_share` runs on deploy).

## 2026-11-19 — Light theme (white app) with per-role choice

- Neutrals/status colours are CSS variables (`--c-*` in globals.css); `<html data-theme="light|dark">` switches them. Tailwind tokens use `rgb(var(--c-x) / <alpha-value>)`; `text-accent` uses a deeper green in light. Lime accent unchanged.
- Pre-paint script `THEME_SCRIPT` (src/lib/theme-script.ts) in `<head>`; `ThemeSync` re-applies on navigation / system change. Prefs in localStorage: passenger `il-y-theme` (system|light|dark, default system), driver/staff pages `il-y-theme-d` (light|dark, default dark).
- `ThemePicker`: passenger account «Цвет приложения»; driver menu Профиль; driver registration step 1.
- Maps: Google `colorScheme` LIGHT/DARK by theme; MapLibre uses Esri Light Gray (or `NEXT_PUBLIC_MAP_TILES_LIGHT`); AutoMapView remounts on theme change. Logo lettering follows theme.
- Not yet reviewed in light: admin, dispatch, chat, receipt. Google cloud map style in light mode unverified locally (no key).

## 2026-11-19 — Other taxis look like the driver's own car (driver + passenger maps)

- `vehicleMarkerEl` gained `state: 'peer'`: same `selfCarSvg` car, lightened (CSS filter), used at 46 px (35 % smaller than own 71 px).
- New `fleetLikeSelf` prop on GoogleMapView/MapView; set on DriverHomeMap and the passenger BookingApp map. Fleet data unchanged (anonymised `publicFleet`).
- Local screenshots checked (driver home, passenger home). Deployed via ff-merge to main.

## 2026-11-19 — Quiet turn hint back; no ring; notices auto-hide (deployed)
- DriverNavigation: the manoeuvre/status content is back as a small dark see-through card top-left (`nav-hint`, 30 % background + text shadow — user asked twice for more transparency): lime manoeuvre icon, distance 17 px, instruction 12 px muted; also needGps / rerouting / unavailable + Google Maps / arrived states.
- navArrowEl: white ring removed; orange pulse only while standing (ily-moving hides it).
- driver/page: `banner` notices (e.g. OFFER_EXPIRED «Срок предложения истёк» after tapping «Взять заказ» too late) auto-hide after 6 s.

## 2026-11-19 — Navigation: no top banner, bigger orange arrow in a ring (deployed)
- DriverNavigation: manoeuvre banner and the notice strip («Срок предложения истёк» etc.) removed; only the safe-area spacer; voice prompts unchanged.
- navArrowEl: 120 px box, orange #FF9F1C arrow with white outline inside a white ring (orange tint), orange pulse when standing.

## 2026-11-19 — Driver sees the price as a range (deployed)
- `fareRangeText` (src/lib/price-type.ts): taximeter estimate → ±15 % (same as passenger quote), fixed fare → one amount. Used on offer sheet, free orders (list + detail), pre-bookings (list + detail). «По таксометру — оценка» / «Фиксированная» labels removed.

## 2026-11-18 — Softer 1–3★ suggestions (deployed)
- Same slugs (late, unsafe_driving); labels «Подача позже», «Хотелось бы лучше» (8 languages); comment placeholder for 1–3★ «Что можно улучшить? (необязательно)» (rides.rate.commentPlaceholderLow). Comment always optional (client + server).

## 2026-11-18 — Smaller rating card + cancel → same route (deployed)
- RateTripModal: 2 suggestions per band (positive: safe_driving, clean_car; constructive: late, unsafe_driving), one-line comment field (44 px). Finished screen: no «Заказать ещё поездку» button (× starts a new booking), no «Поездка завершена» pill on the map.

## 2026-11-18 — Cancel → straight back to ordering the same route (deployed)
- TrackApp `repeatSameRide()`: after the passenger cancels, store route + stop + class (il-y-repeat) and go to «/», which opens at the class/price step («Заказать Comfort»). «Заказать ещё раз» uses the same helper.
- Checked locally: cancel EN_ROUTE ride → «/» with Amerikanas → Larnaca Airport priced, «Заказать Comfort».
- Also showed the user the end-of-trip rating card (5 stars, tags, comment).

## 2026-11-18 — Receipt page trimmed (deployed)
- /rides/[id]: date only (no class / passengers), no driver block, no «Оценка стоимости» lines, «Итого» (never «(оценка)»), no taximeter note, no payment status (it was always «Ожидает оплаты»: nothing sets COLLECTED). Payment method, e-mail, rating kept.
- Note: older parked branch `receipt-ru-en` overlaps (RU/EN receipts, waiting in total); reconcile when the user returns to receipts.

## 2026-11-18 — Offers / free orders / pre-bookings: no price details, class badge, route on map (deployed)
- «Подробнее о цене» removed (offer sheet, free order, pre-booking detail). Passenger count/luggage removed; `ClassBadge` (bold, soft grey outline + text, «COMFORT»/«XL» — user asked for less attention) on offer, free order (list + detail) and pre-bookings.
- DriverHomeMap `dropoff`/`via`: one /routes/estimate per offer → route pickup → (stop) → destination drawn and fitted (offer + free order). Pre-booking detail already drew its route.
- Locally no road route (no Google key) — markers fit; route line only on prod.
- Pre-bookings: no «✈ Аэропорт» chip next to the class (user: nothing left of COMFORT).

## 2026-11-18 — Driver bottom nav text only (deployed)
- No emoji; labels 16 px bold; red counts at the word top corner.

## 2026-11-18 — Driver side menu instead of the Profile tab (deployed)
- Bottom nav: Главная / Свободные / Предзаказы (Profile removed). StaffShell header (DRIVER only): ☰ top-RIGHT → window event `il-y:driver-menu`.
- Driver page: drawer from the RIGHT (86 % wide, max 400 px, 300 ms slide, backdrop closes) with Профиль / Поездки / Заработок; «Мои поездки / заработок» links on home open it.

## 2026-11-18 — Driver home shows only problems; notifications row in profile (deployed)
- Home: GPS pill only when GPS is off (red) or the fix is weak (amber); no «GPS включён». Notifications pill (`NotifyToggle onlyProblems`) only when off/blocked (red), hidden when working.
- Profile: «Уведомления» row with status / turn-on, next to «Язык». Key driver.profile.notifications (8 languages).

## 2026-11-18 — «Выйти на линию» also turns on GPS (deployed)
- driver/page.tsx `setDuty(true)` calls `startGps()` inside the same tap (permission prompt allowed) unless already active. Checked locally: tap → online + «GPS включён».

## 2026-11-18 — Glint v2 + Samsung Internet hint (deployed)
- EdgeShine v2: conic spark (bright core + soft halo, weaker spark opposite) travelling round the rim with the tilt (gamma ±35° → ±80°), 2 px ring, light drop-shadow — user said v1 looked like «a simple wave».
- Forced dark persists on Z Fold 7 despite color-scheme meta → `SamsungDarkHint` (layout): Samsung Internet UA only, one-time card «≡ → Settings → Labs → Use website dark theme, or install from Chrome», 8 languages (common.samsungDark), dismiss stored (il-y-samsung-dark-hint).

## 2026-11-18 — Every driver action button one size + glint (deployed)
- DriverNavigation `STAGE_BTN`: «Еду к клиенту», «На месте», «Начать поездку», stop «На месте»/«Продолжить» = 65 % wide, 53 px, round, bold, EdgeShine; stop «Ожидание» and start-code button same height + glint; ☰ menu buttons same size (release min 260 px so the text fits).
- Together with earlier: «Выйти на линию», swipes «Уйти с линии»/«Завершить поездку», fare confirm — all the same size with the glint.

## 2026-11-18 — Driver buttons: same size, 20 % thicker, rim glint on tilt (deployed)
- «Выйти на линию» 65 % wide like the swipe bars; swipes + online button + fare confirm 53 px high, 16 px text.
- `src/components/EdgeShine.tsx`: 1.5 px rim highlight whose position follows the phone's left/right tilt (deviceorientation gamma, one shared rAF-throttled listener, removed when no button is mounted). iPhone: «Motion & Orientation» asked once on the first tap while a glint button is mounted; «denied» remembered in localStorage (il-y-tilt-asked), never asked again.

## 2026-11-18 — Samsung Internet forced dark mode (deployed)
- Z Fold 7 showed «Уйти с линии» red with white text = Samsung Internet's forced dark mode recoloring the light orange. Added `<meta name="color-scheme" content="dark">` (viewport.colorScheme) and swipe bars paint their colour as a gradient image layer (`bgColor`).
- Samsung says developers cannot fully switch its dark mode off; if it persists the user can set Samsung Internet → Settings → Labs → «Use website dark theme», or install the app from Chrome.

## 2026-11-18 — Swipe to finish / go offline (deployed)
- `src/components/SwipeButton.tsx`: slide knob ≥85 % (left→right; RTL mirrored), tap does nothing, Enter/Space for keyboard.
- Driver: «Завершить поездку» = swipe, dark red #7A1E1E (fare sheet confirm also dark red); «Уйти с линии» = swipe, brighter orange #FFA94D with dark text; both swipe bars 65 % width, height 44 px (user: thicker), text 15 px. No knob circle: three arrows travel with the finger, the whole bar is the swipe area. «Выйти на линию» stays a tap.
- Checked locally with Playwright: tap / half swipe do nothing, full swipe goes offline / opens the fare sheet.
- Fare sheet confirm (second step, kept by the user): dark red, 65 % width, 44 px high.

## 2026-11-18 — Driver navigation sheet: no «Подробнее», ☰ menu, payment after start (deployed)
- Details section removed (passenger note + flight stay visible in the sheet).
- ☰ button right above the stage button, right side, moves with the sheet (ASSIGNED/EN_ROUTE/ARRIVED) → sheet with «Не могу взять — отказаться» → existing confirm.
- cash/card badge only when IN_PROGRESS. New key driver.navigation.menu (8 languages).


## 2026-11-18 — Passenger tracking: nose forward, whole route in view, economical (deployed)
- carMarker `steerVehicle`: per-frame nose along the glide path tangent (look-ahead 8 %), eased; GoogleMapView vehicle glide uses it when a route is drawn (no sideways from off-road GPS fixes).
- GoogleMapView `keepInView` + `cameraFor` (Web-Mercator fit): moves the camera only when a point leaves the padded view or the remaining route allows ≥0.6 zoom closer; ≤1 move / 3 s; 1 s ease. Old fit no longer re-fits on every route change in this mode. Polyline updated with setPath.
- TrackApp: no car-follow camera; ASSIGNED/EN_ROUTE/IN_PROGRESS → keepInView + route trimmed behind the car (`trimRoute`, keeps 40 m). Route fetched once per leg, again only if the car is > 50 m off it or after 2 min (min 15 s) — was every ~10 m of movement (many Routes API calls).
- Verified locally only on the MapLibre fallback (no crash, 1 route fetch / 12 s); Google-map behaviour needs a real ride.

## 2026-11-18 — PARKED until the app launch: Google Places API (New)
- Decision (user): before launching in the app stores, enable **Places API (New)** in Google Cloud for the server key (APIs & Services → Library → Enable; Credentials → server key → API restrictions → add it). Then verify `/api/v1/places/search` returns `provider: "places"`.
- Until then address search uses Photon (public OSM demo service, no guarantee; fine for a few hundred orders/day).
- Remind the user at launch preparation. Other parked items: receipts RU/EN (`receipt-ru-en`), map labels (`map-labels`).

## 2026-11-18 — Streets and hotels by the first letters (deployed)
- Google Places autocomplete fails on prod (falls back) → `src/server/photon.ts`: OpenStreetMap search-as-you-type via photon.komoot.io (public, fair use; 2.5 s timeout; 10 min cache; Cyprus bbox; near bias; lang en). Streets, houses, hotels (kind hotel → bed icon).
- `/places/search` without Places: popular → Photon → Google geocode (only real addresses), parallel, max 10. Tests: tests/photon.test.ts.
- If traffic grows: self-host Photon or enable Places API (New).

## 2026-11-18 — Own frequent places first, then popular places near → far (deployed)
- `/passenger/destinations`: last 100 rides (no CANCELED), pickups (0.6) + destinations (1), points < ~120 m merged, map pins skipped; most used first, then recent; up to 8.
- Popular list +22 places (cruise terminal, City of Dreams, Molos, beaches, universities, hospitals, malls, waterparks, Cape Greco, Latchi…); `src/server/popular.ts` (parallel cached lookups) + `GET /api/v1/places/popular?near=` (nearest 6).
- RouteEditor empty box: own places → «Популярные места» (nearest first). Typing: own matches → popular (server) → Google.
- Tests: saved-places.db (frequent places), popular-places.

## 2026-11-18 — Popular places first in address search (deployed)
- `src/lib/popularPlaces.ts`: 22 popular places (airports, harbours, marinas, malls, hospitals, beaches) with ru/el/en words + town names; `matchPopular` (word starts, nearest town first, then importance). Coordinates: known ones from the demo fixtures; others via `googleFindPoi` (geocode, only establishment/landmark, no partial match), cached in the search route.
- `/places/search` puts them on top (dedup), also when Google search fails. RouteEditor shows a ☆ icon. Tests: tests/popular-places.test.ts.
- «пафос» → Paphos Airport (PFO), Paphos Harbour (+ Kings Avenue Mall / hospital on prod if Google resolves them).

## 2026-11-18 — Faster address search (deployed)
- `googleAutocomplete(..., near)`: with the passenger position → locationBias circle 25 km + `origin`; otherwise Cyprus rectangle. `/places/search?near=lat,lng` (Cyprus range only).
- `src/lib/nearHint.ts`: position hint (BookingApp sets myLoc ?? pickup), `foldText` (Greek→Latin, accents, case), `localMatches`. Tests: tests/near-hint.test.ts.
- RouteEditor: own places (custom too) and recent trips that match the typed words show instantly above Google results; debounce 250 → 200 ms. PlacesInput sends the hint too.
- Prod search quality not verified by me (no key locally) — user to try.

## 2026-11-18 — Saved places polish + map/clear buttons in every address search (branch `saved-places-2`, NOT merged)
- «Мои адреса»: no «Другой адрес» row; name placeholder «Название вашего адреса» (8 languages).
- PlacesInput (`mapPick`, default on unless read-only/trailing): × clear + «На карте» target button that opens AutoMapPicker in a portal → used in «Мои адреса», account saved places, tracking destination change.


## 2026-11-18 — Saved places from the start screen (deployed)
- `SavedPlace.name` + migration 20261118010000_saved_place_name; kind `C_<uuid>` = passenger's own named places (max 20).
- `/api/v1/passenger/places`: GET adds `custom`; PUT kind CUSTOM creates, C_<id> changes / removes (null). Tests: tests/saved-places.db.test.ts.
- `src/components/booking/SavedPlacesSheet.tsx`: «+ Дом/Работа» opens the address editor right on the start screen; set pill: tap = ride, hold 0.55 s = change/delete; «Ещё» = «Мои адреса» (search another address, Home, Work, own places with ✎, «Добавить адрес»). PlacesInput got `labelText`.
- 13 new booking.form.* keys in 8 languages.
- Full suite: preassign «offline driver at the cutoff» failed once in the full run, passed alone (local leftover state).

## 2026-11-18 — Driver GPS auto-start quiet on refusal (deployed)
- User (Samsung S26 Ultra, installed driver app) saw the big «location blocked» text after opening the app.
- The automatic GPS start (reopen, 2026-11-17) now runs only when the page is visible and shows no alarm if the phone refuses; the instructions appear only after the driver taps «Включить GPS» (`autoStartRef`).
- Denied text (ru/en) rewritten for the installed app: long-press icon → App info → Permissions/Site settings → Location.
- Checked locally (Playwright, location blocked): auto-start → no warning; tap → warning.
- Open question to user: does tapping «Включить GPS» work on that phone? If still denied → the site/app permission really is blocked on the phone.

## 2026-11-18 — Lower passenger start sheet (deployed)
- Start screen (collapsed, no address open): eyebrow «Довезём куда нужно» hidden, title text-lg, recent rows h-9, quick picks mt-1.5, peek margin 8 px, min peek 110 px. Measured locally 420×912: 233 → 195 px.

## 2026-11-18 — iPhone home-screen app: empty band at the bottom (deployed, unverified on device)
- User (iPhone Air, standalone app): dark empty band below the start sheet + extra space in it. Matches the known iOS standalone bug: after the keyboard opened once the viewport stays ~59 px shorter for the session.
- `src/components/IosViewportFix.tsx` (in layout): iOS standalone only; on focusout / return to the app, if innerHeight is below the session peak and no field is focused, hide body for one synchronous reflow and restore it (+ inner scroll positions).
- Needs a real-device check by the user; if the band remains, next step: inspect innerHeight vs screen height on the device.

## 2026-11-17 — Map closes in when approaching the pickup / drop-off (deployed)
- `src/lib/nav-zoom.ts`: `navZoomForApproach` (last 600 m: 17 → 18.5, full from 80 m) + `navZoomTarget` = max(speed zoom, approach zoom); tests in tests/nav-zoom.test.ts.
- DriverNavigation uses `navZoomTarget` with the remaining route metres (also when the car stops).
- Passenger tracking IN_PROGRESS follow camera: 16 → 17.5 within 600 m of the drop-off.

## 2026-11-17 — PARKED: map labels (branch `map-labels`, pushed, not merged)
- Contains: Google map language `en`, «street we are on» chip (driver navigation + passenger tracking), `GET /api/v1/places/street`.
- Also pending on the owner side: Cloud Console map style keyzooms (local road labels, POI, transit off below z17).
- User said «отложи на потом». When they return to it: show the screenshots again (chip) and repeat the Console steps; merge only on «заливай».

## 2026-11-17 — Reopen the app during a ride → back on the ride (branch `resume-active`, NOT merged)
- New `GET /api/v1/passenger/active`: the passenger's live ride (ASSIGNED/EN_ROUTE/ARRIVED/IN_PROGRESS, or REQUESTED/SEARCHING for an immediate order).
- BookingApp: once per app launch (sessionStorage `il-y-resume-checked`, also set by TrackApp) a signed-in passenger with a live ride is taken straight to /track (loading cover meanwhile); going home on purpose afterwards still works.
- Driver: the ride screen was already restored from the server; now GPS also switches back on by itself (once per launch) when on a ride or on duty.
- Checked locally with Playwright (fresh browser context = app closed): passenger `/` → `/track`; driver `/driver` → navigation screen with GPS on. Waiting for «заливай».

## 2026-11-17 — Bold rounded route line + smooth car turning (branch `smooth-route`, NOT merged)
- `src/components/routeSmooth.ts` rounds every route bend (quadratic curve, ≤25 m cut) for display; tests/route-smooth.test.ts.
- Route line 7 px (was 4) in GoogleMapView and MapView; the car glides along the same rounded line.
- carMarker `orientVehicle`: new travel direction turns over 0.6 s the short way; map rotation stays instant.
- Driver follow camera: linear over the gap between fixes (0.6–2.5 s) instead of an 800 ms ease + pause.
- Waiting for user «заливай» before merging to main.

## 2026-11-17 — Driver ↔ passenger delay: instant status, smooth car, economical GPS kept

- Owner: keep GPS/battery as is (driver sends every 5 s, passenger polls every 5 s), make the car smooth and status fast.
- `GET /api/v1/tracking/stream` (SSE, tracking cookie): checks booking status/revision/updatedAt + latest chat id every 1 s,
  sends `data:` on change, ping every ~15 s, closes after 55 s or at COMPLETED/CANCELED (EventSource reconnects).
  Headers: no-cache, X-Accel-Buffering: no, Content-Encoding: none. TrackApp opens it while the ride is active and reloads the view
  on each event (+ one retry 0.7 s later). Measured locally: status change visible on the passenger page in 0.2–1.1 s (was 0–5 s).
- Background pushes («driver assigned», «driver has arrived»…): `enqueue()` now kicks an in-process `drainOutbox` 300 ms later
  (skipped under vitest/test) instead of waiting for the 2 s worker tick; SKIP LOCKED keeps it safe.
- Car on the passenger map (GoogleMapView): glide starts from the drawn position, lasts ≈ the gap between updates (0.9–6 s, linear)
  so the car keeps rolling, and follows the drawn route line around corners (`src/components/routeGlide.ts`, tests/route-glide.test.ts).
- NOT verified on prod: SSE through nginx (`X-Accel-Buffering: no` should disable buffering; the 5 s poll remains the fallback).
- Note: passenger push texts are English only (server-side), separate improvement.

## 2026-11-17 — Schedule panel without «Ехать сейчас»

- The «Ехать сейчас» link in the schedule panel is gone; the «Запланировать» pill toggles schedule off.

## 2026-11-17 — PARKED: receipts RU/EN (owner: «вернёмся к чекам, когда скажу») — DEPLOYED 2026-11-19 (see below)

- Ready, NOT deployed, on branch `receipt-ru-en` (pushed to origin, commit «receipts: Russian/English …»). When the owner says
  «вернись к чекам», show the last preview (screenshots: rides list «→ destination» + same total; receipt in RU for a Russian app,
  EN otherwise with a language picker EN/RU/others; one «Итого» incl. waiting, no tariff/waiting lines, no «Ожидает оплаты»;
  e-mail only RU/EN) and ask whether tariff lines should come back (they don't add up to the total without the waiting line).
- To deploy: `git checkout main && git merge receipt-ru-en`, run vitest + build, push.

## 2026-11-17 — «Запланировать»: the pill itself toggles

- No separate track/knob: the clock pill is the switch — outline = off, lime-filled = on; tap again → «now».

## 2026-11-17 — «Запланировать» is a switch

- Start-row schedule chip = role="switch" with a small track/knob: tap on → schedule panel; tap again → back to «now» (same reset
  as «Ехать сейчас»). Clock icon dropped, 12 px text, start placeholder 15 px so «Пункт назначения» fits on 390 px.
- datetime-local field: block/w-full/min-w-0/appearance-none (iOS Safari overflowed the panel on the owner's phone).

## 2026-11-17 — Compact start sheet (deployed)

- Start screen (no address editor open): smaller eyebrow/title, «Пункт назначения» row 44 px, quick-pick pills 32 px / 13 px,
  recent rows 40 px, less top padding → sheet ~70 px lower, more map. Address editor unchanged.

## 2026-11-17 — Language choice: RU / EL / EN + the phone's own language (passenger and driver)

- LanguageSwitcher `only=[ru, el, en]` now also lists the current language and the device/browser language (navigator.languages,
  first supported one). Used in the passenger account menu (new) and the driver profile. The automatic language (Accept-Language)
  is unchanged: a German phone opens in German and shows «DE · Deutsch» next to RU/EL/EN; an Italian phone (unsupported) gets
  English and only RU/EL/EN. Checked locally with Playwright for de-DE, de-DE+cookie ru, ru-RU, it-IT.

## 2026-11-17 — Two fingers: zoom and rotate at the same time (Google maps)

- New `src/components/useTwoFingerCamera.ts`: while two touch pointers are down inside the map, their pointer/touch events are
  stopped at window capture (Google never sees them; a synthetic pointercancel ends Google's one-finger pan cleanly) and the
  camera is driven directly: zoom = z0 + log2(spread ratio), heading = h0 − finger rotation, around the map centre.
  One finger stays Google's pan. Used in GoogleMapView (all interactive maps: booking, tracking, driver home/navigation) and
  GoogleMapPicker. MapLibre fallback already zooms+rotates together natively.
- useIdleReturn ignores untrusted (synthetic) pointer events; the gesture breaks follow mode like any touch.
- Checked with a temporary harness page and CDP multi-touch in Chromium: spread ×2 + 90° turn → zoom +1 and heading −90 in one
  gesture, no events reached the map underneath; one-finger pan still passed through. Not checked on a real phone / Google map.

## 2026-11-17 — Quick picks under «Пункт назначения» (deployed)

- Start screen (signed in, no destination yet): pills 🏠 Дом, 💼 Работа (saved → one tap sets the destination and goes to the
  price step via the «repeat» path; not saved → dashed «＋ Дом» → `/account#places`), «••• Ещё» → opens the destination
  route editor (all saved places + recent + search), and the last 3 distinct destinations below.
- Collapsed-sheet height now includes the quick picks.
- Saved places: new kind SCHOOL (API `/passenger/places` returns `school`; account «Сохранённые места» has 🎓 Школа; route editor
  lists it). The start-screen School pill was replaced by «Ещё» at the owner's request.
- i18n: booking.form.school/addPlace/more, auth.places.school/saveSchool, updated places subtitles — all 8 languages.
- vitest 256 passed / 1 skipped; checked locally with Playwright.

## 2026-11-17 — No-driver state: no map pill, shorter note

- TrackApp: no status pill on the map for NO_DRIVER (the sheet says it). `track.noDriverNote` without «…или отменить заказ»
  in all 8 languages.

## 2026-11-17 — Searching screen: no folded panel

- TrackApp: while SEARCHING the info panel is always open (`panelOpen = sheetOpen || searching`; handle hidden, swipe/tap ignored);
  the folded «searching-compact» block (route + cancel) is removed. Other statuses fold as before.

## 2026-11-17 — Fixed airport fares: admin map editor (deployed, no zones yet)

- New table `FixedFareZone` (migration 20261117030000_fixed_fare_zone): airport (PFO|LCA), name, polygon [[lat,lng]…],
  comfortCents, xlCents, active.
- Admin «Фикс. цены» (`/admin/fixed-prices`, ADMIN only): pick airport, «+ Новая зона», tap the map to add corners, drag corners
  (Google: editable polygon with mid-point handles; MapLibre: draggable corner markers), undo/clear, name, Comfort/XL price,
  active toggle; list with edit / deactivate / delete. API `/api/v1/admin/fixed-zones` (GET/POST) and `/[id]` (PUT/DELETE).
- Pricing (`src/server/fixed-fares.ts`, used in `createQuote`): pickup within 2.5 km of an airport and drop-off inside one of its
  active zones, or the reverse, no stop → `REGULATED_FIXED`, total = low = high = zone price (cheapest if zones overlap),
  same day/night, overrides meter/dynamic. 30 s in-memory cache, invalidated on admin changes.
- `src/lib/price-type.ts` `isFixedPrice()` (REGULATED_FIXED | UPFRONT_DYNAMIC) now drives: Fare.finalCents at completion,
  trip-close `upfront`, receipt total/labels, settlement lock, driver offer label «по фиксированной цене».
- Client shows a single price automatically (range low == high). Zones are empty on prod → nothing changes until the owner draws one.
- Tests: tests/fixed-fares.db.test.ts (4). Full vitest 256 passed / 1 skipped. Admin flow checked locally (MapLibre), quote API
  returned REGULATED_FIXED 3500 for PFO → zone and meter outside. Google editor not checked locally (no key).
- Local note: the local test DB lost its migration history; use `npx prisma db push` there (never on prod).

## 2026-11-17 — Google review prompt (deployed)

- Admin Settings → «Отзыв в Google»: Place ID (ChIJ…) or https link → `settings.googleReviewUrl`; public config exposes
  `googleReviewUrl` (Place ID → https://search.google.com/local/writereview?placeid=…). Empty → nothing is shown anywhere.
- `src/components/GoogleReviewCard.tsx`: modal (portal to body, five decorative stars) right after the passenger rates a trip
  on the finished tracking screen; compact card at the bottom of the receipt page; block in the receipt e-mail.
- Shown for every rating (no review gating — Google policy). «Оставить отзыв» → never again on that browser
  (localStorage `il-y-review-done`); «Не сейчас» / backdrop → quiet for the next 5 rated trips (`il-y-review-skip`).
- Finished tracking screen no longer has the «Чек за поездку» box (receipt is in «My rides»).
- No prefilled review text/stars: Google does not support it and its policy forbids it.
- Full vitest 252 passed / 1 skipped; build ok; flow checked locally with Playwright.
- **User action:** create/verify the Google Business Profile and paste its Place ID in admin settings.

## 2026-11-17 — Short receipt e-mail; sign-in button on the receipt page

- Receipt e-mail now shows only: thanks + date/time, pickup → destination, «Итого», «Открыть в IL-Y» button
  (driver, tariff lines, waiting, meter note, payment line, footer, trip number, class and passenger count removed).
  Subject still «Чек IL-Y · поездка #REF» (user not yet answered whether to drop the number there).
- `/rides/[id]` logged out: «Войти» button → `/login?next=/rides/<id>`; login returns there after sign-in.
  `next` accepts only same-site paths (`//evil.com` → `/`). Checked locally with Playwright.
- Google review prompt still on local branch `google-review` (f1e1632), NOT deployed; its template change will need a merge.

## 2026-11-17 — Start-screen «Моё местоположение»: right side, smaller

- Pill moved to the right above the sheet; height 40 px, 14 px text, smaller icon. Still appears only after the map is dragged.

## 2026-11-17 — Map picker: no +/-, «My location» bottom-right, compact buttons

- GoogleMapPicker `zoomControl: false`; MapPicker without NavigationControl (pinch/wheel zoom).
- «Моё местоположение» pill (same style as the start screen) at bottom-right above the map attribution (`picker-my-location`).
- Cancel / Confirm: 44 px high, Cancel compact, Confirm one line (text-sm, nowrap); the "no address" note truncates.
- Google review prompt still on local branch `google-review` (f1e1632), NOT deployed.

## 2026-11-17 — «Моё местоположение» as a pill

- The start-screen location button is now a dark pill with a thin crosshair + text (booking.picker.myLocation), centred above the
  sheet on mobile, bottom-end on desktop (user's reference screenshot). Behaviour unchanged.

## 2026-11-17 — «My location» button on the passenger start screen

- Map views get `recenterTick` (bump → re-run focus/fit, i.e. back to the automatic view) and `onUserMove` (fires on dragstart).
- BookingApp: after the passenger drags the map, a round location button (`data-testid=map-my-location`) appears just above the
  sheet (mobile) / bottom-end corner (desktop); tap → back to own location (or the whole route when one is set), button hides.
- Checked locally (MapLibre): hidden at start, appears after drag, recentres and hides on tap.

## 2026-11-17 — Passenger start screen 30 % further out

- BookingApp start-screen `focusZoom` 16 → 15.49 (map scale × 0.7 = 16 + log2 0.7). Only the client start screen.
- Google review prompt is ready on local branch `google-review` (commit f1e1632, NOT pushed) — waiting for the user's go.

## 2026-11-17 — E-mailed trip receipts

- New table `ReceiptEmail` (migration 20261117020000_receipt_email) + `Passenger.locale` (set from the request language on each booking).
- Completion (`finalizeCompletion`) queues one receipt e-mail in the same transaction when the account has an e-mail.
  Worker section 2b `drainReceiptEmails` claims rows (SKIP LOCKED + lease), builds the receipt from the immutable Fare
  (`buildReceipt`), renders `src/server/email/receipt-template.ts` in the passenger's language (RTL for he/ar) and sends via
  Resend HTTP API (`src/server/email/provider.ts`, Idempotency-Key `receipt-<bookingId>-<resendCount>`). 4xx → FAILED,
  429/5xx/network → RETRY with backoff (6 attempts). Unsent after 7 days → SKIPPED.
- **Not active on prod until** `RESEND_API_KEY` + `EMAIL_FROM` (optional `EMAIL_REPLY_TO`) are in `deploy/.env.production`
  (wired in docker-compose) and the sending domain is verified in Resend. Until then rows wait as PENDING.
- Receipt page (`/rides/[id]`): e-mail status line (masked address), «Отправить ещё раз» (max 3), «Отправить чек на почту» for
  older rides. API `POST /api/v1/passenger/rides/[id]/receipt/email`.
- Fix: receipt total = estimate + waiting (same as the driver's «Итого»), new `fare.totalCents`.
- Pure server translator `src/i18n/translate.ts`; new keys rides.receipt.email* and rides.email.* in all 8 languages.
- Tests: tests/receipt-email.db.test.ts (4). Full vitest 252 passed / 1 skipped. Fresh-DB `migrate deploy` + diff clean.
- Local note: `prisma migrate diff --shadow-database-url $DATABASE_URL` wipes the test DB — reseed with `npm run seed`.

## 2026-11-17 — Full RTL mirroring for Hebrew/Arabic; driver language choice RU/EL/EN

- `<html dir="rtl">` for he/ar (RTL_LOCALES); the old text-only `unicode-bidi` rule is replaced (kept only for inputs).
- Codemod across src/**/*.tsx: physical Tailwind classes → logical (left/right→start/end, ml/mr→ms/me, pl/pr→ps/pe,
  text-left/right→text-start/end, border-l/r→border-s/e). Kept physical on purpose: `left-1/2` centring with translate,
  AccountMenu `sm:right-[var(--menu-right)]` (computed from the physical button rect). LTR rendering unchanged.
- Map containers (GoogleMapView, MapView, both pickers) are `dir="ltr"` — geography never mirrors; the turn-arrow icon too.
- Back arrows (BackArrow, PassengerTopBar) and the account chevron flip with `rtl:-scale-x-100`; → in he/ar catalogs is ←.
- `LanguageSwitcher only=…`: driver profile offers RU/EL/EN only (current language is still listed if it is another one,
  e.g. a Hebrew phone shows HE as the current value). Passenger account menu still lists all eight.
- Checked locally (screenshots he/ar vs ru): passenger home, route editor, tracking sheet, driver home, driver navigation,
  driver profile — mirrored correctly. vitest 248 passed / 1 skipped; build ok.

## 2026-11-17 — Two-finger 360° map rotation (passenger + driver)

- `GoogleMapView`, `GoogleMapPicker`: `headingInteractionEnabled` on interactive maps (vector Map ID), `tiltInteractionEnabled: false`,
  `rotateControl: false`. `MapView` (MapLibre fallback): touch rotate already on; touch pitch disabled.
- New `src/components/mapCompass.ts`: round compass button (lime = north) shown only while the map is turned; tap eases back to north.
  Added at top-right on maps without automatic return (booking start screen, driver home map).
- Maps with automatic return (driver navigation, passenger tracking, idleReturnMs=4000): any touch (incl. rotate) pauses the
  follow camera; after 4 s the map returns to the car and, if not in follow mode, turns back to north. Navigation returns heading-up.
- i18n key `common.mapNorth` in all 8 languages.
- Checked locally on MapLibre (mouse right-drag rotate → compass appears → tap → north, compass hidden). Google rotation not
  testable locally (no key); depends on the production Map ID being a vector map (heading-up navigation already works there).
- vitest 248 passed / 1 skipped; build ok.

## 2026-11-17 — Five more UI languages: Hebrew, Arabic, Polish, German, French

- `src/i18n/config.ts`: LOCALES = en, el, ru, he, ar, pl, de, fr; names, short codes, Intl tags; `RTL_LOCALES = he, ar`.
- New catalogs `src/i18n/messages/{he,ar,pl,de,fr}/` for common, errors, auth, booking, track, rides, driver, driverReg
  (full key parity with English, plural forms per CLDR: fr one/many/other, pl one/few/many/other, he one/two/many/other,
  ar zero/one/two/few/many/other). Staff/admin panel reuses the English catalog for these five (internal tool).
- Language still follows the device/browser (Accept-Language), so a German phone now gets German instead of English;
  unknown languages fall back to English; the driver profile «Язык» switch lists all eight.
- RTL: layout stays left-to-right (maps/sheets positioned for it); `<html data-rtl>` + globals.css `unicode-bidi: plaintext`
  makes Hebrew/Arabic text blocks read and align right-to-left. Full mirrored RTL layout NOT done.
- `public/sw.js`: driver offer push texts in the five new languages.
- Chat auto-translation (previous entry) already uses the reader's locale, so it covers the new languages too.
- Tests: tests/i18n.test.ts checks key parity and placeholders for every locale, new Accept-Language cases, pl/de plurals.
  Full vitest: 248 passed, 1 skipped. Build ok. Local screenshots of he/ar/de start screen checked.
- Translations are machine-quality by Claude, not reviewed by native speakers.

## 2026-11-17 — Driver↔passenger chat auto-translation
**Migration** `20261117010000_chat_translation`: ChatMessage.lang (the sender's UI locale) and ChatMessage.translations (JSONB cache `{lang: text}`; '' means no translation needed).

**Server:**
- `postMessage` stores the sender's request locale.
- `listMessages({reader, readerLang})` translates the OTHER side's messages into the reader's request locale with `googleTranslate` (Cloud Translation v2, same server key), caches per target language and returns `translated`.
- Any API error leaves the original and pauses translation calls for 5 min (logged `[chat] translation unavailable`).
- The passenger (tracking) and driver message routes pass their role and `getRequestLocale()`.

**UI (ChatPanel):** shows `translated` with a small «Переведено · показать оригинал» / «Показать перевод» toggle.

**Tests:** `tests/chat-translate.db.test.ts` (3, Google mocked): Greek driver sees Russian passenger in Greek, own messages untouched, same-language skipped, cache prevents repeat calls.

**OPEN:** the Cloud Translation API must be enabled for the server key's Google Cloud project; until then chat shows originals.

## 2026-11-17 — Language follows the device; switcher only in profiles; no driver top-bar sign-out
**Language:** the locale was already resolved from the `lang` cookie, else the browser/device Accept-Language (never from the phone number).

**Language switcher removed from:** PassengerTopBar, the booking header, the login/register pages (passenger and driver), the driver registration flow and /share.

**Where the language can still be changed:**
- Passenger: the AccountMenu «Язык» row (unchanged).
- Driver: the Profile card, new «Язык» row (removed from the title line).

**StaffShell:** hides the language switcher and «Выйти» for the DRIVER role; drivers have both in Profile. Staff/admin keep them.

**Check:** Playwright (local):
- driver with an el-GR device: Greek UI, no select or sign-out in the header, «Γλώσσα» in Profile;
- passenger with a ru-RU device: Russian, no header select, language in the account menu;
- no errors.

## 2026-11-17 — Booking form: «Запланировать» pill instead of the Now/Schedule switch; no on-map buttons; content-high sheet
**Schedule (approved from screenshots):**
- The «Сейчас / Запланировать» segmented switch is removed; a ride is «now» by default.
- On the start screen's single «Пункт назначения» row there is a «🕒 Запланировать» pill on the right, after a divider (`data-testid=schedule-chip`). Tapping it opens the schedule panel (date and time, Cyprus time note, driver comment) and expands the sheet.
- The panel has «Ехать сейчас» (`schedule-cancel`) to go back to now.
- Once a time is set the pill turns lime and shows HH:MM.
- The pill is not shown in the two-row state or in the route editor; the schedule stays set and its panel remains visible.

**Other changes:**
- No «На карте» (⊕) buttons in the main sheet's address box. The pick-on-map button lives in the route editor.
- The expanded mobile sheet is content-high in every step (`height: auto`, max 100 %), so the map shows above it.

**i18n:** booking.form.later (unused now) and booking.form.rideNow, in ru, en and el.

**Check:** Playwright (local):
- start shows the pill and no ⊕;
- the editor has no pill and has ⊕;
- with a route set there is no pill and no ⊕;
- scheduling shows the time on the pill, and «Ехать сейчас» resets it;
- no errors.

## 2026-11-17 — Unreachable points (e.g. a place pinned in the sea): snap to the nearest street
**Report:** «Molos, Limasol 3036» put the destination in the sea, so there was no route, no price, and the order button was still shown.

**Server:**
- When Google Routes returns no route, `createQuote` snaps each end with `googleSnapToStreet`: a reverse geocode with result_type street_address|route|premise, within 3 km.
- If the route works from the snapped points, it answers NO_ROUTE plus `snapped:{pickup?,dropoff?,stop?}`. The quote route passes `snapped` in the error body.

**Client (BookingApp):**
- On NO_ROUTE with `snapped`, it moves those points (label kept) and the quote runs again, so the price shows and the map shows the street point.
- On NO_ROUTE without `snapped`, ordering is blocked: validate() flags the address with «Машина не может доехать до этой точки. Выберите адрес у дороги.» (new NO_ROUTE text in ru, en and el).

**Tests:** `tests/quote-snap.db.test.ts` (2, Google mocked): a sea destination gives NO_ROUTE plus the snapped street; quoting from the snapped point succeeds with a price.

**Prod probe:** a point about 1 km offshore returned `snapped.dropoff` (a street near the marina); points nearer the coast route directly. Follow-up: only the failing end is moved (single ends tried first, then all), and the snap radius is 5 km.

## 2026-11-17 — Booking: reset × also on the folded route sheet; MapView fit fix
**Reset ×:** the route-reset × (top-right) now also shows on the collapsed sheet that shows the route and «Заказать поездку». Before, it disappeared when the sheet folded.

**MapView fix (fallback map):** an earlier `easeTo({padding})` leaves padding on the map, and `fitBounds` adds its own on top. With both, the bounds no longer fit and MapLibre silently skipped the fit («Map cannot fit…»), so the destination stayed off-screen. The fix is `setPadding(0)` before `fitBounds`. Google is unaffected.

**Check:** Playwright (local):
- the folded sheet has × (48 px) above ⇅ with no overlap, and × clears the route;
- both markers are in view after choosing a destination (they were off-screen before the fix);
- no errors.

## 2026-11-17 — Passenger: no person marker, no «Показать водителю, где я» (for now)
**Change:** the passenger's maps show only the IL-Y pickup logo; there is no «you are here» person on booking or tracking. The «Показать водителю, где я» switch is removed from tracking, so the confirmation-code switch stands alone (no frame).
- BookingApp and TrackApp no longer use `useLiveLocation` for this.
- With no client sending, the driver never sees a passenger person marker.

**Kept for later:**
- `ShareLocationToggle.tsx`, the tracking location API, `passenger-location.ts` and the driver-side marker.

**OPEN (owner, 2026-11-17):** when the full passenger registration is built, ask «Показывать водителю, где я при подаче?» there and bring the feature back from that answer.

**Check:** Playwright (local): home has the logo pin and no person; tracking EN_ROUTE has no share switch, the code switch is present, and the markers are only pickup and car; no errors.

## 2026-11-17 — IL-Y logo as the pickup pin everywhere; passenger start map one zoom level out
**Pin:** `pickupPinEl` draws the brand mark (inline copy of public/brand/mark.svg, exported as `BRAND_PIN_SVG`) at 32×40 px, in its own 500:620 proportions. The tip is on the point and the pulse rings stay.
- The map pickers' centre pin uses the same mark, also 32×40.
- The pickup pin now sits above the «you are here» person (z 950 over 900) on Google and MapView.

**Zoom (passenger start screen only):** BookingApp passes `focusZoom={16}` for its own-location focus while no route is chosen. Before, Google fitted pickup + person (two points close together) and capped at 17, which was too close.
- GoogleMapView and MapView now skip the marker fit when a focus point has its own zoom.
- MapView's `focusZoom` default (15) is now applied inside the component.
- Other screens are unchanged.

**Check:** local Playwright: the pin renders on home and on searching (with pulse); no errors. Zoom levels ≥ 16 have no local tiles, so the zoom was not visually checked.

## 2026-11-17 — Back arrow: one step back, and where it was missing
**New component:** `src/components/BackArrow.tsx`. It goes exactly one step back: `onBack` steps inside a screen; otherwise it goes one page back in the navTrail, or to the fallback when the page was opened directly. Pages using it record themselves in the trail.

**Added:**
- `/login`: before the logo.
- `/register`: before the logo on the form step (page back) and the code step (back to the form); none on the done screen.
- Booking review step (class choice): in the header, back to the form with the route kept.

**Unchanged / no arrow:**
- The booking start screen has no arrow (nothing behind it).
- PassengerTopBar pages (track, rides, account, prebookings, privacy, terms) already use the same trail back.

**Check:** Playwright (local):
- /rides → /login → arrow → /rides;
- /login opened directly → arrow → /;
- home has no arrow;
- review → arrow → form with both route rows;
- no errors.

## 2026-11-17 — Review: airport fixed-fare warning removed
**Change:** the yellow «Поездка в аэропорт или из аэропорта: действуют официальные фиксированные тарифы…» note under the class cards is removed, together with the `AirportFareNote` component. The `booking.trip.airportNote` key is unused but kept.

**Note:** `quote.airport` is still computed server-side.

**Check:** Playwright (local), route to Larnaca Airport: no note; no errors.

## 2026-11-17 — Tracking: searching shows the chosen route; car on its way shows its route in lime
**SEARCHING:**
- The full panel again (title, route box, «Отменить заказ»); the 2026-11-16 auto-fold is reverted.
- The map shows the pulsing pickup pin AND the destination, with the planned route line between them. `fitRoute` frames the whole line above the measured sheet; there is no focus zoom any more.

**ASSIGNED / EN_ROUTE (a car appears):**
- The sheet folds to the headline + driver card.
- The map frames the car → pickup route in the brand lime line (#C8FF46) with `fitRoute`, re-framing as the route updates.

**ARRIVED / COMPLETED / CANCELED:** open as before.

**Check:** Playwright (local) with mocked routes:
- searching: both points and the line are above the sheet (sheet top 302; markers at 286 and 133);
- en route: car, line and pin are visible above the folded sheet (top 520);
- no errors.

## 2026-11-17 — 1-star rating blocks a driver–passenger pair for good; bigger passenger-rating sheet
**Rule (owner):** if the driver rated the passenger 1 star (PassengerRating) or the passenger rated the driver 1 star (TripRating), the two are never matched again.

**Implementation:** `src/server/dispatch/blocked-pairs.ts` (`blockedDriverIdsForPassenger`, `blockedPassengerIdsForDriver`, `isPairBlocked`; `BLOCK_STARS = 1`). It is applied:
- before ranking, in `findBestCandidate` (auto-dispatch offers);
- re-checked in `acceptOffer` (answers OFFER_GONE) and in `claimFreeOrder`;
- in the free-orders list (hidden);
- on the pre-booking board (hidden), in `claimScheduled`, and at pre-booking conversion (lapse to automatic search).

Guest bookings without a passenger account have no identity, so they are not blocked. Admin manual assignment (the audited override) is not blocked.

**Tests:** `tests/blocked-pairs.db.test.ts` (5):
- passenger → driver 1★ skips the nearest driver;
- driver → passenger 1★ skips too;
- 2★ does not block, and other passengers are unaffected;
- a rating that lands mid-offer makes the accept fail;
- free orders are hidden and the claim is refused.

**RatePassengerSheet (approved from a screenshot):** min-h 62dvh, 60 px stars, larger title, comment, button and skip.

## 2026-11-17 — Driver «Стоимость поездки» sheet: only a big «Итого» and a red «Завершить поездку»
**FarePreviewSheet, per the user (shown as screenshots and approved before deploy):**
- Title, then «Итого» centred at 44 px in accent green.
- Removed: the subtitle, the estimate line, the waiting lines (waiting stays included in the total), the meter note and the «Назад» button.
- A tap on the dimmed backdrop closes the sheet instead of «Назад».
- The confirm button is red (`bg-danger`) and reads «Завершить поездку» (el «Ολοκλήρωση διαδρομής»; en was already «Complete trip»).

**Check:** Playwright (local) with a mocked preview: no back button, no wait line, backdrop closes; no errors.

## 2026-11-17 — Driver navigation: speed-dependent zoom
**Behaviour:** the follow camera zooms out as the car speeds up and back in as it slows.
- Up to 20 km/h: zoom 17 (street level).
- 50 km/h (town): 16.3.
- 80 km/h: 15.7.
- 110 km/h and above (motorway): 15.

**Implementation:**
- `src/lib/nav-zoom.ts`: speed comes from the 8 s GPS window (≥ 2 s apart) and is EMA-smoothed (α 0.35, capped at 200 km/h). The zoom moves at most 0.3 levels per fix, with a 0.15 dead band so it does not pump.
- No fix for 10 s means standing, which resets to 17.
- The camera look-ahead scales with the zoom (110 m × 2^(17 − z)), so the car keeps its screen spot.
- The GoogleMapView follow animation now eases zoom as well.
- `data-nav-zoom` on the map wrapper is used by tests.

**Tests:** `tests/nav-zoom.test.ts` (5).

**Playwright (local), simulated GPS:** standing 17 → 50 km/h 16.3 → 110 km/h 15 → 15 km/h back to 17; no errors.

## 2026-11-17 — Booking start sheet: rows never cut; one «Куда» row at the start
**Bug:** the collapsed sheet's peek height was measured to the FIRST readonly input only. With two rows but no full route (e.g. after opening and closing the route editor), the rows were cut and then hidden by useHideClipped. The phone showed only the title and ⇅.

**Fix:**
- Without a full route, the peek is measured to the bottom of the whole `[data-route-box]`, and re-measured when `addrOpen` / `hasStop` change.
- Closing the route editor without choosing anything returns to the single «Куда» row (`addrOpen` false when there is no dropoff, dropoff text or stop).

**Check:** Playwright (local, with and without GPS):
- start: sheet 181 px, «Пункт назначения» visible;
- editor opened and closed: still one row, visible;
- route chosen: 233–236 px, both rows visible;
- no errors.

## 2026-11-16 — Canceled ride: no pill/note, «Заказать ещё раз» repeats the same ride
**Tracking, CANCELED:** the «● ЗАКАЗ ОТМЕНЁН» map pill and the «Этот заказ отменён.» box are removed; the sheet title still says it.

**Repeat button:** «Заказать ещё раз» (new key `track.repeatRide`, ru/en/el).
- It stores {pickup, dropoff, stop, class} in sessionStorage `il-y-repeat` and goes to `/`.
- BookingApp prefills from it and, once signed in and priced, calls `toReview()`. The passenger lands on the class/order step with the same route and class.
- If validation fails (e.g. no phone on the account), the passenger stays on the prefilled form with the error.

**Unchanged:** the × still starts a fresh booking. COMPLETED keeps «Спасибо» and «Заказать ещё поездку».

**Check:** Playwright (local), canceled XL ride: no pill, no note; «Заказать ещё раз» → review with XL selected and «Заказать XL»; no errors.

## 2026-11-16 — Review: whole route visible, no note under the order button
**Review sheet:** the auto-match / tracking / pay-the-driver note under «Заказать …» is removed. Spacing is tighter («‹ Изменить» mb-1, CTA mt-4), so the sheet is lower.

**Map fit:**
- GoogleMapView never re-fitted when `fitPadding` changed: its fit effect was keyed only on markers. That is why the route ran under the review sheet on the phone. It now also keys on `padKey`.
- New opt-in `fitRoute` prop (Google + MapView), used by BookingApp only. The fit includes every route point and re-fits when the route arrives (`routeKey`).
- Tracking and driver maps are unchanged, so a live route does not re-frame every update.

**Check:** Playwright (local) with a mocked bulging route: the whole line and both points are framed above the sheet; no errors.

## 2026-11-16 — Driver GPS on Android/Samsung: clear reasons instead of silence
**Report:** «can't turn on location» on a Samsung S26 Ultra. No real device was available, so this was emulated in Chromium with the Galaxy S24 profile and an Android 16 / SM-S948B Chrome UA.

**Changes in driver `startGps` / `beginWatch`:**
- `navigator.permissions.query('geolocation')`: when the state is `denied`, the denied help shows at once. Chrome and Samsung Internet never prompt again for a blocked site, including the auto-block after the prompt was dismissed a few times.
- POSITION_UNAVAILABLE in coarse mode with no fix means the phone's Location switch is off. That now shows a new `driver.gps.unavailable` message instead of an endless «Поиск GPS…».
- The `driver.gps.denied` text (ru, en, el) now has step-by-step fixes: Chrome 🔒 → Permissions → Location; Android Settings → Apps → Chrome / Samsung Internet → Permissions → Location; iPhone Safari.

**Check:** emulated, local.
- granted: «GPS включён ±8 м».
- denied: the instructions show.
- location off: the «включите Местоположение» message shows.
- No errors.

**Not checked:** a real S26 Ultra.

## 2026-11-16 — Review step: only the class choice; the route shows on the map
**Review content:** the review keeps «‹ Изменить», «Выберите класс» with the cards, «Заказать …» and the small auto-match note. The title «Проверьте заказ» and the Подача / Куда / Имя / Телефон / Заметка rows are gone. Only a scheduled time or the no-quote «by meter» row can still appear.

**Sheet and map (mobile):**
- The sheet is content-high (`height: auto`, max 100 %).
- Its height is measured (ResizeObserver) into `fitPadding.bottom`, so pickup and destination are framed in the map above it.
- The booking map no longer `focus`es the user's own location once both points are set (that re-centred and undid the route fit).
- MapView re-fits when the padding values change (`padKey`, value-based).

**Check:** Playwright (local): review shows class cards plus a CTA only; both route points are visible above the sheet; no errors.

## 2026-11-16 — Booking form: no trip-info box, no price on order buttons
**Form:** the info box («Поездка: ≈ 13 мин · 10,1 км», night/holiday, meter note, airport note) is gone. Only an error line stays if no quote could be made. The airport note still shows on the review screen.

**Buttons:**
- Form CTA: «Заказать поездку», no price.
- Review CTA: «Заказать Comfort / XL» (existing `requestClass` key), no price.
- The ranges stay on the class cards.
- Unused `minQuote`, `eur`, `INTL_TAG` and `locale` were removed.

**Check:** Playwright (local): form has no info box; buttons read «Заказать поездку» / «Заказать Comfort» / «Заказать XL»; no errors.

## 2026-11-16 — Tracking: searching panel starts folded
**Folded panel:** while SEARCHING, the passenger sheet starts collapsed (164 px instead of 363 px on an iPhone 13). It shows the title, a compact two-line route (dots + labels) and a red «Отменить заказ» link that opens the usual confirmation. Swipe or tap expands it to the full sheet.

**Status changes:** going from SEARCHING to ASSIGNED or EN_ROUTE opens the sheet again.

**Pin:** the pulsing pin stays centred in the bigger visible map (padding follows the sheet height).

**Check:** Playwright (local): folded pin y283 vs middle 281; expanded 183 vs 181; cancel confirmation shown; no errors.

## 2026-11-16 — Route editor: small × to clear the typed address
**Change:** the active address field shows a small round × (left of the ⊕ map button) whenever it has text. Tapping it empties the field, drops the selected place, clears the suggestions and keeps focus, so the keyboard stays open.
- New key `booking.route.clear` in ru, en and el.

**Check:** Playwright (local): typed «Larnaca airp» → × → empty, still focused, typing works; no errors.

## 2026-11-16 — Tracking: trip details removed; searching pin centred above the sheet
**Details removed:** the «Показать/Скрыть детали» box (reference, class, «≈» fare, timeline) is gone from the tracking sheet, along with the unused `TIMELINE_KEYS`.

**Pin centring:** the map runs under the sheet.
- TrackApp measures the sheet with a ResizeObserver and passes `fitPadding` = { top 72, sides 40, bottom sheetH + 24 }.
- While SEARCHING it also passes focus = pickup at focusZoom 16, so the pulsing pin sits in the middle of the visible map.

**Map views:**
- Google and MapView focus effects re-centre when the padding changes (`padKey`).
- MapView focus now uses the padding.
- MapView's async single-marker fit no longer overrides a focus point; it was undoing the centring.

**Check:** Playwright (local MapLibre), searching ride: pin y183 vs visible-area middle y181 (sheet top 302); no «детали»; no errors.

## 2026-11-16 — Review: no «Когда: Сейчас» and no «Стоимость» rows
**Review screen:**
- The «Когда» row is shown only for a scheduled ride.
- The «Стоимость» row is gone, because the range is on the class cards and the CTA. It remains only as the «by meter» fallback when there is no quote.

**Check:** Playwright (local): the review shows Подача / Куда / Имя / Телефон, then the class cards; no errors.

## 2026-11-16 — Booking shows only the ±15 % range; XL has its own price
**Display:** passengers no longer see the «≈ total» figure. The class cards, the review row, the CTA and the price-updated banner show only `low–high` (±15 %). An upfront fare (low = high) shows one price. The form CTA «от …» uses the lowest range bottom.

**XL price:** `computeMeterEstimate({vClass})` adds an `xl` line of +40 % on initial hire + distance.
- This is OUR commercial setting, not a regulated figure; the owner asked for a separate XL price. No official Cyprus XL/minivan urban tariff was found.
- +40 % matches the regulated 6-passenger surcharge. XL replaces the 5/6-pax surcharge (never both), so a 6-pax XL equals the regulated 6-pax meter fare.
- XL quotes carry ruleVersion `cy-urban-2026-09-13+xl40-2026-11-16`. Comfort is unchanged.
- Dynamic pricing (if ever on) still applies only to initial + distance.

**Tests:** tariff.test has 3 XL tests (value/line/version/range, no double count with pax, Comfort unchanged). 233 passed.

**Playwright (local):** Comfort 8,08–10,93 €, XL 11,31–15,29 € (×1.4), CTA «Заказать XL · 11,31 €–15,29 €».

## 2026-11-16 — Tracking: code and location switches side by side, frameless
**Layout:** the «Код подтверждения» switch moved from under the driver card down to the actions area. It sits in a two-column row next to «Показать водителю, где я» (pre-pickup statuses only). Neither has a frame.

**Each column:**
- a label, then the switch under it;
- code: the 4 digits under the switch when it is on;
- location: «Определяем…» only while waiting for a fix.

**ShareLocationToggle:** now compact. It is `role=switch` with `aria-checked`. The 🧍 icon and the hint line are gone; the location switch stays blue.

**Check:** Playwright (local): both switches on the same row (172 px each), both toggle on, code shown, no errors.

## 2026-11-16 — Start-code switch simplified
The passenger block is now just three things, per the user:
- the label «Код подтверждения» on top (en «Confirmation code», el «Κωδικός επιβεβαίωσης»);
- the switch under it;
- the 4-digit code under the switch (left-aligned) when the switch is on.

The 🔒 and the hint texts are gone; the `startCodeHint` / `startCodeToggleHint` keys are unused but kept. Playwright (local): off → on shows the code, no errors.

## 2026-11-16 — Trip-start code is optional (passenger switch)
**Default:** a ride has no start code. Assignment no longer generates one; the driver starts with a single «Начать поездку» tap.

**Passenger switch:** on the tracking screen, from ASSIGNED to ARRIVED (once a car is on its way), there is a «🔒 Код начала поездки» switch.
- On: the server generates a 4-digit code, shown large under the switch.
- Off: the code is cleared.
- API: `POST /api/v1/tracking/start-code {enabled}` (full tracking session only, rate-limited).
- Server: `src/server/passenger-start-code.ts`. It locks the booking row, allows changes only before IN_PROGRESS, bumps the revision, logs a START_CODE_ON or START_CODE_OFF event, and pushes a notice to the assigned driver.

**Driver:**
- The trip view has `startCodeRequired`; the code itself is never sent to the driver.
- When it is true, the start bar shows the code field as before. When false, it shows a single start button.
- `startTrip` checks the code only when one is set. The start route accepts an empty or absent code.

**Tests:** `lifecycle.db` adds the default-off/toggle/event test and the no-code one-tap start plus BAD_STATE after start; the full journey switches the code on first. `preassign` and `share-trip` are updated. 230 passed.

**Playwright (local):**
- Passenger switch off → on shows code 1522.
- Driver at ARRIVED: code on shows the field; the passenger switches it off; after a reload the driver sees one button, and tapping it starts the trip.

## 2026-11-16 — Driver home map 15 % farther
The waiting-for-orders zoom is now 13.77 instead of 14. log2(1/0.85) ≈ 0.23, so the view shows about 15 % more. It is still exact and centred on the car.

## 2026-11-16 — Driver home map: exact zoom 14 centred on the car
**User report:** the 20 % closer change looked like the map was scaled up, not zoomed in on the car.

**Cause:** single-point framing used fitBounds on a box. A large box on a narrow phone landed below the wanted zoom, and fractional zooms (13.26) can render as scaled raster tiles.

**Fix:**
- New `centerPointAt`: `moveCamera({center, zoom})`, then `panBy` half the padding difference, so the car sits in the middle of the visible area between the overlays.
- It is used only when `focusZoom` is passed. Other screens keep `framePoint`.
- The driver home uses whole zoom 14, which renders sharp tiles.

**Check:** tsc clean; build ok. Not visually checked (no Google key locally).

## 2026-11-16 — Driver home map 20 % closer
The waiting-for-orders view is now zoom 13.26 instead of 13: log2(1.2) ≈ 0.26 makes everything appear 20 % larger. Google vector maps (Map ID) and MapLibre both accept fractional zoom.

## 2026-11-16 — Driver home map: half-city view (zoom 13)
**Change:** while waiting for orders, the driver home map frames about half the city around the car (zoom 13), like the user's reference screenshot, instead of street level (16).
- New `focusZoom` prop on GoogleMapView / MapView (defaults 16 / 15, so other screens are unchanged). The single-point frame box doubles per zoom level out.
- The passenger booking map and the trip / navigation screens are unchanged.

**Not done:** the "Bolt look" (graphite base, muted roads, no POI / bus-stop icons, big district labels) needs a Cloud map style on our Map ID in the Google Cloud Console. That style is not configured yet.

**Check:** tsc and eslint clean; local driver page loads without errors. Local has no Google key, so the zoom was not visually checked.

## 2026-11-16 — Driver nav: bare chat / Google Maps icons
Removed the round plate, border and shadow around the chat and Google Maps buttons; only the icon is left (💬 40 px, Google pin 48 px). A drop-shadow keeps the icons readable on light maps. The tap targets stay 58 px. Playwright (local): positions unchanged, no errors.

## 2026-11-16 — Driver nav: map buttons raised by three button heights
**Change:** the chat and Google Maps column now has a bottom margin of 182 px instead of 8 px, so both buttons sit 174 px (3 × 58 px) higher. Sizes and the 116 px gap between them are unchanged.

**Check:** Playwright (local): Google Maps y614 → y440, chat y498 → y324; no errors.

## 2026-11-15 — Driver nav: Google Maps right, chat two icons higher, both 20 % smaller; cash/card badge
**Map buttons:** a right-hand column above the action button — chat 💬 (58 px), a 58 px spacer, then Google Maps (58 px, 35 px icon) at the bottom-right. The container is pointer-events-none so the map stays draggable around them (the previous full-width row blocked map gestures).

**Payment badge:** left of the class name — «cash» in green (#34C759) or «card» in red.
- The driver trip view now has `payment: 'CASH' | 'CARD'`. It is always 'CASH' today: rides are paid to the driver, and there is no card choice at booking. 'CARD' is reserved.

**Check:** Playwright (local): Google Maps 58 px at the right edge, chat 116 px above it; badge «cash» rgb(52,199,89); no errors.

## 2026-11-15 — Ride screen: no «Закрепляем…» box; Share + Safety moved into a ☰ menu above the sheet
- The SEARCHING placeholder card («Закрепляем за вами ближайшего водителя…») was removed; the pulsing pin shows the search.
- The «Поделиться» / «Безопасность» buttons left the sheet. A round ☰ button sits above the sheet's top-right edge (until the ride ends) and opens a menu with both items; «Безопасность» opens the existing safety dialog.
- The share status message is now a small pill above the sheet.
- New key `track.menu`.
- Playwright (local, SEARCHING): no reserving box and no share/safety buttons in the sheet; ☰ → «↗ Поделиться | 🛡 Безопасность»; safety dialog opens; no errors.

## 2026-11-15 — Driver navigation: bigger info, big Google Maps/chat buttons in the bottom corner, bigger chat, red «Завершить поездку»
Same sizes on every leg (to the client, stop, with the client).

**Summary row:**
- minutes 44 px bold lime;
- distance 28 px;
- arrival time 24 px;
- address 26 px semibold (2 lines when collapsed);
- name row 18 px.

**Sheet:** collapsed peek is 150 px (176 px with the GPS line). The map fitPadding bottom is 330/520.

**Buttons:**
- Google Maps and chat moved from the top-right column to a row at the bottom-right above the action button, 72 px each with 44 px icons; the unread badge is bigger. Mute stays top-right.
- «Завершить поездку» is a red (bg-danger) bold 56 px button.

**Chat:** ChatPanel `large` gives a messages area of max 336 px (or 50 dvh), min 200 px, base-size text and a taller input; used by the driver map chat.

**Check:** Playwright (local): to client and with client both show a 26 px address and 72 px buttons at the bottom-right; the complete button is rgb(255,107,107); the chat opens; no errors.

## 2026-11-15 — Ride screen: pulsing pickup pin while searching; route box; passenger can add/remove the stop
**Pickup pin pulse:** `pickupPinEl({pulse})` draws two lime rings pulsing from the needle tip. `MapMarker.pulse` is supported by Google and MapLibre; Google swaps content when it changes. TrackApp sets it while SEARCHING.

**TrackApp route (`TrackRoute`):** the dotted box like the booking form (58 px rows, lime line).
- In the middle: «＋ Добавить остановку». It opens a dialog with the stop search (PlacesInput «Stop») and the note «Оценка пересчитается…».
- An existing stop has ×.
- Editable until the car reaches the stop and while the ride is not over.

**Server:** new `src/server/passenger-stop.ts` `passengerSetStop(bookingId, stop|null)` with POST/DELETE `/api/v1/tracking/stop` (full tracking session, rate-limited).
- Allowed statuses: SEARCHING…IN_PROGRESS. STOP_LOCKED once `stopArrivedAt`.
- Re-quotes the meter estimate (createQuote + consumeQuote → fareCents/quoteId/breakdown; the old estimate is kept if quoting fails).
- Resets the stop timers, increments the revision, writes a STOP_SET / STOP_REMOVED event, and notifies the assigned driver (outbox tag `stop-<id>`).
- Driver navigation picks the stop up from the trip view.
- New error key STOP_LOCKED (en/ru/el).

**Tests:** `tests/passenger-stop.db.test.ts` (2 tests: add re-quoted + event + driver notification, then remove; locked at the stop and after completion).

**Check:** Playwright (local, SEARCHING): 2 pulse rings; add stop via dialog → stop row with ×; remove → «Добавить остановку» back; no errors.

## 2026-11-15 — Driver navigation panel trimmed; Google Maps + chat as map buttons; call inside the chat
**DriverNavigation, all legs (to the pickup, stop, destination):**
- The info sheet now shows: ETA + distance + arrival time (summary row), the address with no «К подаче:» label, the passenger name, ★ the drivers' average rating of the passenger (if any), and the class name («Comfort»).
- Removed: pax count, luggage, reference, the Call/Google Maps/Details button row, and the inline chat.
- «Подробнее ›» is a small link when the sheet is open; it still holds the note, flight and «Отказаться».

**Map buttons (top-right, under mute):**
- Google Maps: a round white button with a four-colour pin.
- Chat 💬 with an unread badge. It opens a bottom-sheet chat (always mounted, so it keeps polling).

**ChatPanel:** new optional props `expandedOverride`, `onUnread`, `callHref` (a «📞 Позвонить» button in the chat header) and `onClose`. The passenger usage is unchanged.

**Server:** the driver trip view adds `passengerRating` {average, count} via `passengerRatingSummary`.

**Check:** Playwright (local, EN_ROUTE):
- panel «— | 250 м | Amerikanas 2, Germasogeia | Ilias | Comfort | Подробнее ›»;
- map buttons present; the chat opens with a tel: call link and an input;
- no errors.

## 2026-11-15 — Searching screen cleanup; notifications asked once after sign-in
**Tracking page, SEARCHING:**
- The map pill and the «Ищем водителя» title were removed.
- The sheet heading is now «Ищем ближайшего свободного водителя…» (text-lg, medium, ink).

**Notifications:**
- The «Включить уведомления» link was removed from the tracking page, the pre-booked confirmation and /prebookings.
- New `src/components/NotifyPrompt.tsx`: a one-time dialog («Включите уведомления» / «Разрешить» / «Не сейчас») in BookingApp for a signed-in passenger. It appears after registration/login while the permission is undecided and is never shown again after an answer (`localStorage ily-notify-asked`). A tap is needed for the browser permission dialog (iOS).
- `useSilentPush(url)` re-registers the subscription silently when permission is already granted (tracking page `/tracking/push`, /prebookings `/passenger/push`).
- Keys `common.notifyPrompt.*` (en/ru/el).
- The driver app keeps its own toggle (unchanged).

**Check:** Playwright (local, Pixel 7, permission emulated as «default»): the dialog shows on home; «Не сейчас» + reload → not shown again; track SEARCHING → no pill, no «Ищем водителя», large «Ищем ближайшего…», no notify link; no errors.

## 2026-11-15 — Driver «Свободные заказы» card simplified and fully tappable
- The whole card opens the order: role=button, Enter/Space; «Посмотреть» is kept and does the same.
- The distance («263 м от вас») moved to the top as a large bold line.
- Removed: the «N пасс.» chip text (now only the class, plus 🧳 if any), the «осталось N с» countdown chip (the card still disappears when the deadline passes), and the «Телефон пассажира станет доступен…» note.
- Playwright (local): free list renders; the card text has no countdown or phone note; tapping the card body opens the detail; no errors.

## 2026-11-15 — Driver offers: pop over everything in the app; heads-up banner with sound + vibration in the background
**In the app (driver/page.tsx):**
- A new offerId switches to the main tab, resets profile sub-views and closes an open order detail, so the offer card is on top wherever the driver was.
- The card slides up (`.ily-offer-in`, globals.css) with a strong shadow.
- Ring and vibration every 2 s are unchanged.

**In the background (public/sw.js), the offer push now:**
- reads like «🚕 Новый заказ» / «<pickup> · ~N мин до клиента — нажмите, чтобы открыть» in the app language;
- sets `requireInteraction`, `renotify`, `silent:false`, a long vibration [600,200]×4 and a timestamp;
- closes itself 12 s after showing (only that banner, never a newer offer).

**Language:** the driver app stores its UI language in Cache API (`ily-prefs` → `/__ily-locale`, `rememberPushLocale` in push-client.ts); the SW falls back to the device language. The SW parses the server body format from `offerBody` (comment added in push.ts).

**Checks:**
- Playwright (local): driver on the Profile tab, an offer is created → main tab + offer card + «Принять» within 4 s; locale cached «ru»; no errors.
- The SW handler was unit-run in a node vm sandbox: Russian title/body, requireInteraction, vibration, auto-close; chat pushes unchanged.
- Headless Chromium does not display notifications, so the real banner was not observed.

**Device requirement (unchanged):** the driver must tap «Включить уведомления» in the driver app. Android Chrome site notifications must allow pop-up and sound; iOS needs the PWA on the home screen (16.4+).

**Open question for the user:** OFFER_TTL_SEC is 10 s. From another app (banner → open → accept) that is tight; 20 s was suggested.

## 2026-11-15 — Comfort picture: white three-quarter sedan with a dark glass roof
- CarClassIcon «sedan» was redrawn as an own SVG in the style of the user's reference: a white body, a dark panoramic roof, shading, door lines, a headlight (lime when selected), a tail light and two wheels with a ground shadow. viewBox 64×34.
- The user's image was not embedded (it may come from another app); this is our own drawing in that style.
- The XL minibus is unchanged.
- Playwright (local, iPhone 13): the review step shows the new sedan and the minibus; flow unchanged; no errors.

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

## 2026-11-19 — pair at one airport: one meeting point (REVERTED 19:10 — operator: do it later with the airport setup)
- A pre-booked ride-share pair whose pickups are both at LCA (or both at PFO) is picked up at ONE point
  (`AIRPORT_MEET` in src/lib/share.ts: arrivals taxi pick-up) and at ONE time (the later passenger's; nobody is picked up earlier than booked).
- On MATCHED both bookings get that pickup; their own point is kept in Booking.shareOrigPickup* and restored if the pair breaks
  (migration 20261119180000_share_meet_point). The proposal shows «📍 Место встречи» (share.proposal.meetAt, 8 languages).
- Driver pre-bookings: a pair is a compact tappable card (date/time, «Предзаказ · попутчик», from → to, total).
- Open: confirm exact meeting-point coordinates with the operator; the 2nd passenger's stops on the driver's live navigation map.

## 2026-11-19 — Receipts RU/EN deployed (branch `receipt-ru-en` rebased onto main)
- Receipt page: language RU for a Russian app, else EN, picker for others (remembered); kept main's short receipt (only «Итого» + payment method).
- E-mail receipts only RU/EN (`receiptLocale`). Rides list: «→ destination», same total as the receipt (waiting included), no «≈» for completed rides.

## 2026-11-19 — PARKED: fewer labels on the Google map (owner: «отложи на потом»)
- Map labels in English + «street the car is on» chip are DEPLOYED (main f2c583a).
- Hiding minor labels (POI, bus stops, local-road labels below ~z17) needs the Cloud map style on Map ID
  29d3947762ce2031a068f61d (browser key AIzaSyDa…nflk). That Google account is unknown: the owner's
  zimonidis@gmail.com («My Maps Project») has no keys and no such Map ID. Options given: find the September
  account (Google Cloud e-mails / card statements / whoever set up the server) or move maps to the owner's
  account (billing on, new keys + Map ID + style, swap on the server). Owner asked about cost: style is free;
  Maps is pay-as-you-go with a monthly free cap.
- Also still open: 2nd co-rider's stops on the driver's live navigation map; airport meeting point for pairs (with the airport setup).

## 2026-11-20 — «Мои поездки»: ride page; old no-driver orders «did not take place»
- A finished ride (completed / cancelled / no driver) opens /rides/[id]: map (pickup, stop, drop-off + road route),
  date, #ref, route, and for a completed ride driver, car + plate, class, distance (GPS meter, else quote), time on the
  way, payment, total, rating / «Оценить», button «🧾 Чек» → /rides/[id]/receipt (the receipt moved there).
  API GET /api/v1/passenger/rides/[id]. Owner: no passenger count, no «не нашлось водителя» note.
- NO_DRIVER is not «active» in the history (no «Следить онлайн»); label «Поездка не состоялась».
  «Искать снова» only within 30 min of the NO_DRIVER event (src/lib/ride-outcome.ts) — view.canRetry and
  researchBooking both enforce it; the track page then says «Поездка не состоялась» with no retry / no route edit.

## 2026-11-20 — Home quick picks as tiles; iOS 27 top blur
- Home: no recent trips under «Куда едем?». Tiles: Home / Work (58 px, icon + label; dashed «＋» when unset), every
  custom saved place as a 📍 tile (row scrolls sideways once there are custom places), and a smaller «Ещё» that is
  always at the right end (outside the scrolling row).
- iPhone Air on iOS 27.2.1 blurred the logo/avatar under the translucent status bar (iPhone 12 Pro on iOS 18.6 did not).
  Fix: appleWebApp statusBarStyle 'black' (passenger + driver layouts) — the app starts below the status bar.
  Needs the Home Screen icon re-added to take effect. Earlier steps kept: top bars opaque, pinned (FixedTop on home/track).

## 2026-11-20 — Pre-booking window
- «Запланировать» opens its own window: heading + ✕ (exitSchedule: back to «now», clears time/route/note, folds the
  sheet), date & time on top, the full From/To box (both rows, editor, swap, add stop), «Попутчик» switch (greyed with
  the list of places until isShareRoute), driver note, contact. No «Куда едем?», tiles or recent trips there.
  The review step no longer repeats «Попутчик» for a pre-booking.

## 2026-11-20 — No-GPS movement (branch `gps-tunnel`, NOT deployed) + GPS taximeter PARKED
- Branch `gps-tunnel`: the car keeps moving along the route without GPS (A6 twin tunnels ~950 m, the only road
  tunnels in Cyprus): src/lib/nav.ts DR (start 2.5 s driver / 10 s passenger, max 90 s / 2 km, ≥ 15 km/h, on route),
  useDeadReckoning hook, driver nav chip «📡 Нет GPS · примерно» / «Нет сигнала GPS», passenger note «нет связи с
  машиной · примерно», faded car; a returning fix glides in. Display only — never sent to the server. 4 unit tests.
  DEPLOYED 2026-11-20 16:35.
- PARKED (owner: «про GPS в целом отложи на потом»): GPS taximeter improvements — a gap is a straight line ×1.2
  (>30 s), no points = only flag-fall; ideas: gap by route length, «мало данных GPS» warning, «нет данных» instead of 3,80 €.

## 2026-11-20 — Driver earnings: from the map pill, not the menu
- Menu ☰ tabs: Профиль | Поездки (no «Заработок»). The pill «… € заработано сегодня» opens a «Сегодня» card: total,
  4 tiles — 💶 cash | 💳 card (Fare.paymentMethod; card = any CARD_*, none at booking yet) / done + «Отменено: N»
  (= analytics: driver-cancelled + missed offers) | (narrower) time online — and «Подробнее ›». Trips tile → analytics
  panel (Выполнено / Не выполнено tiles); the others and «Подробнее» → full «Заработок» screen (tab 'earnings', back «‹»).
  dashboard.today gained cash, card, canceledTrips.

## 2026-11-20 — Driver «Время на линии» pane
- Today card: ✓ done / ✕ not done side by side (icons 30 % smaller, no words). «Время на линии ›» opens a pane inside
  the card (back «‹»): today online total, 🚕 on orders, 🛣️ km on orders today (assignment start → end = to the client +
  A→B, by GPS; no track → booked A→B), Mon–Sun candles (lime = online, red = km, own scales; tap a day → its hours · km),
  week totals. API GET /api/v1/driver/duty (src/server/driver/duty.ts dutyToday). Test: tests/duty-today.db.test.ts.
- Earnings screen «Время на линии» tile («Онлайн · Км ›») opens the same pane. DEPLOYED 18:27.

## 2026-11-20 — Driver reports are ONE shared tool; admin per-driver report
- Server: src/server/reports/driver-report.ts — reportEarnings / reportDuty / reportAnalytics / reportStatementCsv /
  driverFigures (today + week for a list of drivers). Routes only decide WHICH driver may be read:
  driver: /api/v1/driver/{earnings,duty,analytics,earnings/export} (own); admin:
  /api/v1/admin/drivers/:id/report/{earnings|duty|analytics|export}, /api/v1/admin/drivers/figures, GET /admin/drivers/:id.
- Client: src/components/reports/ — EarningsReport (was EarningsSection in driver/page.tsx; now also 💵 cash / 💳 card
  under each currency total), DutyPane + WeekCandles, format.tsx (useReportFmt, Figure). DriverAnalytics takes apiBase.
  `apiBase` = '/driver' or '/admin/drivers/<id>/report' (fleet owner next: '/fleet/drivers/<id>/report').
- Admin «Водители»: «Все водители сегодня / за неделю» cards; per row today hours · km · ✓ ✕ and week hours · km;
  tap → /admin/drivers/[id] (back «‹»): the driver's own earnings / analytics / hours & km screens.
- Test: tests/admin-driver-report.db.test.ts (same figures as the driver sees; 401/403/404). 323 passed.
- NEXT: fleet owner role (FLEET_OWNER staff role + Fleet; drivers & vehicles belong to a fleet; owner sees only his).
- DEPLOYED 2026-11-20 22:33 (main e20ad6e).

## 2026-11-20 — Fleet owner role (branch `fleet-owner`, NOT deployed — owner: «сначала покажи»)
- Decisions (owner): owner ONLY LOOKS; the ADMIN creates the owner and puts drivers / cars into his fleet; the owner's
  share (percent / rent) — later.
- Schema + migration 20261120200000_fleet_owner: Role.FLEET_OWNER; Fleet {name, ownerId @unique, active};
  Driver.fleetId, Vehicle.fleetId (nullable, SET NULL). No fleet = works directly for IL-Y.
- Server: src/server/fleet.ts (requireFleetOwner, fleetHasDriver — a driver of another fleet is 404).
  /api/v1/fleet/{me,drivers,drivers/:id,drivers/:id/report/:part,vehicles} — the SAME report tool (driverReportResponse).
  Admin: /api/v1/admin/fleets (GET, POST → one-time temp password), /admin/fleets/:id (name, active → logout, resetPassword);
  PATCH admin drivers / vehicles accept fleetId. MFA: FLEET_OWNER is a privileged role (TOTP like admin / dispatcher).
- UI: admin menu «Автопарки» (/admin/fleets); «Автопарк: …» select on «Водители» and «Автомобили» rows.
  Owner: login → /fleet «Мой автопарк» (menu: Мой автопарк, Безопасность): today / week totals, his drivers with
  figures → /fleet/drivers/[id] (back «‹», the driver's own earnings / analytics / hours & km), his cars.
  Shared: components/reports/DriversFigures.tsx (useDriverFigures, FiguresTotals, DriverFiguresLine), DriverReportScreen.tsx.
- Test: tests/fleet-owner.db.test.ts. 325 passed. Preview screenshots 260–265 in /tmp/shots (local).
- To deploy: merge `fleet-owner` → main; the migration must run (check the server's deploy runs `prisma migrate deploy`).
- 2026-11-20 23:50 (owner: «владелец таксопарка тоже может работать в приложении»): a DRIVER can own a fleet with his
  own login. Admin «Автопарки» → «Владелец: Новый логин / Водитель: …» (POST {name, driverId}; the driver is put into
  his own fleet; no new password). requireFleetOwner accepts FLEET_OWNER or a DRIVER who owns an active fleet;
  /auth/me returns `fleet`. Driver menu ☰ shows «Мой автопарк · <name> ›» → /fleet (back «‹» to /driver; the top bar
  shows «Моя поездка | Мой автопарк»). Switching such a fleet off / «reset password» never touches his driver account.
  Test added (driver-owner). 326 passed. Screens 270–272 in /tmp/shots.
- DEPLOYED 2026-11-21 00:18 (main c784022): /fleet, /admin/fleets live; anonymous /api/v1/fleet/* → 401; ready OK.
  Not yet checked on live with a real login (no fleet created on production yet).
- 2026-11-21 02:51 DEPLOYED (main 86b771d): earnings screen (shared EarningsReport — driver, admin, fleet owner)
  always shows 💶 Наличные / 💳 Картой tiles under the top tiles, 0 € included. 326 tests passed.
- 2026-11-21 03:55 DEPLOYED (main b919875): earnings screen in the today card's order — sum (accent) on top,
  💶 cash | 💳 card, ✓ done ✕ not done (wide, → analytics) | time online (narrow, → hours & km).
  reportEarnings returns notDone (driverCanceled + missedOffers) for today / week (7 d) / month (30 d); driverAnalytics
  now takes 1–31 days. Shared: driver, admin per-driver, fleet owner. 326 tests passed.
- 2026-11-21 04:30 FIX: admin «Фикс. цены» → «+ Новая зона» crashed the page on Google maps («This page couldn't
  load»): a Polygon built from a flat EMPTY path has no ring → getPath() undefined → addListener threw. Now paths =
  [ring]; getPath guarded. Reproduced locally with the real Google JS (key refuses localhost, so corner clicks are
  verified on the live site only).
- 2026-11-21 11:15 FIX: owner could not log in to the admin from a phone at il-y.taxi — the phone was on
  http://il-y.taxi (Cloudflare served plain http, no redirect) and the browser dropped the Secure login cookie.
  src/proxy.ts: CF-Visitor {"scheme":"http"} + GET/HEAD → 308 to https (nginx always sends X-Forwarded-Proto https,
  so CF-Visitor is the only truth); https via Cloudflare gets HSTS 1 year. tests/https-redirect.test.ts. 328 passed.
  Also worth turning on in Cloudflare: SSL/TLS → Edge Certificates → «Always Use HTTPS».
- 2026-11-21 12:20 DEPLOYED: «↶ Шаг назад» on the fixed-price zone map (top-left, beside the hint). Undoes one corner
  change at a time — add, drag (a continuous drag = one step, 600 ms grouping), midpoint insert, «Убрать последний угол»,
  «Очистить». History resets on new / edit zone. 328 tests passed; previewed on the MapLibre map (Google: live only).

## 2026-11-21 — Price rings around airports (branch `fixed-rings`, NOT deployed — owner: «покажи»)
- FixedFareZone.radiusM (migration 20261121120000_fixed_zone_ring). A ring = circle of radiusM around its airport; the
  server builds the 64-corner polygon (src/lib/zone-shapes.ts circlePolygon), so matching is still point-in-polygon.
- RULE CHANGE: when several zones / rings contain the address, the SMALLEST wins (was: the cheapest). So «до 5 км»
  beats «до 12 км», and a drawn district (e.g. Пейя) beats the ring it sits in. tests/fixed-fares.db.test.ts updated.
- Admin «Фикс. цены»: «+ Круг от аэропорта» (radius field + slider 1–60 km, or tap the map = edge through that
  point), «+ Новая зона» (draw). Price pills on the map («до 12 км · 35 €», «Пейя · 45 €»); the map fits all rings.
  Shapes in the list: «◯ до N км» / «нарисована». 329 tests passed. Screens 350–353 in /tmp/shots (local).

## 2026-11-21 13:40 — Rings dropped (owner: «лучше как было — много точек вручную»); price BELTS instead
Branch `fixed-bands` (from `fixed-rings`; NOT deployed — owner: «покажи»). No circles, no radiusM column (that
migration was never deployed and is removed). Zones are drawn by hand as before; new «+ Следующий пояс» builds the next
zone from the OUTERMOST active zone: its own corners densified to ≥ 24 and pushed 3 km outwards (src/lib/zone-shapes.ts
nextBelt) — so it starts exactly where the previous ends; drag the corners to where the next price should end. Name
«Пояс N», price prefilled +10 € / +15 €. Smallest zone wins (unchanged from fixed-rings), so inside the belt the inner
zone keeps its price. Map: belts drawn as bands (inner zones cut out), price pills, map fits all zones.
Local check: centre 25 € / пояс 2 35 € / пояс 3 45 € / beyond → meter. 329 tests passed. Screens 360–364.
- 2026-11-21 15:50 (branch `fixed-bands`, still NOT deployed — «покажи»): (1) a belt is bounded by its neighbours —
  editing a belt shows «Внутренняя граница — это «Центр»…» and draws the belt as a band; save is refused if the belt cuts
  into the zone inside it, or if a zone leaves the belt around it (page-side, polygonInside). The inner edge is not stored:
  it IS the inner zone (smallest wins), so editing the centre moves it. (2) «+ По индексу»: FixedFareZone.postcodes
  (migration 20261121150000_fixed_zone_postcodes; empty polygon). findFixedFare: postcode zones FIRST (address postcode via
  lookupPostcode — own address base → Google → Photon, cached), then drawn zones (smallest wins). Local quote to Peyia
  → «PFO ↔ Пейя» 45 € via the real postcode lookup. 330 tests passed. Screens 370–373.
- 2026-11-21 16:30 (branch `fixed-bands`, NOT deployed): neighbours FOLLOW instead of an error — pulling a belt's outer
  edge into the zone inside shrinks that zone there (~60 m gap); pulling a zone out over its belt widens the belt there
  (src/lib/zone-shapes.ts shrinkInto / growAround, tests/zone-neighbours.test.ts). Derived from the edited polygon + the
  neighbours as they were → «↶ Шаг назад» restores both; on save the moved neighbours are PUT too. The old messages stay
  only as a fallback. Postcode zones drawn on the map in pink: outline (convex hull, outliers dropped) of our OsmPlace
  addresses with that postcode — src/server/postcode-area.ts, GET /api/v1/admin/fixed-zones/postcode-areas?codes=…
  (6 h cache); codes with no addresses are named under the zone. 331 tests passed. Screens 380–382.
- 2026-11-21 15:46 DEPLOYED (main b135c07): belts, neighbours follow, postcode prices + outlines, smallest zone wins. Live: postcode-areas 401 anonymous, belt UI in chunks, ready OK, a public PFO quote still answers.

## 2026-11-21 — Three separate entrances (branch `entrances`, NOT deployed — «собери и покажи»)
Decision (owner): passenger app, driver app («IL-Y Driver», own home-screen manifest already existed), staff in the
browser. Web now: /login = passenger only (email + «Создать аккаунт»; small «Вы водитель? ›»); /driver/login = «Водитель
IL-Y»: card «Я уже водитель» (phone + SMS code, or «Войти логином и паролем» → /auth/login, staff typed here are routed
to their side) + card «Хочу стать водителем» → /driver/register; /staff/login = staff only («Администратор, диспетчер,
владелец автопарка»), the driver block that confused the owner is gone. StaffShell: signed-out driver pages → /driver/login,
driver logout → /driver/login. Texts in 8 languages. 331 tests passed. Screens 400–403.
- 2026-11-21 19:00 (same branch `entrances`): three home-screen apps — «IL-Y» (passenger, /), «IL-Y Driver» (now its own
  icon with a DRIVER band), «IL-Y Admin» (new: public/manifest-staff.webmanifest, start_url /staff; layouts with the staff
  manifest + apple icon on /staff, /admin, /dispatch, /fleet). /staff routes by role (signed out → /staff/login).
  /staff/login and /driver/login skip ahead when already signed in (iOS saves the current page as the icon's start).
  Icons: public/icons/{driver,admin}-{192,512,maskable-512,apple-touch-icon}.png. 331 tests passed.
- 2026-11-21 21:42 DEPLOYED (merge 8d0e889 onto main with the parallel ride-share / share-board work; only HANDOFF overlapped, auto-merged; 341 tests passed on the merged code): separate entrances + IL-Y Admin / Driver icons. Live: /staff/login has the staff manifest, icons 200, ready OK.

## 2026-11-22 — «Продолжить с Google» for passengers (branch `google-signin`, NOT deployed)
Owner's plan: Google → Apple → SMS (as an extra identity check), one by one. Done: Passenger.googleSub / appleSub
(@unique, migration 20261122000000_passenger_oauth) — the provider's permanent id, for blocking «недружелюбный клиент».
src/server/oauth-google.ts: OIDC code flow + PKCE + state + nonce; ID token from Google's token endpoint (server-to-server,
client secret) checked for iss / aud / exp / nonce; passenger by googleSub, else linked to the account with that
GOOGLE-VERIFIED e-mail, else created. Routes /api/v1/passenger/oauth/google (start, sets a 10-min httpOnly cookie),
/callback (any problem → /login?oauth=failed), /providers. Button components/auth/ContinueWith.tsx on /login and
/register, shown only when GOOGLE_OAUTH_CLIENT_ID + _SECRET are set (docker-compose passes them; .env.example lists them).
Redirect URIs to register: https://il-y.taxi/… and https://cyprustaxi.ackedberryes.store/api/v1/passenger/oauth/google/callback.
Local end-to-end with a stand-in Google (GOOGLE_OAUTH_TOKEN_URL_DEV, ignored in production): signed in as the test
person; forged state → /login?oauth=failed. tests/oauth-google.db.test.ts. 345 tests passed. NEXT: Apple, then SMS.
- 2026-11-22 01:20: also in the booking login modal (PassengerLoginModal → ContinueWith with onBeforeLeave): before going
  to Google the route + class are put into sessionStorage «il-y-repeat» (the «Заказать ещё раз» hand-over), so the form
  comes back filled. Checked locally with a stand-in Google and a forced LOGIN_REQUIRED (guest booking is on, so the modal
  only shows when the server asks). Drivers / staff entrances have no Google on purpose. 345 tests passed.
  NOTE for the owner: the booking form still REQUIRES «Телефон для водителя» although the owner said drivers talk to
  passengers in the in-app chat — proposed removing it; not changed yet.

## 2026-11-23 — «Не ваши изменения» — DEPLOYED (main 346a508; live: /admin/changes/count 401, /staff/push 404, ready)
- Operator: no push with sound. Section renamed «Изменения» → «Не ваши изменения» / «Not your changes».
- Owner menu item turns red with a pulsing dot and a count while there are unseen changes
  (StaffShell polls GET /api/v1/admin/changes/count every 30 s + on return; opening the page marks read and fires `il-y:changes-seen`).
- Removed: owner push enqueue in staff-log.ts, /api/v1/staff/push route, «Включить уведомления» button, sw.js `staff.change` text.
- Tests: full suite 396 passed / 1 skipped (superadmin test now asserts no STAFF push + count endpoint, 403 for non-owner).
- Follow-up (operator): opening the page no longer clears it. Each row has «Проверено»; button «Отметить всё проверенным (n)».
  Red stays until all checked. Silent in-app pop-up «Новое изменение · Имя · раздел» (poll 10 s; not on the changes page; ✕ closes).
  POST /admin/changes {id} = one, {} = all; GET /admin/changes/count returns {unread,last}.
- Fixed during preview: page sent a double-JSON body (api() already stringifies) → would have marked all.
- Screenshots /tmp/shots/red-popup.png, red-page.png, red-one.png, red-all.png. Next: «заливай» → merge to main.

## 2026-11-23 — Admin menu in groups — DEPLOYED (operator «заливай»)
- StaffShell: 7 groups for ADMIN — Диспетчерская · Водители и машины (Заявки, Водители, Автомобили, Автопарки) · Клиенты ·
  Цены (Фикс. цены, Минимум предзаказа) · Отчёты (Аналитика, Надёжность) · Суперадмин (owner: Не ваши изменения, Бухгалтерия,
  Сотрудники) · Настройки (Настройки, Безопасность). Second row = tabs of the open group. Page URLs unchanged.
- Red: «Заявки (n)» + its group while applications are SUBMITTED/IN_REVIEW (every admin); «Не ваши изменения (n)» + Суперадмин (owner).
  Shared `staffAlerts()` (src/server/staff-alerts.ts), GET /api/v1/admin/alerts polled 10 s; /auth/me adds pendingApplications.
  Application page fires `il-y:apps-changed` after an action. Dispatcher/driver/fleet menus unchanged.
- Phone: the open group/tab is scrolled into view.
- Tests 397 passed / 1 skipped (new tests/staff-alerts.db.test.ts). Screenshots /tmp/shots/grp-*.png.
- Dev DB has two preview applications (ids pv-ap1, pv-ap2) — local only.

## 2026-11-23 — Pre-booking time: plain П vs ПП — DEPLOYED (operator «заливай»)
- BookingApp: «Когда вам нужно быть на месте? / не раньше / не позже» only when «Попутчик» is on (`arriveOn = arriveMode && shareOn`).
  Plain pre-booking: «Во сколько подать машину?» — date + «Время подачи» → scheduledAt; check ≥ schedule.minMinutes
  (`booking.pickupAt.*`, 8 languages). Server unchanged (arrive window optional).
- Tests 399 passed / 1 skipped. Screenshots /tmp/shots/pk-*.png. Browser check: plain pre-booking ordered (201, scheduledAt 09:30 Cyprus = 07:30Z).

## 2026-11-24 — Passenger home: centre pin (branch `pin-on-map`, NOT deployed — shown to operator)
- Home screen (no destination, no picker): the IL-Y logo is an overlay in the middle of the visible map (`pinPoint(fitPadding)` in
  mapFit.ts, same point a padded focus centres on); the map moves under it; the pin lifts while dragging. When the user's own move
  stops (finger up), the map reports the point under the pin (`onCenterPick` in GoogleMapView: DOM pointer/touch/wheel + 'idle';
  MapView: 'moveend' with originalEvent) → pickup = that point, reverse-geocoded. Programmatic camera moves never pick.
- The picked point and the user's zoom become the camera focus (no snap-back when the sheet opens). «Моё местоположение» resets the
  pickup to the GPS position. With a destination the pin is a normal map marker again.
- Checked locally (MapLibre, touch drag via CDP). NOT checked: the Google map path (needs the live key) — verify on the live site.
