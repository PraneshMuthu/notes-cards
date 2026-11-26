---
topic: HLD 08 · BookMyShow
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

## Give the 30-second pitch for BookMyShow. {#hld08-pitch}
Browse is read-heavy (~12K reads/s) and served from Elasticsearch, replicas and a 1-2 s Redis seat-map cache. Booking is the seat state machine AVAILABLE → HELD → BOOKED in Postgres via one conditional UPDATE. Payment uses an idempotency key, webhook and reconciliation job. A hot on-sale goes through a waiting room admitting ~500 users/s.
**Why:** double-booking is the one unforgivable bug, so correctness lives in the DB row, not the cache.

## Why does the LLD's in-memory per-show lock not work here? {#hld08-lock-moves}
The lock lives in one JVM's memory. With 20 app servers each has its own lock object, so two servers both "hold" the lock and both sell A1.
**Why:** the lock must live where all servers share it: the database row (conditional UPDATE) or Redis.

## How does a conditional UPDATE prevent two users getting seat A1? {#hld08-conditional-update}
`UPDATE seats SET status='HELD', hold_id=… WHERE show_id=… AND seat_id IN (…) AND (status='AVAILABLE' OR (status='HELD' AND hold_expires_at < now()))`, then check rows_affected equals seats requested, else ROLLBACK and 409.
**Why:** Postgres row-locks each row, so the second transaction waits, re-checks the WHERE, sees HELD and updates 0 rows. The check and write are one statement.
**Trap:** SELECT then UPDATE lets both users read AVAILABLE and both win.

## Seat holds: Postgres conditional UPDATE or Redis `SET NX EX`? {#hld08-db-vs-redis-hold}
Chosen: the DB. One source of truth, and confirm is one transaction (seats → BOOKED plus booking → CONFIRMED). The load is only ~360 writes/s.
**Why:** with Redis the hold lives in Redis but the booking in Postgres; if Redis loses a key mid-payment, someone else can grab a seat about to be confirmed. Redis (`SET seat:{show}:{A1} {holdId} NX EX 600`, Lua for multi-seat) wins only if the DB can't take the write rate.
**Example:** both are accepted answers; say why you picked yours.

## Why Postgres and not Cassandra for bookings? {#hld08-postgres}
Hold needs "mark these 4 seats HELD only if all 4 are free, else none", and confirm needs seats BOOKED plus booking insert together: an ACID transaction (all-or-nothing, isolated from other writers).
**Why:** Cassandra has no multi-row transactions, and ~360 writes/s (1M bookings/day ÷ 86,400 ≈ 12/s, × 10 peak, × 3 writes) needs no NoSQL write scale. ~0.5 TB/year fits one primary plus replicas.

## Why is the seats primary key `(show_id, seat_id)`? {#hld08-seat-key}
Every hold touches seats of one show, so the rows it locks sit together.
**Why:** if you ever shard, `show_id` is the shard key, since a hold never spans two shows. Also `hold_id UNIQUE` on bookings means one hold produces at most one booking, even on a double-click of Pay.

## Two users want A1+A2 and grab them in opposite order. Deadlock? {#hld08-deadlock}
Possible if rows lock in different orders. Sorting the `IN (...)` list does not control lock order. Force it with `SELECT … ORDER BY seat_id FOR UPDATE` first, then UPDATE.
**Why:** Postgres also detects deadlocks (after `deadlock_timeout`, 1 s) and aborts one; the loser gets a 409 and retries.

## How are expired holds reclaimed? {#hld08-hold-expiry}
Lazily: the UPDATE's WHERE treats `status='HELD' AND hold_expires_at < now()` as free, so correctness needs no cleanup job. A sweeper every ~30 s resets them to AVAILABLE and marks PENDING bookings EXPIRED so the seat map turns green.
**Why:** the sweeper is cosmetic; if it lags, seats are still sellable.
**Trap:** relying on a cron job alone leaves seats stuck.

## The user pays at minute 9:58 but the bank replies at 10:30 and the seat went to someone else. {#hld08-late-payment}
Two protections: extend the hold to now + 15 min once payment starts (outlives the gateway timeout), and make confirm conditional: `UPDATE seats SET status='BOOKED' WHERE hold_id=:h AND status='HELD'`.
**Why:** if rows_affected is fewer than the seat count, the booking is FAILED and auto-refunded via the gateway's refund API.

## What is a webhook, and what if it arrives twice or never? {#hld08-webhook}
A webhook is the gateway calling our URL (`POST /payments/webhook`) when payment finishes; a signature check proves it is from Razorpay.
**Why:**
- twice: confirm is idempotent (already CONFIRMED, return 200, do nothing)
- never: a reconciliation job every minute asks the gateway for the status of PENDING bookings older than ~5 min and confirms or fails them

## How do you ensure a user is never charged twice for one hold? {#hld08-payment-idempotency}
Three layers: the client sends the same `Idempotency-Key` on `POST /bookings`, `hold_id UNIQUE` on bookings returns the same booking on retry, and `bookingId` is the gateway's idempotency key.
**Why:** a double-click or network retry then maps to the same booking and the same gateway order.

## What are the browse-side numbers? {#hld08-read-math}
50M MAU × 10% = 5M DAU × 20 page views = 100M reads/day ÷ 86,400 ≈ 1,200/s, × 10 peak ≈ 12K reads/s. Writes ~360/s, so read:write ≈ 30:1.
**Why:** serve browse from cache, read replicas and Elasticsearch; keep the primary for seat writes. ES (fed by CDC, streaming the DB change log) earns its place for fuzzy search ("coldply"); a small catalogue can use a replica with `ILIKE`.

## What does the hot concert do to the system, in numbers? {#hld08-hot-spike}
1M users in 60 s ≈ 16.7K users/s × ~5 requests ≈ 83K req/s, all on one show. 50,000 seats ÷ 2 per buyer ≈ 25K buyers, so ~97.5% of the crowd cannot get a ticket whatever we build.
**Why:** all that load hits one show's rows: thousands of transactions queue on the same row locks, most 409, retries multiply the load. Stop the crowd before the booking service.

## How does the virtual waiting room work? {#hld08-waiting-room}
Hot shows (`hot = true`) route through a queue: Redis sorted set `queue:{showId}` scored by arrival time; clients poll for position; an admitter lets in N users/s with a short-lived signed access token that the Booking service requires for holds.
**Why:** it caps the rate the DB sees. Optionally randomise among those who arrived before the start to defeat refresh-at-10:00:00 bots.
**Example:** the queue outside a stadium gate.

## How fast do you admit users from the waiting room? {#hld08-admit-rate}
Postgres safe budget ~1,000 hold txns/s ÷ ~2 attempts per user = ~500 users/s. About 50K admitted users (50% convert) ÷ 500 = 100 s (~2 min).
**Why:** the queue polling itself costs 1M ÷ 5 s = 200K Redis reads/s, so 2-4 Redis nodes at ~100K ops/s each.

## User 800,000 in the queue is waiting 40 minutes for nothing. What do you do? {#hld08-honest-queue}
Show "very likely sold out" early once admitted count clearly exceeds what remaining seats can serve, and flip to "Sold out" when available seats hit 0.
**Why:** honest beats hopeful, since ~25K buyers empty the show.

## What else protects a hot on-sale besides the waiting room? {#hld08-hot-layers}
- CDN serves the static event page
- gateway rate limits per user and IP (e.g. ≤ 5 hold attempts/min) plus a CAPTCHA before joining the queue
- a per-account seat cap (e.g. 4 for hot shows, vs ~10 normal) enforced in the hold transaction
**Why:** blocks bots and scalpers, and a KYC-verified phone per account stops hoarding.

## The seat-map cache stampedes when a hot key expires. Fix? {#hld08-stampede}
At 80K reads/s, thousands of requests miss together and all hit Postgres. Let only one request refill (a Redis `SET key:lock NX`, or in-process single-flight); the rest wait ~50 ms or take the slightly old copy.
**Why:** safe because seat correctness never comes from the cache; the hold UPDATE is the real check.
**Example:** alternatively push seat changes to admitted users via SSE/WebSocket instead of polling.

## The Postgres primary dies mid-sale. What happens? {#hld08-failover}
A synchronous standby (acks every commit) is promoted by a failover manager (Patroni, or managed RDS/Aurora; Postgres has no built-in auto-failover) in ~30 s. No committed hold is lost.
**Why:** during failover holds return 503 and clients retry; the waiting room pauses admission.

## Common BookMyShow design mistakes? {#hld08-traps}
- keeping the LLD in-memory lock
- read-then-write without a condition
- cron-only hold expiry
- charging synchronously and trusting one callback
- trying to scale the database for a hot on-sale instead of queueing users
- forgetting that 97% of the concert crowd must lose
**Why:** the problem is contention on one show's rows, not total capacity.
