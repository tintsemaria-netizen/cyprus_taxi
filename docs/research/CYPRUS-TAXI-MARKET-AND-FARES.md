# Cyprus taxi market & fares — research for IL-Yas pricing

Dated: 2026-09-13. Author: implementation session (Task 012 §3). Currency EUR, tariff time
Europe/Nicosia. **Scope:** Republic of Cyprus, urban + rural regulated taxis, airport
transfers. Northern-area rules/currency are explicitly excluded.

This is a bounded review of primary sources, not an exhaustive market census or proof of
competitors' private algorithms. Each parameter carries a source, date and confidence.

## 1. Regulated tariff — VERIFIED (primary tourism source)

Source: **Visit Cyprus — Transportation** (https://www.visitcyprus.com/useful-info/transportation/),
fetched 2026-09-13. Official tourism guidance (CTO). Confidence: **medium-high** for the
figures; the authoritative instrument is the Road Transport Department (RTD) — see §4 caveats.

Day/Tariff-1 window **06:01–20:30**; Night/Tariff-2 **20:31–06:00** (local time).

### Urban taxis (metered, 24h)
| Component | Day (T1) | Night (T2) | Notes |
|---|---|---|---|
| Initial hire (flag-fall) | €3.80 | €4.80 | once per hiring |
| Per km | €0.95 | €1.10 | |
| Waiting per hour | €17.00 | €19.00 | i.e. €0.2833 / €0.3167 per minute |
| Luggage (per piece) | €1.40 | €1.40 | |
| Public-holiday surcharge | €2.00 | €2.00 | per ride, on listed holidays |
| 5 passengers | +20% | +20% | surcharge on fare |
| 6 passengers | +40% | +40% | surcharge on fare |

Public-holiday dates: Dec 24, 25, 26, 31; Jan 1; Good Friday & Saturday; Easter Sunday &
Monday; May 1. (Movable Orthodox Easter dates must be computed per year.)
Pets: allowed only in pet-carriers, additional charge.

### Rural taxis (no taximeter; km-based)
| Component | Day (T1) | Night (T2) |
|---|---|---|
| Minimum charge | €3.64 | €3.64 |
| Per km (single trip) | €0.63 | €0.75 |
| Per km (return trip) | €0.49 | €0.63 |
| Waiting per hour | €14.45 | €18.82 |
| Luggage over 12 kg | €1.20 | €1.96 |

## 2. Competitors / benchmarks — advertised claims only (NOT verified via live app)
| Operator | Public claim (source) | Use |
|---|---|---|
| Bolt Limassol (bolt.eu) | Local city ride-hailing service page exists | Confirms ride-hailing operates in Cyprus; classes/fares NOT verified in-app |
| CABCY Larnaca (cab.com.cy) | Licensed drivers, immediate + scheduled, "official tariffs", estimate before confirmation | A compliant Cyprus flow can offer auto-booking + transparent estimate without inventing surge |
| Paphos airport transfer operator | Destination/vehicle-size fixed transfer price list | Commercial benchmark only — advertised transfer prices are NOT statutory taxi rates |
| Bolt dynamic-pricing support article | Generic demand/weather effects + disclosure | International reference; NOT evidence any surcharge is lawful in Cyprus |
| Uber marketplace/matching | Nearest ≠ quickest; ETA-based matching, short batching | Design reference for ETA matching; not a claim to reproduce their algorithm |

We did not place real rides or scrape live competitor quotes. Yandex Go / Uber are used only
as UX/dispatch references, not as assumed Cyprus operators.

## 3. Airports — UNVERIFIED
Hermes Airports guidance points to RTD for fare rules; the linked government fare guide
**failed to load** in this review. **Airport fixed-tariff tables and inclusions remain
unverified.** Until verified, airport pickup uses the metered-estimate profile with an
explicit "airport fixed fare not yet configured" note; no invented airport zone prices.

## 4. Caveats before publishing any tariff as "official"
- A web page's crawl date ≠ a regulation's effective date. Confirm against the **current RTD
  instrument** before marking any tariff `active` for real charging.
- Verify: day/night boundary semantics (applied at start vs by segment), whether waiting is
  billable pre-pickup (assume **no** unless RTD says otherwise), tax treatment, holiday
  movable-date computation, and urban vs rural operating rights per zone.
- Distinguish an **estimate** from a certified taximeter amount. A phone-GPS calculation is
  NOT a certified taximeter; the final regulated amount follows the authorized metering
  process.

## 5. Recommendation for the IL-Yas beta pricing engine
- **Default profile: `REGULATED_METER_ESTIMATE` (urban)** using the verified figures above +
  the real Google road distance/duration, presented as an **estimate/range** before booking.
  Day/night boundary applied at trip-start time (documented simplification for the beta).
- **`REGULATED_FIXED` (airport/zone):** implemented in the engine but **inactive** until
  airport tariffs are verified with RTD.
- **`UPFRONT_DYNAMIC`:** implemented and testable in **synthetic mode only**; multiplier
  default **1.0**, TEST cap **1.5**; **not enabled for real charging** (no established
  Cyprus dynamic-pricing authority found). Weather never multiplied on top of weather-driven
  demand without a documented non-overlap cap.
- Waiting: passenger pre-pickup waiting is **not billable** in the beta. Post-arrival paid
  waiting stays **disabled** for regulated mode pending RTD verification.

## 6. Unresolved questions (tracked)
1. Current RTD effective tariff instrument + exact effective date.
2. Airport fixed fares, zones and inclusions.
3. Whether/when post-arrival waiting is billable and the free-grace period.
4. Tax (VAT) treatment and platform-fee legality.
5. Any lawful dynamic-pricing framework in Cyprus (none found so far).

Synthetic beta tariffs isolate this uncertainty to activation flags; the pricing **engine**
is fully implemented and tested regardless.
