---
name: ilyas-cyprus-fares
description: Research Cyprus taxi-market rules and implement versioned IL-Yas fare, quote, waiting and cancellation policies. Use for tariff or pricing changes.
---

Read Task 012 sections 3 and 6, then the current research and tariff configuration.
Prefer Road Transport Department instruments and dated primary operator sources.
Record jurisdiction, category, effective date, inclusions and uncertainty for each rule.
Keep regulated estimates, regulated fixed fares and authorized dynamic offers separate.
Do not infer Cyprus legality from a global Bolt or Uber page. Unverified parameters may
be synthetic test fixtures, never silently active official tariffs.

Implement server-owned immutable quote snapshots using cents/Decimal and versioned
rules. Explicitly model wait versus drive intervals, tax inclusion, tariff precedence,
quote expiry and accepted amendments. Test double-counting and replay at boundaries.
Produce worked examples with sourced values or clearly marked synthetic values.
Weather and low supply can affect availability/ETA even when surcharge is disabled.
Keep normal pricing automatic; do not send individual fares to a dispatcher.
