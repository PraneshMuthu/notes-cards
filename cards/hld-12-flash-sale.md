---
topic: HLD 12 · Flash Sale
group: HLD
---

## Flash sale (10,000 ₹1 phones at noon): what is the one bug you must never ship? {#hld12-scope}
Overselling: never reserve phone number 10,001.
**Why:** because selling phones you do not have means cancellations, refunds and bad press, while a slow or unfair queue only annoys people.
**Example:** a cinema selling 301 tickets for 300 seats: someone is turned away at the door after paying, which is far worse than "housefull" on the app.

## Flash sale: 5M users click within 10 s, impatient users retry ~2×, 10,000 phones. Peak req/s, and what share must be rejected? {#hld12-traffic}
~1M req/s at peak, and 99.8% of users must be turned away.
**Why:** because losers outnumber winners 500 to 1, the design is about rejecting cheaply, without touching Redis or the DB.
**Example:** 5M ÷ 10 s = 500K/s × 2 ≈ 1M/s. Winners: 10,000 ÷ 5M = 0.2%, so 4.99M lose.

## Flash sale: why can't stock live in one Postgres row? {#hld12-hot-row}
At most ~200 buys/s: each `UPDATE stock = stock - 1` holds the row lock ~5 ms, so 10,000 phones take ~50 s while requests pile up.
**Why:** because the lock is held through the commit and fsync (forcing the write to disk), every other buyer waits in line, and the waiters exhaust the connection pool.
**Example:** 1 ÷ 0.005 s = 200 buys/s; 10,000 ÷ 200 = 50 s.

## Flash sale: why keep the stock counter in Redis, and what is the cost? {#hld12-redis-counter}
Redis does ~100K ops/s on one key, so 10,000 phones sell in ~0.1 s of Redis time; the cost is that Redis is not the durable record.
**Why:** because it is in memory and single-threaded (no locks), with no disk write per operation; Postgres stays the source of truth via Kafka.
**Example:** 10,000 ÷ 100K ops/s = 0.1 s, versus 50 s for a Postgres row.

## Flash sale: why not split the stock into 10 Postgres rows of 1,000 instead of using Redis? {#hld12-why-not-db-buckets}
10 rows × ~200 locked updates/s ≈ 2,000 buys/s, still below the ~10K/s the waiting room admits, and every buy still pays a disk fsync.
**Why:** because splitting multiplies a slow path by 10 but the bottleneck (lock held through a disk write) remains.
**Example:** ten slow billing counters are still slower than one fast self-checkout.

## Flash sale: why does the buy path run a Lua script instead of plain `DECR`? {#hld12-lua}
`DECR` alone can go negative and lets one user buy twice. The Lua script (code Redis runs as one uninterruptible step) checks buyer and stock, then decrements and records the buyer.
**Why:** because check and decrement must be atomic, or two users both read stock 1 and both buy.
**Example:** script: if user in `buyers` → -1; if stock ≤ 0 → 0; else `DECR stock`, `SADD buyers user` → 1.
**Trap:** `GET stock` then `DECR` in app code oversells.

## Flash sale on Redis Cluster: why do `stock:{s42}` and `buyers:{s42}` share the `{s42}` part? {#hld12-shared-tag}
The `{s42}` hash tag (the part Redis hashes to pick a slot) puts both keys in one slot, and a Lua script may only touch keys in one slot.
**Why:** because Redis Cluster places keys by CRC16 of the tag mod 16,384 slots, the same tag guarantees the same node.
**Example:** two files with the same folder label always go in the same cabinet, so one clerk can update both.

## Flash sale: what principle orders the components, and how many requests survive to Redis and Postgres? {#hld12-layers}
Each layer is cheaper than the next and rejects most of what reaches it: ~1M req/s at the CDN, ~10K/s at Redis, 10,000 orders total in Postgres.
**Why:** because the cost per request rises at each layer (edge cache → gateway → Redis → DB), so the expensive ones must see the least traffic.
**Example:** a stadium: the gate checks tickets, the stand checks blocks, the usher checks seats; only one person reaches each seat.

## Flash sale: how do you serve a 500 KB product page to 5M users within a minute? {#hld12-cdn}
From a CDN (Content Delivery Network, edge caches near users), never the origin: the page and a tiny `status.json` are cached at the edge.
**Why:** because the bandwidth alone beats any origin: the edge spreads it over hundreds of locations.
**Example:** 5M × 500 KB = 2.5 TB ÷ 60 s ≈ 42 GB/s ≈ 330 Gbps.

## Flash sale: how does the waiting room decide who may buy? {#hld12-waiting-room}
Each joiner gets a signed ticket with a random `r` in [0, 1). An admitter raises `nowServing`; you may call Buy only when `r < nowServing`.
**Why:** because a random `r` makes everyone who joined before noon equal, so a bot's millisecond advantage counts for nothing.
**Example:** a lucky-draw token: arriving at 11:58 or 11:59 gives the same odds.

## Flash sale: someone joins the waiting room 30 s after noon. What `r` do they get, and why? {#hld12-late-joiner}
`r = 1 + seconds_late`, here 31, so they queue behind everyone who joined on time.
**Why:** because the lottery is fair only among on-time joiners; latecomers fall back to first-come-first-served.
**Example:** a bank token machine: on-time customers are shuffled into the draw, the latecomer just gets the next number after all of them.

## Flash sale: a bot farm opens 1,000 browser tabs. What stops it getting 1,000 lottery tickets? {#hld12-bots}
Joining needs login plus CAPTCHA (a bot-check puzzle), and the ticket carries `userId`: one verified account = one ticket.
**Why:** because the lottery already removes speed advantage, the only lever left for a bot is more tickets, so tickets are tied to accounts.
**Example:** a raffle where each Aadhaar-verified person gets one coupon, however many times they queue.

## Flash sale: how does the gateway verify a waiting-room ticket without a DB lookup? {#hld12-hmac}
The ticket (`userId, saleId, r, exp`) carries an HMAC signature, a tamper-proof stamp computed with a server secret; the gateway recomputes and compares it.
**Why:** because verification is pure CPU (microseconds) and the waiting room stores no per-user state, 5M joins are cheap.
**Example:** a wax seal on a letter: anyone with the seal pattern can tell it is genuine without phoning the sender.

## Flash sale: the admitter lets in ~10K users/s, Redis does ~100K ops/s. Headroom, and time to sell 10,000? {#hld12-redis-rate}
10× headroom, and sold out in ~1–2 s.
**Why:** because without the waiting room all ~500K req/s would hit one Redis key, 5× its capacity.
**Example:** 100K ÷ 10K = 10× headroom; at 10K admitted buys/s, 10,000 phones are gone in ~1 s, plus stragglers.

## Flash sale: stock hits zero at 12:00:02. How do the other 4.99M users find out without hitting your servers? {#hld12-load-shedding}
The Buy service sets `soldout`; the admitter writes `soldOut: true` into the CDN-cached `status.json`, so clients show "Sold out" within ~1 s, and gateways reject from a local flag.
**Why:** because after sell-out every request is guaranteed to fail, so load shedding (refusing work on purpose) answers from the cheapest layer.
**Example:** a "Housefull" board at the cinema entrance stops people from queuing at the counter.

## Flash sale: 5M clients poll `status.json` every 2 s. How does the origin survive? {#hld12-herd}
The CDN caches it for ~1 s and collapses identical misses into one origin fetch (request collapsing), so the origin sees ~1 fetch/s per edge location.
**Why:** because all 2.5M polls/s ask for the same tiny file, one copy per edge per second answers them all.
**Example:** 5M ÷ 2 s = 2.5M polls/s at the edges → a few hundred fetches/s at the origin.
**Trap:** add ±1 s jitter to polls, or every client fires on the same tick at noon.

## Flash sale: why write the order through Kafka instead of straight into Postgres? {#hld12-kafka}
So a Postgres hiccup can't fail a winner: the Buy service replies "you won" as soon as Kafka (a durable log) acks, and the order lands seconds later.
**Why:** because Kafka is durable, a reservation already promised to a user cannot be lost, while Postgres only needs to keep up on average.
**Example:** 10,000 orders × ~1 KB = 10 MB in total: volume isn't the reason, decoupling is.

## Flash sale: Kafka delivers the same order message twice. What keeps one order row? {#hld12-order-dedupe}
`INSERT ... ON CONFLICT (reservation_id) DO NOTHING`: the reservation id made by the Buy service is the primary key.
**Why:** because Kafka is at-least-once (may redeliver after a crash), the consumer must be idempotent, and the primary key makes a repeat a no-op.
**Example:** a librarian who stamps book #4471 as issued twice still has one loan record.

## Flash sale: where is "one phone per user" enforced on the hot path, and what is the backstop? {#hld12-one-per-user}
Inside the Lua script: the `buyers` set returns -1 for a repeat, in the same atomic step as the decrement. Backstop: Postgres `UNIQUE(sale_id, user_id)`.
**Why:** because checking the buyer and taking the stock in one step means no race can let a second win through; the DB catches anything Redis loses.
**Example:** a sweet shop giving one free laddoo per child ticks the name and hands over the laddoo in one motion.

## Flash sale: a winner's response is lost and the app retries Buy. What does the retry get back? {#hld12-retry}
The same `reservationId`: the app's Idempotency-Key (one id per buy attempt) maps to the stored result, instead of a confusing "you already bought".
**Why:** because the Lua script would answer -1 (repeat buyer), the idempotency lookup turns that into the original success.
**Example:** re-scanning the same paid bill at the exit gate just shows "paid" again.

## Flash sale: the Redis primary dies at 12:00:01. How do you avoid overselling? {#hld12-failover}
Pause (`soldOut=true`), wait until Kafka lag is 0, rebuild `stock = 10,000 − count(RESERVED + PAID)` and `buyers` from Postgres, then resume.
**Why:** because replication is async, the promoted replica can miss the last decrements; Postgres is the truth, and a 5 s pause is annoying but correct.
**Example:** the replica says 7,420 left, the truth is 7,400: without the rebuild, 20 phones are oversold.

## Flash sale: Redis decremented, but the Buy service crashed before writing to Kafka. Safe? {#hld12-undersell}
Yes: you under-sell by one, the safe direction. A reconcile job (Redis sold count > DB order count) returns the phone to stock.
**Why:** because a unit taken but never ordered is only a delayed sale, while the reverse would be an oversell.
**Example:** a shop sets aside a phone for a customer who never comes back; at closing it goes back on the shelf.
**Trap:** count only buyers older than ~1 min (or wait for Kafka lag 0), or the reconciler returns phones still in Kafka.

## Flash sale: how do unpaid reservations go back on sale? {#hld12-expiry}
A sweeper every 30 s: `UPDATE orders SET status='EXPIRED' WHERE status='RESERVED' AND expires_at < now() RETURNING reservation_id`, then `INCR stock` per row.
**Why:** because the DB row is the durable record of the 10-minute deadline, the sweeper can always find what expired, even after a crash.
**Example:** ~20% of winners don't pay, so ~2,000 phones return around 12:10 for a second wave.

## Flash sale: why expire reservations with a DB sweeper instead of Redis key expiry? {#hld12-expiry-not-redis}
Redis key-expiry events are fire-and-forget: if no listener is connected at that moment, the event is lost and the phone never returns.
**Why:** because a sweeper re-reads `expires_at` every run, a missed run is simply caught by the next one.
**Example:** a reminder written in a diary you check every morning, versus one shouted once across the room.

## Flash sale: a user pays at 12:09:59.9 while the sweeper expires the reservation at 12:10:00. Who wins? {#hld12-expiry-race}
Whichever commits first: both use a conditional update `WHERE status='RESERVED'`, so the other updates 0 rows.
**Why:** because Postgres serializes the two updates on one row, no phone is both sold and returned; if the sweeper wins, payment declines or refunds.
**Example:** two people grab the last train seat on the app; the booking system confirms one and the other sees "not available".
**Trap:** an expiry without `WHERE status='RESERVED'` races with payment.

## Flash sale: how does the payment step mark a reservation paid? {#hld12-payment}
`UPDATE orders SET status='PAID' WHERE id=? AND status='RESERVED'`; the payment page polls `GET /orders/{id}` briefly if Kafka hasn't delivered the row yet.
**Why:** because the same conditional update is what keeps payment and expiry safe against each other.
**Example:** a winner opens the pay page 50 ms after winning; the row lands at 80 ms, so the second poll finds it.

## Flash sale grows to 100K phones and one Redis key is hot. How do you split the stock? {#hld12-hot-key}
10 bucket keys of 10,000, each with its OWN hash tag (`stock:{s42:b0}` … `stock:{s42:b9}`), users routed by `hash(userId) % 10`.
**Why:** because one key lives on one node (~100K ops/s); Redis Cluster places a key by its hash tag (the `{...}` part), so distinct tags spread buckets across nodes.
**Example:** user 123 hashes to bucket 3 and runs the Lua script on `stock:{s42:b3}` and `buyers:{s42:b3}`, which share a slot.
**Trap:** one shared tag like `stock:{s42}:3` puts all 10 buckets in one slot, on one node, and defeats the split.

## Flash sale with 10 stock buckets: a user's bucket is empty and they fall back to others. How could they win twice, and what guard stops it? {#hld12-bucket-dup}
Each bucket's `buyers` set knows only its own winners. Guard: claim the user first with `SET won:s42:<userId> 1 NX` before any decrement; release it only if every bucket is empty.
**Why:** because a second attempt fails the NX (set-if-absent) before touching stock, and the per-user key spreads across nodes, so it creates no hot key; Postgres `UNIQUE(sale_id, user_id)` stays the backstop.
**Example:** a ration card stamped before you join any shop's queue: the second shop sees the stamp.

## Give the 30-second pitch for the flash sale as 4 beats. {#hld12-pitch}
1. 5M users for 10,000 phones: reject 99.8% cheaply (CDN page + `status.json`). 2. Waiting room: signed random tickets, ~10K/s admitted. 3. Redis Lua: atomic check-and-decrement plus buyers set. 4. Kafka → Postgres as truth; sweeper returns unpaid stock; rebuild Redis after failover. Grade Got it only if all 4.
**Why:** because each beat protects the next: fewer requests, fair order, no oversell, nothing lost.
**Example:** 1M req/s at the edge → ~10K/s at Redis → 10,000 orders in Postgres.
