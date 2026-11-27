# Parked (2026-11-27): driver GPS loss during a trip — "phone off" vs "location turned off"

Operator: «потом, вместе с GPS водителя». Do this together with the driver GPS work.

## Today (checked in code)
- Server sees only "no GPS". The app knows PERMISSION_DENIED (red text on the driver screen) but does not report it.
- Passenger: «с задержкой» after 30 s, «нет связи» after 120 s (car + ETA hidden).
- ASSIGNED / EN_ROUTE: rematch after 90 s without GPS (worker.ts rematchOnGpsLoss) + push drv.rideLostGps.
- ARRIVED / IN_PROGRESS: never reassigned, never auto-finished. A trip whose driver never comes back hangs in IN_PROGRESS; admin has no flag (ONLINE_STALE_GPS is only for on-duty drivers).
- GPS meter charges a gap as a straight line × 1.2 (or by time); comparison only, it does not set the price.

## Proposal (not yet agreed)
Report the app's GPS state (ok / denied / unavailable) with the current-trip poll, plus the last app contact time.
1. App alive + GPS denied/off → the driver turned it off: a blocking in-app screen «Включите геолокацию — клиент вас не видит» with sound; a trip event "driver GPS off" with times (for the meter and disputes); an admin flag.
2. Silence from the app (phone off/dead, no internet, app closed — not distinguishable): after N min a push «У вас незавершённая поездка» (new sw.js MSG_TEXT key, 8 languages); an admin flag «нет связи с телефоном» with the last contact time.
3. Before pickup: keep the 90 s rematch.

## Open questions for the operator
- N minutes of silence before the push and the admin flag?
- A penalty or warning when the driver turns off location during a trip (reliability rating)?
