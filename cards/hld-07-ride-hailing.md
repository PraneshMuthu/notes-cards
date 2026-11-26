---
topic: HLD 07 · Ride-hailing
group: HLD
---

## Give the 30-second pitch for an Uber/Ola design. {#hld07-pitch}
Live driver locations (250K pings/s) live in Redis GEO sharded by city. Trips live in Postgres with a conditional-UPDATE state machine. Matching pulls from Kafka, finds nearby drivers, offers to one at a time (10 s), and claims each with `SET NX EX 15`.
**Why:** location is the dominant load; trips are low volume but need correctness. The accept is one transaction guarding against double assignment.

## What is the dominant load in ride-hailing and how do you derive it? {#hld07-ping-math}
Location pings: 1M online drivers ÷ 1 ping per 4 s = 250K writes/s. Rides: 10M/day ÷ 86,400 ≈ 116/s, × 3 ≈ 350/s peak. That is ~700× the ride rate.
**Why:** the data is only ~100 MB (1M × 100 B) but 250K ops/s, so you shard Redis for throughput, not capacity.
**Trap:** sizing for 116 rides/s and missing the real driver.

## Why not keep driver lat/lng in Postgres? {#hld07-why-not-sql}
Two problems. A B-tree on lat returns a thin strip across the country, then filters by lng row by row. And 250K updates/s vs ~10-20K writes/s per node means 15-25 primaries to store data that is stale in 4 s.
**Why:** PostGIS fixes the query, not the write rate. Data this short-lived belongs in memory.

## What is a geohash and how does nearby search use it? {#hld07-geohash}
A geohash turns lat/lng into a string where a longer shared prefix means closer places. Split the world in half repeatedly (alternating longitude and latitude), 5 bits per base-32 character.
**Why:** "nearby" becomes a prefix match, a fast range scan on a sorted list. 5 chars ≈ 4.9 km cell, 6 chars ≈ 1.2 × 0.6 km, 7 chars ≈ 153 m.
**Example:** like Indian PIN codes: `560xxx` is Bengaluru, `56xxxx` is Karnataka.

## Two drivers 50 m apart share no geohash prefix. How do you still find them? {#hld07-geohash-edge}
Search the rider's cell plus its 8 neighbours (3×3 block), then filter by exact distance.
**Why:** pick a cell at least as big as the search radius so the block contains the whole circle. For 2 km use 5-char cells (4.9 km); 6-char cells would make the block only ~3.6 × 1.8 km and miss drivers.
**Example:** 500 m in a dense area can use 6 chars.

## How does Redis GEO do the nearby search? {#hld07-redis-geo}
`GEOADD` stores a driver in a sorted set (members ordered by a numeric score) whose score is a 52-bit geohash. `GEOSEARCH key FROMLONLAT lng lat BYRADIUS 2 km ASC COUNT 20` does the neighbour-cell scan and distance filter.
**Why:** GEOADD is O(log N), and GEOSEARCH only scans the 3×3 block (hundreds of drivers), not the whole city.

## Geohash or quadtree for moving drivers? {#hld07-quadtree}
Geohash. Cells are fixed, so an update is "delete old score, insert new score".
**Why:** a quadtree splits dense areas into smaller squares but is costly to rebalance under 250K moves/s.

## How many Redis shards for location, and what are the commands per ping? {#hld07-redis-shards}
2 commands per ping (GEOADD position + ZADD lastseen): 250K × 2 = 500K ops/s ÷ ~50K ops/s per shard (comfortable; tops out near 100K) ≈ 10 shards (+ replicas).
**Why:** shard key is `city`, so a nearby search hits one shard. Big cities get their own shard; the biggest (~150K drivers → 75K ops/s) is tight, so use adaptive pings or split by 4-char geohash prefix.

## How do you cut the ping load, and evict drivers whose phone died? {#hld07-adaptive-sweeper}
Adaptive pings: parked or offline drivers ping every 15-30 s. If 40% are parked: 0.6 × 250K + 0.4 × (1M ÷ 20 s) ≈ 170K/s (−32%).
**Why:** a GEO member can't have its own TTL, so a `lastseen:{city}` sorted set (driver to last-ping time) is swept every ~10 s (`ZRANGEBYSCORE` older than 30 s, then `ZREM` from both). The matcher also skips anyone silent for 30 s.

## Why Postgres for trips, not Cassandra, and what goes wrong with a hand-built saga? {#hld07-postgres-trips}
Accept needs an atomic conditional update of two rows (driver → ON_TRIP, trip → MATCHED). Postgres does it in one `BEGIN … COMMIT`; trips are only ~1,750 writes/s and ~3.6 TB/year.
**Why:** Cassandra's conditional writes cover one partition, so a two-row change becomes a saga (step 1, step 2, undo code). Other requests can see a half-done state (driver ON_TRIP on an unmatched trip), and a crash between steps leaves data stuck until a sweeper repairs it.
**Trap:** the real reason is atomicity, not joins; use a saga only when scale forces it.

## How do you stop one driver being assigned to two rides? {#hld07-double-assign}
Before offering, `SET lock:driver:D42 trip_A NX EX 15`. NX = only set if absent, so exactly one worker wins; the loser moves to the next driver. 15 s = 10 s accept window + ~5 s slack.
**Why:** Redis runs commands one at a time, and if a worker crashes the lock simply expires (no TTL would strand the driver forever).
**Trap:** the Redis lock alone is not enough; the DB is the final guard (next card).

## A driver accepts at second 16, after the lock expired and another trip locked him. What stops a double match? {#hld07-conditional-update}
The accept is one transaction: `UPDATE drivers SET status='ON_TRIP' … WHERE status='AVAILABLE'` and `UPDATE trips SET status='MATCHED' … WHERE status='REQUESTED'`. If either changes 0 rows, rollback and reply 409 "offer expired".
**Why:** the lock prevents most collisions cheaply; the conditional UPDATE makes the leftover case safe. The same check blocks a match on a trip the rider cancelled.

## What is the trip state machine and how are transitions made safe? {#hld07-state-machine}
REQUESTED → MATCHED → DRIVER_ARRIVED → IN_TRIP → COMPLETED, with CANCELLED from the early states. Every transition is `UPDATE trips SET status=:new WHERE trip_id=:id AND status=:expected`.
**Why:** if 0 rows change, the move was illegal or a racing update won.

## Why offer to one driver at a time, not broadcast to several? {#hld07-sequential-offers}
Sequential offers avoid drivers wasting taps. Worst case 5 drivers × 10 s = 50 s, inside the "under a minute" target.
**Why:** broadcasting works too (the conditional trip update picks the first acceptor) but annoys drivers who get "ride taken".

## The matching worker dies mid-offer loop. What happens? {#hld07-worker-dies}
The worker commits its Kafka offset (the bookmark of how far a consumer has read) only once the trip reaches MATCHED or NO_DRIVERS. Another worker takes the message, reads the trip from Postgres, and restarts the loop if it is still REQUESTED.
**Why:** the old worker's locks expire within 15 s.

## A stadium match ends: 5,000 riders, 2,000 drivers in one cell. What breaks? {#hld07-hotspot}
Not QPS: 5,000 requests over ~10 min ≈ 8/s, and 2,000 drivers ÷ 4 s = 500 writes/s. The pain is supply vs demand.
**Why:** fix with surge pricing per geohash-6 cell (open requests ÷ available drivers, refreshed ~1 min). Airports use a FIFO driver queue (Redis list) because everyone is equally near. A hot city shard splits by geohash-4 prefix.

## A Redis geo shard dies. Is that a problem? {#hld07-redis-dies}
Promote the replica. Even with total loss the data rebuilds: every driver pings again within 4 s.
**Why:** it is the one store we can afford to lose, since it holds only ephemeral positions.

## Common ride-hailing design mistakes? {#hld07-traps}
- sizing for rides instead of pings
- live locations in the SQL trips DB
- forgetting the 8 neighbour cells
- a lock without a TTL, or relying on the lock without the DB conditional update
- no way to evict dead drivers (GEO members don't expire)
- over-building (quadtrees, ML dispatch)
**Why:** each is the first follow-up an interviewer asks.

## How do ride offers reach the driver's phone? {#hld07-offer-channel}
Over the WebSocket (a connection that stays open so the server can push) the driver app already holds for pings, with FCM/APNs mobile push as the fallback.
**Why:** polling for offers from 1M drivers would cost ~250K+ useless requests/s.

## The Postgres primary dies. What happens? {#hld07-pg-failover}
A synchronous replica (every commit copied before OK) is promoted by Patroni or Aurora in ~30 s. Ride requests queue in Kafka meanwhile.
**Why:** location ingest is unaffected because it never touches Postgres.

## 10× drivers (10M online). What changes? {#hld07-10x}
2.5M writes/s. Split per-city keys by geohash-4 region, giving ~50 Redis shards, and use adaptive ping rates.
**Why:** the Location Service is stateless, so it just scales horizontally.
