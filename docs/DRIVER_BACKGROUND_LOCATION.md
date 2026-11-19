# Driver location in the background — honest limits and plan

Launch fixes, 2026-11-20. The status words in this file mean:

- **Confirmed by code**: read in the source.
- **Verified by test**: covered by an automated test that was run.
- **Not verified on device**: no real phones were available for this work.

## What the driver client is today (confirmed by code)

The driver app is a **web page / PWA** (`src/app/driver/page.tsx`), not a native app.

- **Location while the page is visible**
  - `navigator.geolocation.watchPosition` runs with high accuracy (`maximumAge` 10 s).
  - A keep-alive asks `getCurrentPosition` with `maximumAge: 0`, so a fresh fix is sent even when the phone reports no movement.
  - Bad fixes are filtered.
  - Samples go to `POST /api/v1/driver/location`. The server stamps `receivedAt`.
- **Screen wake lock** (`src/lib/driver-alerts.ts`): requested while on duty, and requested again on `visibilitychange`.
- **When the page is hidden, the screen is locked, or the browser is closed:**
  - **iOS Safari / PWA:** JavaScript is suspended within seconds. **No location is sent.** Web Push still arrives.
  - **Android Chrome:** timers and geolocation are throttled or stopped after a short time in the background. **Location is not guaranteed.**
  - There is no background-location API for the web on either platform. Nothing in this project can work around that.

## What the server does about it

These rules are confirmed by code. The rematch timing is verified by tests (`tests/launch-races.db.test.ts`, `tests/lifecycle.db.test.ts`).

- **GPS loss before pickup** (ASSIGNED / EN_ROUTE):
  - After `DISPATCH_GPS_LOSS_REMATCH_SECONDS` (90 s) without a sample, the ride goes back to automatic search.
  - The window is counted from **server receive time**, so a phone with a wrong clock cannot stretch it.
  - The window **never starts before the assignment**, so a driver assigned with an old fix is not dropped on the next tick.
- **GPS loss during the trip** (ARRIVED / IN_PROGRESS): the ride is **never** reassigned.
- **The driver who loses the ride is told:**
  - a push: «Ride reassigned» / «Ride removed»;
  - a banner when the trip disappears from the screen: «Заказ снят с вас…»;
  - his old actions are refused (revision and active-assignment checks).
- **Pre-booked rides** are converted to a real assignment only when the driver meets all of these. Otherwise they wait, then go to automatic dispatch with a staff alert.
  - online;
  - accepting rides;
  - GPS fresh within 90 s;
  - straight-line ETA within reach of the pickup.
- **The passenger is never shown simulated GPS.** A stale fix is shown as stale.

## Limits drivers must be told (operational, until a native client exists)

1. Keep the IL-Y driver screen **open and the phone unlocked** while on duty and on a trip. Use a car holder and charger.
2. **Turn off battery saver.** On Android, also turn off battery optimisation for Chrome or the PWA.
3. Allow location **«While using the app»**. On iOS, also turn on **Precise location**.
4. If the phone locks or another app covers IL-Y for more than about a minute before pickup, the ride may be **given to another driver**. This is by design: the passenger must not wait for a car the system cannot see.
5. During the trip, losing GPS does not take the ride away. The live car on the passenger's map freezes and is marked stale.

## Plan for a driver client with real background location (not started)

| Step | What | Why |
|---|---|---|
| 1 | A thin native shell (Capacitor, or Kotlin/Swift) around the existing driver web UI | Reuses all screens; only location and push become native |
| 2 | Android: a foreground service with a persistent notification, `FusedLocationProvider` every 5–10 s on duty | The only reliable way to send location with the screen off |
| 3 | iOS: `CLLocationManager` with the «Always» permission, `allowsBackgroundLocationUpdates`, `showsBackgroundLocationIndicator` | Apple's sanctioned background navigation mode |
| 4 | Send to the same `POST /driver/location` with the session token; queue offline and upload in order (the server already rejects out-of-order samples by sequence) | No server change needed |
| 5 | Native push for offers (FCM / APNs), with sound while locked | Web Push is not reliable for sound on a locked iPhone |
| 6 | Store review: background-location justification text, privacy labels | Required by Google Play and the App Store |

**Pre-condition:** the device protocol in `docs/VERIFICATION_REPORT.md` §Manual device protocol must be run on the web client first. That gives a baseline to compare the native client against.

## Status

| Item | Status |
|---|---|
| Server rules for GPS loss / rematch / notifying the old driver | FIXED AND VERIFIED (automated tests) |
| Web client background behaviour on real iPhone / Android | **NOT VERIFIED** (no devices) |
| Native driver client | NOT STARTED |
