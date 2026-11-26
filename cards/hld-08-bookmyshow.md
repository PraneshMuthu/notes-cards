---
topic: HLD 08 · BookMyShow
group: HLD
---

## BookMyShow: give the 30-second pitch in 4 beats. {#hld08-pitch}
1. Scale: browse ~12K reads/s vs ~360 writes/s; a hot concert brings ~83K req/s to one show. 2. Store: seats and bookings in Postgres; browse from Elasticsearch, replicas and a 1–2 s Redis seat-map cache. 3. Correctness: a hold is one conditional UPDATE (AVAILABLE → HELD → BOOKED); payment uses an idempotency key, webhook and reconciliation. 4. Spike: a waiting room admits ~500 users/s.
**Why:** double-booking is the one unforgivable bug, so correctness lives in the DB row and everything else may be slightly stale.
**Example:** a cinema: a display board out front (cache), one ticket register (DB), a rope line for premieres (waiting room).
Grade Got it only if you said all 4 beats.

## BookMyShow: why hold seats for ~10 minutes instead of booking them at the moment payment succeeds? {#hld08-why-hold}
So nobody pays for a seat that someone else takes mid-checkout. The hold reserves the seat while payment, which can take minutes, completes.
**Why:** without a hold, two users can both pay for A1 and one must be refunded. "Seat unavailable" before paying is a far better experience than a refund after.
**Example:** a trial room: you hold the shirt while you try it on, and it goes back on the rack if you walk away.

## BookMyShow: each hold gets a `hold_id`. Why a server-generated UUID rather than a DB auto-increment number? {#bms-hold-id}
The Booking service mints it in memory with no DB round trip, it stays unique across shards (`show_id` sharding at 10×), and nobody can guess it by counting up.
**Why:** auto-increment needs one central counter (a sequence or `holds` table) that every hold must call, and per-shard counters collide (two shards both issue 1001). A random UUID has 122 random bits, so it is unique without any coordination.
**Example:** cloakroom tokens printed by each counter's own machine with a long random code, versus one token dispenser for the whole stadium that every counter must queue at.
**Trap:** random isn't secret: a UUID in a URL still needs an ownership check (`held_by` = this user).

## BookMyShow: why does `bookings` have its own status next to `seats.status`? {#bms-booking-status}
They track different things: `seats.status` is the seat (is A1 free right now?); `bookings.status` is one purchase attempt (did this checkout get paid?).
**Why:** their lifecycles split. If payment fails, the booking stays FAILED for history while A1 goes back to AVAILABLE. One seat sees many booking attempts over time.
**Example:** a restaurant table versus the reservations for it: the table is free again after a no-show, but the cancelled reservation stays in the book.

## BookMyShow: the seat map is cached for 1–2 s. A user taps A1, shown green but just taken. What happens, and why is that acceptable? {#bms-cache-aside}
The hold's conditional UPDATE matches 0 rows, so the user gets a 409 listing the taken seats and a fresh map. Nothing is double-booked.
**Why:** correctness lives in the DB row; the cache (cache-aside: the app fills it on a miss) only draws the picture, and it heals within one TTL (time-to-live).
**Example:** the menu board says "biryani available"; the kitchen still tells you "just finished" when you order.
**Trap:** a slow reader can write an old map back just after a booking deleted the key; only the short TTL bounds that.

## BookMyShow at 20 app servers: why does the LLD's in-memory per-show lock stop working? {#hld08-lock-moves}
Each server has its own lock object in its own memory, so server 3 and server 7 both "hold" the lock and both sell A1.
**Why:** a lock only excludes code that checks the same lock. Across processes it must live in shared state: the DB row (conditional UPDATE) or Redis.
**Example:** two ticket windows each keeping their own register: both sell seat A1 because neither sees the other's book.

## BookMyShow: two users click A1+A2 in the same millisecond. What single statement guarantees exactly one winner? {#hld08-conditional-update}
`UPDATE seats SET status='HELD', hold_id=:h … WHERE show_id=:s AND seat_id IN ('A1','A2') AND (status='AVAILABLE' OR hold expired)`, then require rows_affected = 2, else ROLLBACK → 409.
**Why:** Postgres row-locks each row it updates, so the second transaction waits, re-checks the WHERE, sees HELD and updates 0 rows. Check and write are one step, so there is no gap to race through.
**Example:** Asha's UPDATE locks A1 and A2 and commits; Ravi's waits ~1 ms, re-reads HELD, changes 0 rows and sees "seats just taken".
**Trap:** SELECT the status, then UPDATE, lets both read AVAILABLE and both win.

## BookMyShow: a single conditional UPDATE, or `SELECT … ORDER BY seat_id FOR UPDATE` first? When do you use each? {#hld08-for-update}
Single UPDATE by default: one seat, or seats that lock in a consistent order. Lock first with `SELECT … ORDER BY seat_id FOR UPDATE` for multi-seat holds whose lock order isn't guaranteed, to prevent deadlock.
**Why:** Postgres locks rows in scan order, not your IN-list order. If Asha locks A1 then A2 while Ravi locks A2 then A1, each waits on the other. A fixed order means one simply waits. The cost is a second round trip while holding locks.
**Example:** two diners each grab one chopstick and wait forever; if everyone picks up the left one first, one just waits.
**Trap:** Postgres's deadlock detector (after 1 s) aborts one as a backstop; that loser gets a 409 and retries.

## BookMyShow: hold seats with a Postgres conditional UPDATE or Redis `SET NX EX 600`? Pick one and name the risk of the other. {#hld08-db-vs-redis-hold}
Postgres. With Redis holds, a key lost in a Redis failover mid-payment lets someone else grab a seat we are about to confirm.
**Why:** in Postgres the hold and the booking share one source of truth, so confirm (seats → BOOKED + booking → CONFIRMED) is one transaction. The load (~360 writes/s, ≤1,000 holds/s behind the waiting room) needs nothing faster.
**Example:** writing reservations in the same register as sales, versus on sticky notes that might fall off the wall.
**Trap:** Redis holds are also an accepted answer (Hello Interview picks them); say why you chose yours.

## BookMyShow: why Postgres, not Cassandra, for seats and bookings? {#hld08-postgres}
A hold must be all-or-nothing across rows ("all 4 seats HELD, or none"), which needs an ACID transaction (all-or-nothing, isolated from other writers). Cassandra has no multi-row transactions.
**Why:** Cassandra's strength is huge write volume, and there isn't any: ~360 writes/s and ~0.5 TB/year fit one primary plus replicas.
**Example:** 1M bookings/day ÷ 86,400 ≈ 12/s, × 10 for Friday peak, × 3 writes each ≈ 360 writes/s.

## BookMyShow: a user holds seats and closes the app. What frees the seats, and what is the ~30 s sweeper for? {#hld08-hold-expiry}
The next hold's WHERE treats `status='HELD' AND hold_expires_at < now()` as free (lazy reclaim). The sweeper only repaints the seat map green and marks the booking EXPIRED.
**Why:** correctness then needs no background job; if the sweeper lags, the seats are still sellable, just shown grey for a while.
**Example:** a hotel key card stops working at checkout time, so the next guest can check in even if the front desk board still says "occupied".
**Trap:** cron-only expiry leaves seats stuck whenever the job lags.

## BookMyShow: the hold expires at 10:00, the bank confirms payment at 10:30, and the seat was resold. How do you avoid giving one seat to two people? {#hld08-late-payment}
Confirm only if the hold is still ours: `UPDATE seats SET status='BOOKED' WHERE hold_id=:h AND status='HELD'`. Fewer rows than seats → booking FAILED and auto-refund.
**Why:** the re-hold stamped a different `hold_id` on the seat, so the late confirm matches 0 rows. The money goes back instead of a seat being sold twice.
**Example:** yesterday's cloakroom token won't collect today's coat from the same hook.

## BookMyShow: how do you make a late bank reply rare in the first place? {#hld08-hold-extend}
When payment starts, extend the hold once to now + 15 min, longer than the payment gateway's own timeout (~10–15 min).
**Why:** the seat then outlives every normal payment attempt, so only true stragglers hit the refund path.
**Example:** a user taps Pay at minute 9 of a 10-minute hold; the hold now runs to minute 24.

## BookMyShow: Razorpay's payment webhook arrives twice. What happens the second time? {#hld08-webhook}
Nothing: confirm is idempotent (repeating it has the same effect as once). The booking is already CONFIRMED, so return 200 and change nothing.
**Why:** gateways retry a webhook (the HTTP call they make to our URL when payment finishes) until they get a 200, so duplicates are routine, not rare.
**Example:** a courier rings twice with the same parcel; you say "already got it" and nothing more happens.
**Trap:** verify the webhook's signature first, so only Razorpay can confirm bookings.

## BookMyShow: the payment webhook never arrives. How does the booking still resolve? {#hld08-reconcile}
A reconciliation job every minute takes PENDING bookings older than ~5 min, asks the gateway's status API, and confirms or fails each exactly as the webhook would.
**Why:** webhooks get lost (our server down, a network drop), so a push alone can't be trusted; a periodic pull catches whatever the push missed.
**Example:** if the courier's "delivered" SMS never comes, you open the tracking page yourself.

## BookMyShow: the user double-clicks Pay. What guarantees one hold produces exactly one charge? {#hld08-payment-idempotency}
`hold_id UNIQUE` on bookings makes the retry return the same booking, and that `bookingId` is the gateway's idempotency key, so the gateway returns the same order.
**Why:** each step turns a repeat into "return what you did before" (an idempotency key is an id that marks a request as a repeat), so retries can't multiply.
**Example:** clicks 200 ms apart: the second INSERT hits UNIQUE(hold_id) and returns booking B77; the gateway sees key B77 again and returns the existing order.

## BookMyShow: 50M monthly users, 10% active daily, 20 page views each, 10× peak, ~360 writes/s at peak. Derive peak reads/s and the read:write ratio. {#hld08-read-math}
5M DAU × 20 = 100M reads/day ÷ 86,400 ≈ 1,200/s, × 10 ≈ 12K reads/s. Against ~360 writes/s, that is ~30:1.
**Why:** read-heavy traffic goes to cache, read replicas and search, which keeps the primary free for seat writes.
**Example:** for every 30 people reading the showtimes board, one walks up to buy.

## BookMyShow: event search with Elasticsearch, or a Postgres replica with `ILIKE`? When does Elasticsearch earn its place? {#hld08-search}
When you need typo-tolerant, ranked search with filters ("coldply mumbai" → Coldplay). A small catalogue can use a replica with `ILIKE`.
**Why:** Elasticsearch (a search index) ranks by text relevance and forgives typos; `ILIKE` only matches substrings by scanning rows. ES is fed by CDC (streaming the DB's change log), so it lags a little.
**Example:** a user types "coldply mumbai" and still finds Coldplay at DY Patil; `ILIKE '%coldply%'` finds nothing.

## BookMyShow: 1M users arrive in 60 s for a 50,000-seat concert, ~5 requests each, ~2 seats per buyer. Derive the request rate and the share who must lose. {#hld08-hot-spike}
1M ÷ 60 ≈ 16.7K users/s × 5 ≈ 83K req/s, all on one show. 50K ÷ 2 = 25K buyers, so ~97.5% get nothing whatever we build.
**Why:** all that load hits one show's rows, so sharding can't spread it; the crowd must be stopped before the booking service.
**Example:** a million fans outside a 50K stadium: the gates, not the stands, are where you manage them.

## BookMyShow: is a hot on-sale a capacity problem or a contention problem, and what follows? {#hld08-traps}
Contention: thousands of transactions fight over the same rows of one show. So you queue users before the DB instead of adding DB capacity.
**Why:** row locks make writers to the same seat take turns; more servers only add more waiters, and failed holds trigger retries that multiply the load.
**Example:** a bigger mall doesn't help when everyone queues at one shop's door.

## BookMyShow: how does the virtual waiting room for a hot show work? {#hld08-waiting-room}
Users join a Redis sorted set `queue:{showId}` scored by arrival time. An admitter lets N users/s through with a short-lived signed access token, and the Booking service accepts holds only with a valid token.
**Why:** the DB then sees a rate we chose, not the crowd's rate. The token stops anyone skipping the queue by calling the hold API directly.
**Example:** stewards at a stadium gate let in a batch at a time, and staff inside check wristbands.

## BookMyShow: Postgres can safely take ~1,000 hold transactions/s and each admitted user makes ~2 attempts. What admit rate, and how long until 50K seats sell if half of admitted users buy 2 seats? {#hld08-admit-rate}
1,000 ÷ 2 = 500 users/s. 25K buyers ÷ 50% = 50K admitted ÷ 500/s = 100 s (~2 min).
**Why:** you derive the admit rate backwards from the bottleneck (the DB's safe budget), never from the size of the crowd.
**Example:** a temple darshan queue lets people in only as fast as the inner hall empties, however long the line outside.

## BookMyShow: 1M users in the waiting room poll for their position every 5 s. What does that cost, and on which system? {#hld08-queue-cost}
1M ÷ 5 s = 200K Redis reads/s, so 2–4 Redis nodes at ~100K ops/s each, and zero load on Postgres.
**Why:** a position check is a cheap rank lookup on an in-memory sorted set, which is exactly why the queue lives in Redis, not the booking DB.
**Example:** checking a token display board costs you a glance, not a conversation with the clerk.

## BookMyShow: user 800,000 in the queue would wait 40 minutes for nothing. What do you show them? {#hld08-honest-queue}
"Very likely sold out" as soon as the admitted count clearly exceeds what the remaining seats can serve, then "Sold out" the moment available seats hit 0.
**Why:** ~25K buyers empty the show, so we know early who can't win; honest beats hopeful.
**Example:** IRCTC showing "waitlist 400" up front beats watching a spinner for 40 minutes.

## BookMyShow: the hot show's seat-map key expires under 80K reads/s. Why is it safe to serve the slightly old map while one request refills it? {#hld08-stampede}
A stale map can't cause a double booking: the hold's conditional UPDATE is the real check, so stale only means the occasional 409.
**Why:** the stampede fix (single-flight: one request refills via `SET key:lock NX`, the rest wait ~50 ms or take the old copy) protects Postgres, and it is acceptable only because correctness never comes from the cache.
**Example:** the old map shows A1 green; the user taps it and gets "just taken", nothing worse.

## BookMyShow: during a hot sale the seat map goes stale fast and admitted users keep tapping taken seats. What do you change? {#hld08-seat-push}
Push seat changes to admitted users over SSE (Server-Sent Events, one-way server push) or WebSocket instead of polling. The hold is still the real check.
**Why:** only the ~50K admitted users need a live map, so holding their connections open is cheap, and each change reaches them in under a second.
**Example:** a live cricket scoreboard updating itself versus pressing refresh every few seconds.

## BookMyShow: the Postgres primary dies mid-sale. What do users see, and what is lost? {#hld08-failover}
Holds return 503 for ~30 s while a failover tool (Patroni, or managed RDS/Aurora) promotes a synchronous standby. No committed hold is lost, and the waiting room pauses admission.
**Why:** synchronous means the standby confirmed every commit before the user got OK, so it has everything. Postgres has no built-in auto-failover, hence the tool.
**Example:** at 500 admits/s, a 30 s pause keeps ~15K people in the queue a little longer.

## BookMyShow: Redis (seat-map cache and waiting-room queue) dies. What happens? {#hld08-redis-dies}
Annoying but never unsafe: seat maps fall back to Postgres read replicas (slower), and the queue rebuilds from a Redis replica (worst case, positions reset).
**Why:** seat correctness lives in Postgres, so losing Redis costs speed and fairness, never a double booking.
**Example:** a bank's token display goes blank: the queue gets confused, but nobody's money moves wrongly.

## BookMyShow at 10×: 25M tickets/day instead of 2.5M (today ~360 writes/s at peak). Give the new write rate and the one structural change. {#hld08-10x}
~3,600 writes/s at peak, still fine for a large primary, but storage (~5 TB/yr) and lock contention grow. Shard by `show_id` and archive shows older than ~3 months.
**Why:** a hold never spans two shows, so sharding by `show_id` keeps every hold transaction on one shard.
**Example:** 0.5 TB/yr × 10 = 5 TB/yr; archiving shows older than 3 months keeps the hot set to roughly a quarter of a year.

## BookMyShow: how do you stop one account holding 50 seats of a hot show to resell? {#hld08-scalper}
Enforce a per-account cap (e.g. 4 seats per show) inside the hold transaction itself.
**Why:** a cap checked where the seats are written can't be skipped by calling the API directly; gateway rate limits, CAPTCHA and one verified phone per account slow down bots opening many accounts.
**Example:** a ration shop's "2 kg per card" limit, ticked in the same register as the sale.
