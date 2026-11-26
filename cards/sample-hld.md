---
topic: HLD · BookMyShow
group: HLD
---

## Why is `hold_id` a UUID, not auto-increment? {#bms-hold-id}
The Booking service generates it once per hold request, before the UPDATE runs, and stamps it on every seat in that hold.
**Why:** no `holds` table exists to hand out numbers, and it must be unguessable. A late payment is matched on `hold_id`: if the hold expired and someone re-held the seat, the id differs, so confirm finds 0 rows and refunds.
**Example:** a cloakroom token. Your coat and bag get the same token, and a stranger's token will not collect them.

## Why does `bookings` have its own status next to `seats.status`? {#bms-booking-status}
They track different things. `seats.status` is the seat (is A1 free right now?). `bookings.status` is one purchase attempt (did this checkout get paid?).
**Why:** the lifecycles split. If payment fails, the booking stays `FAILED` for history while A1 goes back to `AVAILABLE`. One seat sees many booking attempts over time.
**Example:** a restaurant table versus the reservations for it. The table is free again after a no-show, but the cancelled reservation stays in the book.

## The seat-map cache is cache-aside. What does "eventually consistent" mean here? {#bms-cache-aside}
Redis never talks to Postgres. On a miss, the Booking service reads Postgres, writes the map into Redis with a 1-2 s TTL, and returns it.
**Why it is fine:** after a write the cache can be wrong for at most one TTL, then it heals. A seat shown green but taken simply fails at the hold step with a 409.
**Trap:** a slow reader writes an old map back after a booking deleted the key. It stays stale until the TTL expires, so keep the TTL short.
