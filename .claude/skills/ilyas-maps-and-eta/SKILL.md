---
name: ilyas-maps-and-eta
description: Build and debug IL-Yas Google Maps, Places, fleet visibility, GPS freshness and passenger pickup ETA. Use for location or map flows.
---

Read Task 012 section 5 and current Google adapter, SDK loader, picker and tracking view.
Do not confuse driver-to-pickup ETA with pickup-to-destination travel time. Read current
official Google API guidance for fields, traffic options, limits and allowed storage.
Time-bound SDK and map rendering separately; reset failed loads safely and ignore late
generations. Preserve CSP, idle/no-lookup behavior and user-controlled map position.

Show all active on-duty service vehicles with availability states, not only the matched
car. Only the matching passenger receives assigned-driver contact and exact trip feed.
Keep GPS sampledAt, receivedAt, accuracy and route calculatedAt distinct; age markers and
ETA without needing a successful next response. Never simulate live motion or traffic.
Verify coarse/denied/late geolocation, Places races, route direction and actual rendering.
Document foreground web GPS limits rather than claiming reliable background tracking.
