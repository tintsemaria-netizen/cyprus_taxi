# Task 022 — Ride-share «Попутчик» (airport and intercity only)

Status: **implemented locally, not pushed, not deployed** (2026-11-19). The operator asked to see it
before anything is uploaded. Automated tests pass; the flows below were clicked through in a local
build (screenshots shown to the operator). Not tried on a real phone or with Google routing.

## Rules (agreed with the operator, 2026-11-19)

- Only between two DIFFERENT places of: Larnaca airport, Paphos airport, Larnaca, Nicosia, Paphos,
  Ayia Napa (e.g. LCA → Larnaca town, PFO → Paphos, Larnaca → Nicosia). Never inside one town.
  Limassol is not in the list yet (`SHARE_TOWNS` in src/lib/share.ts). No intermediate stop.
  At most **two bookings** in one car.
- Passenger opts in at booking («Попутчик −30%»): adults, children, suitcases, and how much longer
  the ride may take for them (+10/15/20/30 min). The newcomer is not asked again.
- **Live** (car already on a trip): the passenger already in the car and the driver decide. Both get a
  light notice with the co-rider's people/children/suitcases, the extra minutes and the money; the
  driver sees «было X → станет Y» (sum of both shared prices). 60 s to answer (`SHARE_ANSWER_SEC`);
  silence = no. Seats and boot must fit everyone (`SHARE_LUGGAGE_COMFORT` 4, `SHARE_LUGGAGE_XL` 7).
- **Pre-booking**: at booking the passenger also chooses how long they can wait for a co-rider
  (0/15/30/60 min, e.g. sit at the airport). Two pre-bookings fit when the car can leave the first
  pickup no earlier than the co-rider can be collected and neither waits longer than they chose,
  and the drive stays within both limits. Both passengers are asked (30 min to answer, and at the
  latest 1 h before the car leaves). They see when the car comes, how long they wait and when they
  arrive — no names, phones or addresses. Both yes → the pickup times move to the shared departure
  (restored if the pair breaks up) and the pair is one order on the pre-bookings board for drivers
  with «Беру попутчиков» and enough seats.
- **Search times — ride-share pairs only** (operator, 2026-11-19; other pre-bookings unchanged:
  online search 15 min before): an unclaimed pair is offered to online co-rider drivers 30 min
  before pickup (`SHARE_PAIR_SEARCH_LEAD_MINUTES`); a pair's pre-assigned driver becomes active 30 min
  before and, if still busy/offline, is waited for until 20 min before (`SHARE_PAIR_LAPSE_MINUTES`),
  then the pair is searched online. If no co-rider driver is online, the pair splits into two
  normal rides (full price, normal timing).
- Times: every plan is road-routed with Google Routes (traffic-aware, at the ride's own time for
  pre-bookings; cached 10 min) when Google is configured; otherwise a straight-line estimate
  marked «примерно». Each passenger sees their own arrival time; the driver sees the stop order
  and when the trip ends — so a co-rider dropped off first and delaying the other is visible.
- Break-up: a cancel / rematch puts the other passenger back to the full price. **No-show** (driver
  waited past the free waiting time): that leg is cancelled; on a pre-booked pair the no-show owes a
  flat **€10** (`SHARE_NO_SHOW_FEE_CENTS`, never more than their price) — recorded on the ShareGroup
  (`noShowFeeCents`), **not charged**: card payments do not exist yet.
- Driver: profile switch «Беру попутчиков» (off by default).

## Implementation

- Schema: `ShareGroup` + Booking `shareOptIn/shareMaxExtraMin/childCount/shareFullCents/
  shareFullPriceType`, Driver `acceptsShared` (migration `20261119010000_ride_share`).
- `src/lib/share.ts` (pure: route check, price, best stop order), `src/server/share.ts` (proposals,
  answers, expiry, pre-booking matching, break-up, leg hand-over).
- The second leg has its own Assignment without the active driver/vehicle slot; when the first leg
  ends the other takes the slot and the driver stays busy (`afterLegEndedTx`).
- Worker: expire proposals each tick, pair pre-bookings every ~30 s, live proposal before driver offers.
- API: `POST /tracking/share-answer`, `POST /driver/share/answer`, `GET|PATCH /driver/share/settings`,
  `POST /driver/bookings/:id/no-show`. UI: booking option, passenger notice + badge, driver proposal
  sheet, second-passenger pill on the navigation screen, board pair box, profile switch. 8 languages.
- Tests: `tests/ride-share.db.test.ts` (13), `tests/ride-share-roads.db.test.ts` (1).

## Known limits / next

1. Google road time is used only when the server key is set; it is not exercised locally (mocked in
   tests/ride-share-roads.db.test.ts).
2. In-app navigation follows the first passenger; the second passenger's stops open in Google Maps
   from the pill («Навигатор»).
3. No-show fee is recorded only (no card payments yet).
4. Legal check of per-passenger charging on regulated airport fares — the operator chose to proceed.
5. Not checked on a real phone; admin/dispatch views do not show the pair yet.
