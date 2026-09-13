---
name: ilyas-auto-dispatch
description: Implement IL-Yas automatic ride matching, expiring driver offers and durable assignment recovery. Use for dispatch, availability or scheduling changes.
---

Read Task 012 section 4 and current assignments, booking state machine and DB schema.
Use road pickup ETA after an indexed spatial prefilter. Filter account/vehicle/binding,
service rights, capacity, fresh GPS and live availability before ranking.
Preserve all three active-assignment uniqueness guarantees and extend them across
pending reservations. Recheck eligibility in acceptance transactions. Use SYSTEM actors.

Run matching in a durable worker with outbox/recovery, server deadlines and fencing.
Never rely on a dispatcher tab or passenger request lifetime. Avoid external API calls
inside long DB locks. Treat notifications as hints; authenticated DB state is authority.
Test acceptance races, expiry, cancellation, multi-worker restart and fairness under
contention. Never reassign an in-progress trip because its GPS disconnects.
Explain our chosen policy without claiming proprietary competitor algorithms.
