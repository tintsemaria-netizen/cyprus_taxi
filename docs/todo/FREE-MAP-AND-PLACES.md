# Parked (2026-11-28): cut Google costs — free map, open places, own router

Operator: «очень хорошая идея, начнём, когда начнутся расходы». Start when the Google bill becomes noticeable.

## What Google charges for today (from the code)
- Dynamic Maps: every map open (passenger + driver), $7 / 1000 after 10k free per month.
- Place Details Pro (we ask displayName): $17 / 1000 after 5k free. Autocomplete requests are free within a session.
- Geocoding (my-location label, postcode, street name): $5 / 1000 after 10k free.
- Compute Routes Pro (TRAFFIC_AWARE), $10 / 1000 after 5k free. Used for: the quote; dispatch (SHORTLIST 5 per cycle); passenger pickup ETA (views.ts cache 20 s); driver in-app navigation (refresh 60 s + reroutes).
- Rough estimate: $0.55–0.95 per ride (≈ $0.30–0.55 if the driver navigates in Waze). The first 100–200 rides per month are inside the free caps.

## Plan, in order
1. Google call counter per SKU (cheap; gives real numbers from the beta).
2. Passenger pickup ETA: 60 s instead of 20 s, and none while the app is hidden (the SSE path still recomputes).
3. Passenger map → free vector map. Branch `free-map` has NEXT_PUBLIC_MAP_STYLE_URL(_LIGHT) + CSP for tiles.openfreemap.org.
   - Operator liked the OpenFreeMap «fiord» style; recolour it to graphite / lime.
   - Driver stays on Google + traffic layer (TrafficLayer: no extra map loads).
4. Places layer from Overture Maps:
   - Theme places, CDLA-Permissive-2.0 / Apache-2.0, monthly releases; s3://overturemaps-us-west-2/release/<ver>/theme=places/type=place/*.
   - Cyprus bbox: 62,770 places, 30,105 with confidence ≥ 0.7, mostly from Meta. Limassol: 5,922 with conf ≥ 0.6.
   - Weekly job: check for a new release (only the last 2 releases stay online, ~60 days), import Cyprus with DuckDB (~4 s), diff. Show taxi groups: hotels, food, bars/clubs, malls, hospitals, transport, beaches. Plus our popular places and the top real destinations.
   - Never copy Google Places content: its terms forbid caching it and showing it on a non-Google map.
5. Own router (OSRM / Valhalla on our server) for reroutes and turn-by-turn. Google only for traffic ETAs: at the start, then every ~5 min.
   - Later: «own traffic» from our drivers' GPS speeds.

Demo files: /tmp/osm (style screenshots), /tmp/ovt (DuckDB query). Screenshots were sent to the operator on 2026-11-28.
