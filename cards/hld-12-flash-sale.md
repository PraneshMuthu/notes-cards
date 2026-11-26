---
topic: HLD 12 · Flash Sale
group: HLD
---

## What is the one bug a flash sale must never have, and what do you clarify? {#hld12-scope}
Overselling: never reserve phone number 10,001. Clarify: one SKU (stock-keeping unit, one product variant), ~5M users in 10 s, winning = a reservation with 10 minutes to pay, one phone per user, fairness vs bots.
**Why:** selling ₹1 phones you do not have means refunds and bad press. Search, cart and delivery are out of scope.

## How many requests per second hit at noon, and what share must be rejected? {#hld12-traffic}
~500K/s average, ~1M/s with retries, and 99.8% must be rejected.
**Why:** 5M users ÷ 10 s = 500K/s, × 2 for impatient retries ≈ 1M/s. Winners are 10,000 ÷ 5M = 0.2%, so 4.99M users are losers and should be turned away without touching Redis or the DB.

## Why can't stock live in one DB row? {#hld12-hot-row}
Each `UPDATE stock = stock - 1` holds the row lock ~5 ms (update + commit + fsync), so max 1 ÷ 0.005 = 200 buys/s. A hot row also exhausts the connection pool and stalls the whole DB.
**Why:** selling 10,000 would take 50 s while 500K req/s pile up. Redis `DECR` does ~100K ops/s on one key (single-threaded, in memory, no disk), so 10,000 sells in ~0.1 s.

## Why does the buy path use a Lua script instead of plain `DECR`? {#hld12-lua}
Plain `DECR` can go negative and does not stop one user buying twice. A Lua script runs as one indivisible step in Redis: if user in `buyers` return -1; if stock ≤ 0 return 0; else `DECR`, `SADD`, return 1.
**Why:** check and decrement must be atomic, or two users both read 1 and both buy.
**Trap:** `GET stock` then `DECR` in app code oversells.

## What is the architecture in one line per layer? {#hld12-layers}
CDN (page + `status.json`), waiting room (signed ticket), API gateway (rate limit, ticket check, sold-out flag), Buy service + Redis (atomic stock), Kafka → Order service → Postgres (async order write).
**Why:** each layer is cheaper than the next. Only ~10K/s reach Redis and only 10,000 winners reach Postgres.
**Example:** CDN = Content Delivery Network, servers near users that cache static files.

## Why can only a CDN serve the product page? {#hld12-cdn}
5M users × 500 KB page = 2.5 TB. Over 60 s that is ~42 GB/s ≈ 330 Gbps, more than any origin has.
**Why:** the page and a tiny `status.json` ("now serving", "sold out") are cached at the edge with a ~1 s TTL, so they cost the origin almost nothing.

## How does the waiting room work and why is it fair? {#hld12-waiting-room}
Joining (CAPTCHA + login) returns a signed ticket with a random number `r` in [0, 1). An admitter raises `nowServing` in `status.json`; only users with `r < nowServing` may call Buy. Joiners before noon all get random `r`, so it is a lottery. Late joiners get `r = 1 + seconds_late`.
**Why:** first-come-first-served rewards bots with millisecond latency. One verified account = one ticket.
**Example:** a bank token-number system with a "now serving" screen.

## What is a signed ticket and why no DB write? {#hld12-hmac}
An HMAC signature is a tamper-proof stamp the server can verify with a secret key, with no lookup. The ticket carries `userId, saleId, r, exp`.
**Why:** the gateway rejects forged tickets in microseconds and the waiting room needs no per-user server state, so 5M joins are cheap.

## How many users reach Redis and how long until sold out? {#hld12-redis-rate}
~10,000 admitted users/s, so Redis (~100K ops/s) has 10× headroom, and sold out in ~1-2 s.
**Why:** without the waiting room all 500K req/s would hit one Redis key, 5× its capacity.

## Stock hits zero at 12:00:02. What happens to the other 4.99M users? {#hld12-load-shedding}
Load shedding (deliberately refusing work to protect the system). The Buy service sets `soldout`, the admitter writes `soldOut: true` into `status.json`, and clients show "Sold out" within ~1 s with no request to origin. Gateways cache the flag locally and reject in microseconds.
**Why:** after 12:00:02 every request is a loser.

## How do you avoid a thundering herd at exactly 12:00:00? {#hld12-herd}
The countdown only enables the button; clicks reach the gateway only if the ticket is called. Status polls get ±1 s jitter. The CDN collapses identical requests.
**Why:** 5M clients polling every 2 s = 2.5M polls/s become ~1 origin fetch/s per edge location.

## Why create the order through Kafka instead of writing Postgres directly? {#hld12-kafka}
Postgres could handle ~2K writes/s, but Kafka decouples: if Postgres hiccups, winners still get an instant "yes" and the order lands seconds later. Reply only after Kafka acks.
**Why:** Kafka is durable, so a reservation already promised to a user is not lost. The Order service does `INSERT ... ON CONFLICT DO NOTHING` with `status=RESERVED`.
**Example:** total volume is only 10,000 × ~1 KB = 10 MB.

## How do you enforce one phone per user? {#hld12-one-per-user}
Three layers: the Lua script's `buyers` SET returns -1 for a repeat, the Idempotency-Key returns the same `reservationId`, and Postgres `UNIQUE(sale_id, user_id)` is the final guard.
**Why:** each layer catches what slips through the one before.

## The Redis primary dies at 12:00:01. How do you avoid overselling? {#hld12-failover}
Replication is async, so the promoted replica may miss the last decrements. Pause (set `soldOut=true`), wait until Kafka lag is 0, rebuild `stock = 10,000 − count(RESERVED + PAID)` and `buyers` from Postgres, resume.
**Why:** Postgres is the source of truth and Redis a rebuildable copy. A 5 s pause is annoying but correct.
**Example:** replica says 7,420 left, truth is 7,400: 20 oversold without the rebuild.

## Redis decremented but the Buy service crashed before Kafka. Safe? {#hld12-undersell}
Yes: you under-sell by one, which is the safe direction. A reconcile job (Redis sold count > DB order count) returns the phone.
**Trap:** a healthy win is briefly in Redis but not yet Postgres (still in Kafka). The reconciler must only count buyers older than ~1 min or wait for lag 0, or it returns phones that were really sold.

## How does reservation expiry return unpaid phones? {#hld12-expiry}
A sweeper every 30 s runs `UPDATE orders SET status='EXPIRED' WHERE status='RESERVED' AND expires_at < now() RETURNING reservation_id`, then `INCR stock` per row and clears `soldOut` if stock was 0.
**Why:** expect ~20% unpaid, so ~2,000 phones return around 12:10 for a second wave.
**Example:** a DB row with `expires_at` is reliable; Redis key-expiry events are fire-and-forget and can be lost.

## User pays at 12:09:59.9 while the sweeper runs at 12:10:00. Who wins? {#hld12-expiry-race}
Both use a conditional update on `status='RESERVED'`. Postgres serializes them: the first wins and the other updates 0 rows.
**Why:** no phone is both sold and returned. If the sweeper wins, payment sees 0 rows and declines or refunds.
**Trap:** a naive expiry without `WHERE status='RESERVED'` races with payment.

## What if the sale grows to 100K phones and one Redis key is hot? {#hld12-hot-key}
Split stock into N buckets (`stock:{s42}:0..9`, 10,000 each) on different nodes, and route users by `hash(userId) % N`, with a "try another bucket" when yours is empty. Not needed for 10K.
**Why:** one Redis key is one node, ~100K ops/s max. Keys use a hash tag `{s42}` so one Lua script can touch them together.

## Give the 30-second pitch for the flash sale. {#hld12-pitch}
5M users for 10,000 phones, so reject 99.8% cheaply. CDN serves the page and a status file; a waiting room gives signed tickets with a random number (fair lottery) and an admitter lets ~10K users/s through.
**Why:** one Lua script on Redis does atomic check-and-decrement (100K ops/s vs 200/s for a DB row). Winners go via Kafka to Postgres, a sweeper returns unpaid stock, and sold out is a flag on the CDN. After a Redis failover, rebuild from Postgres.
