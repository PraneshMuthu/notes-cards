---
topic: HLD 07 · Ride-hailing
group: HLD
---

## Ride-hailing (Uber/Ola): give the 30-second pitch in 4 beats. {#hld07-pitch}
1. Scale: 1M drivers pinging every 4 s = 250K writes/s, ~700× the ride rate. 2. Store: live positions in Redis GEO sharded by city; trips in Postgres. 3. Correctness: claim a driver with `SET NX EX 15`, accept with one conditional-UPDATE transaction. 4. Failure: Redis positions rebuild from the next pings; ride requests wait in Kafka.
**Why:** location is the dominant load but disposable; trips are low volume but must never double-assign. The pitch is that split.
**Example:** a taxi stand's whiteboard of positions (wiped constantly) next to the bound ledger of fares (written carefully, never wrong).
Grade Got it only if you said all 4 beats.

## Ride-hailing: 1M online drivers ping every 4 s, and there are 10M rides a day. Derive both write rates. Which one drives the design? {#hld07-ping-math}
Pings: 1M ÷ 4 s = 250K writes/s. Rides: 10M ÷ 86,400 ≈ 116/s, × 3 for peak ≈ 350/s. Pings are ~700× larger, so they drive the design.
**Why:** the ping rate picks the store (in-memory Redis) and the shard count. The data itself is tiny (1M × 100 B = 100 MB), so you shard for throughput, not capacity.
**Example:** sizing a toll plaza for the trucks that stop to pay, when the problem is the thousands of cars passing every second.
**Trap:** quoting 116 rides/s as "the load" is the classic ride-hailing mistake.

## Ride-hailing: why not store drivers' live lat/lng in the Postgres trips DB? {#hld07-why-not-sql}
It can't take the writes: 250K updates/s against ~10–20K writes/s per Postgres node means 15–25 primaries, for data that is stale in 4 s anyway.
**Why:** every Postgres update rewrites a row and its index entries on disk. A position replaced every 4 s gains nothing from disk durability, so it belongs in memory.
**Example:** 250K ÷ 15K per node ≈ 17 primaries just to hold numbers nobody reads after 4 s.
**Trap:** PostGIS (Postgres's spatial-index add-on) fixes query speed, not the write rate.

## Ride-hailing: why can't a normal B-tree index on (lat, lng) answer "drivers within 2 km"? {#hld07-latlng-index}
A B-tree narrows on its first column only. `lat BETWEEN …` returns a thin strip across the whole country, which the DB then filters by lng row by row.
**Why:** a B-tree (sorted index) orders rows by one value, but "near" needs two dimensions at once. A geohash folds both into one sortable value.
**Example:** a rider at 12.97°N in Bengaluru first pulls every driver at that latitude from Mangaluru to Chennai, then the lng filter throws most away.

## Ride-hailing: you search a 2 km pickup radius with geohash cells. Use 5-char cells (4.9 km) or 6-char (1.2 × 0.6 km)? {#hld07-geohash-edge}
5-char. The cell must be at least as big as the radius, so the 3×3 block (the rider's cell plus its 8 neighbours) always contains the whole 2 km circle.
**Why:** a geohash (lat/lng as a string; shared prefix = close) splits the map into cells, and a driver 50 m away can sit across a cell edge, so you always scan the neighbours. If cells are smaller than the radius, even the neighbours don't reach 2 km.
**Example:** a 6-char 3×3 block is 3.6 × 1.8 km, so a driver 1.5 km north is missed. A 5-char block is 14.7 × 14.7 km; then filter by exact distance.

## Ride-hailing: which two Redis commands store a driver's position and find the 20 nearest within 2 km? {#hld07-redis-geo}
`GEOADD geo:drivers:blr 77.59 12.97 D42` and `GEOSEARCH geo:drivers:blr FROMLONLAT 77.59 12.97 BYRADIUS 2 km ASC COUNT 20`.
**Why:** Redis GEO is a sorted set (members ordered by a number) whose score is a 52-bit geohash, so GEOADD is O(log N) and GEOSEARCH scans only the cells around the point, then filters by exact distance.
**Example:** of Bengaluru's 150K drivers, the cells around Koramangala hold a few hundred, so the search touches hundreds of entries, not 150K.

## Ride-hailing: geohash or quadtree for 1M drivers who move every 4 s? {#hld07-quadtree}
Geohash. Cells are fixed, so a move just changes one sorted-set score (an O(log N) remove and insert). A quadtree must split and merge squares as drivers move.
**Why:** a quadtree (squares split into 4 when crowded) adapts to density, which suits static places, but rebalancing it under 250K moves/s is expensive.
**Example:** a driver crossing Silk Board: geohash = one `GEOADD` with a new score; quadtree = maybe split the crowded square he enters and merge the one he left.

## Ride-hailing: 250K pings/s, each doing 2 Redis commands (GEOADD + ZADD lastseen). A shard comfortably does ~50K ops/s. How many shards? {#hld07-redis-shards}
250K × 2 = 500K ops/s ÷ 50K ≈ 10 shards, each with a replica.
**Why:** the whole dataset is ~100 MB, so one node could hold it; the shard count comes from ops/s alone. Planning at ~50K leaves headroom below a shard's ~100K ceiling.
**Example:** opening 10 billing counters because of the queue length, not because the shop is short of shelf space.

## Ride-hailing: what is the shard key for the live-location GEO sets, and why? {#hld07-shard-by-city}
The city (`geo:drivers:blr`). A nearby search then hits one key on one shard, and a trip never crosses cities.
**Why:** a key that split a neighbourhood across shards would turn every nearby search into a scatter-gather (ask many shards, merge). Big cities get their own shard; small cities share one.
**Example:** a rider in Indiranagar only queries the Bengaluru shard, never Chennai's.

## Ride-hailing: Redis is sharded by city and a rider stands on the Delhi–Gurugram border. What breaks, and the fix? {#hld07-city-border}
The search reads one city's key, so it misses drivers 300 m away across the line. For riders in a precomputed border zone, query both city keys and merge by distance.
**Why:** the shard key is an admin boundary but "nearby" is geometric. Border zones are few, so the extra query is rare and cheap.
**Example:** a rider on NH-48 at the border should see a Delhi cab 300 m away, not only Gurugram cabs 3 km away.

## Ride-hailing: Bengaluru alone has 150K drivers, 75K Redis ops/s on its shard (comfortable is ~50K). What is the structural fix? {#hld07-big-city}
Split the city key into sub-region keys by 4-char geohash prefix (~39 × 20 km each) on separate shards. A search near a sub-region edge queries 2 keys and merges.
**Why:** one key lives on one shard, so the only way past one shard's limit is more keys. Adaptive pings buy time, but only splitting scales without limit.
**Example:** 150K ÷ 4 s × 2 commands = 75K ops/s; split into 3 regions ≈ 25K each.

## Ride-hailing: how do you cut the 250K pings/s by about a third without hurting matching? {#hld07-adaptive-sweeper}
Adaptive pings: moving drivers ping every 4 s, parked drivers every 15–30 s. With 40% parked at 20 s: 0.6 × 250K + 0.4 × 1M ÷ 20 ≈ 170K/s (−32%).
**Why:** a parked driver's position doesn't change, so frequent pings carry no new information.
**Example:** you text "on my way, at Hebbal" often while driving, and not at all while parked at home.

## Ride-hailing: a driver's phone dies, and Redis GEO members can't have their own TTL. How do you remove him from the map? {#hld07-dead-driver}
Keep `lastseen:{city}` (a sorted set scored by last ping time). Every ~10 s a sweeper runs `ZRANGEBYSCORE` for drivers silent over 30 s and `ZREM`s them from both sets.
**Why:** a Redis TTL (auto-expiry) works only on a whole key, and one key holds the entire city. The matcher also skips anyone silent for 30 s, so sweeper lag never causes a bad offer.
**Example:** a gym register that crosses out anyone who hasn't swiped in for 30 minutes.

## Ride-hailing: why do trips live in Postgres, not Cassandra? {#hld07-postgres-trips}
The accept must change two rows atomically (driver → ON_TRIP and trip → MATCHED), which Postgres does in one transaction. The volume is tiny: ~1,750 writes/s, ~3.6 TB/year.
**Why:** Cassandra's conditional writes (LWT, lightweight transactions) cover one partition only, so a two-row change would need a hand-built saga. The reason is atomicity, not joins.
**Example:** 350 rides/s × ~5 state changes per trip ≈ 1,750 writes/s, well within one Postgres primary (~10–20K/s).

## Ride-hailing: what goes wrong if you build the driver + trip accept as a hand-made saga instead of one transaction? {#hld07-saga-risk}
Others can see a half-done state (driver ON_TRIP while the trip is still unmatched), and a crash between the steps leaves it stuck until a repair job notices.
**Why:** a saga (a chain of steps, each with an undo step) has no isolation, so the gap between steps is visible. Use one only when scale forces you across partitions.
**Example:** a bank transfer done as "withdraw today, deposit tomorrow". If the clerk goes home in between, the money is nowhere.

## Ride-hailing: two matching workers both pick driver D42 for different riders. What does each do before sending an offer, and why a 15 s TTL? {#hld07-double-assign}
`SET lock:driver:D42 trip_A NX EX 15`: only one worker wins, the loser moves to the next driver. 15 s = the 10 s accept window + ~5 s slack.
**Why:** the value is the trip id, so the accept can check the lock is still ours. The TTL (auto-expiry) means a crashed worker frees D42 within 15 s with no cleanup.
**Example:** a library book with a due date: if the borrower vanishes, the book is back on the shelf when the loan runs out.
**Trap:** the lock alone isn't enough; the accept transaction is the final guard.

## Ride-hailing: driver D42 taps accept at second 16, after his lock expired and another trip locked him. What stops a double match? {#hld07-conditional-update}
The accept is one transaction of two conditional updates: driver to ON_TRIP `WHERE status='AVAILABLE'`, trip to MATCHED `WHERE status='REQUESTED'`. If either changes 0 rows, ROLLBACK and reply 409 "offer expired".
**Why:** the Redis lock stops almost every collision cheaply, but it can expire. The DB row's status is the one check no timing can slip past.
**Example:** trip B set D42 to ON_TRIP at second 14, so trip A's `WHERE status='AVAILABLE'` matches 0 rows and A's rider gets the next driver.

## Ride-hailing: the rider cancels in the same second a driver taps accept. What makes exactly one of them win? {#hld07-state-machine}
Every trip transition is `UPDATE trips SET status=:new WHERE trip_id=:id AND status=:expected`. Whichever commits first wins; the other matches 0 rows and is rejected.
**Why:** the states (REQUESTED → MATCHED → DRIVER_ARRIVED → IN_TRIP → COMPLETED, CANCELLED from the early ones) are enforced by the WHERE clause, so an illegal or late move changes nothing.
**Example:** cancel commits REQUESTED → CANCELLED first, so the accept's `WHERE status='REQUESTED'` updates 0 rows and the driver sees "rider cancelled".

## Ride-hailing: offer a ride to one driver at a time, or broadcast to 3 at once? Pick one and give the worst-case wait. {#hld07-sequential-offers}
One at a time with a 10 s timeout. Worst case 5 drivers × 10 s = 50 s, inside the "match in under a minute" target.
**Why:** broadcast is also correct (the conditional trip update picks the first acceptor), but the other drivers tap for nothing and see "ride taken". You trade a little speed for driver goodwill.
**Example:** calling plumbers one by one, versus posting in a WhatsApp group where three show up and two leave annoyed.

## Ride-hailing: a matching worker crashes halfway through a trip's offer loop. How does the ride still get matched? {#hld07-worker-dies}
The worker commits its Kafka offset (its "read up to here" bookmark) only once the trip is MATCHED or NO_DRIVERS. So Kafka redelivers the request, and the new worker re-reads the trip from Postgres and restarts the loop if it is still REQUESTED.
**Why:** the true state lives in Postgres, so redoing the loop is safe; any driver lock the dead worker held expires within 15 s.
**Example:** a waiter goes off shift mid-order; the next waiter reads the order slip, sees "not served", and carries on.

## Ride-hailing: a cricket match ends; 5,000 riders and 2,000 drivers are in one cell. Is it a load problem? What is the fix? {#hld07-hotspot}
Not load: 5,000 requests over ~10 min ≈ 8/s, and 2,000 drivers ÷ 4 s = 500 writes/s. It is demand vs supply, fixed by surge pricing per 6-char geohash cell.
**Why:** surge (a price multiplier from open requests ÷ available drivers, refreshed ~1 min) cools demand and pulls drivers in from nearby cells. More servers would not add a single car.
**Example:** after an IPL match at Chinnaswamy, a 1.8× fare sends some fans to the metro and draws drivers in from Indiranagar.

## Ride-hailing: at the airport every driver is equally near the pickup. How do you choose who gets the next ride? {#hld07-airport}
A FIFO (first in, first out) driver queue per airport zone, as a Redis list: the matcher pops the driver who has waited longest instead of the nearest.
**Why:** "nearest" is meaningless when everyone is in the same parking lot, and a driver who waited 2 hours expects his turn.
**Example:** the airport taxi line: the cab at the front takes the next passenger, whoever parked closest.

## Ride-hailing: a Redis geo shard dies, replica and all. How bad is it? {#hld07-redis-dies}
Mild. Its positions rebuild themselves within ~30 s, because every driver pings again (moving ones every 4 s, parked ones every 15–30 s).
**Why:** it holds only ephemeral positions, so it is the one store we can afford to lose. Normally you just promote the replica.
**Example:** the stand's whiteboard of who-is-where gets wiped; within half a minute every driver has written his spot back.

## Ride-hailing: how do ride offers reach the driver's phone? {#hld07-offer-channel}
Over the WebSocket (a connection held open so the server can push) that the driver app already keeps for location pings, with FCM/APNs mobile push as the fallback.
**Why:** polling would cost a request per driver every few seconds, almost all answered "nothing for you".
**Example:** 1M drivers polling every 4 s = 250K useless requests/s, as large as the whole ping load.

## Ride-hailing: how stale can a driver's car on the rider's map be, and is that OK? {#hld07-map-staleness}
About 5 s: up to 4 s between pings plus ~1 s through the pipeline. That's fine, because the app animates the car smoothly between points.
**Why:** a rider only needs "roughly where, heading my way"; exactness matters only at pickup, when the driver is close anyway.
**Example:** a car at 30 km/h moves ~40 m in 5 s, less than one building's width.

## Ride-hailing: the trips Postgres primary dies. What happens to ride requests and to location updates? {#hld07-pg-failover}
A synchronous replica (holds every committed trip) is promoted in ~30 s by a failover tool such as Patroni or Aurora. Ride requests wait in Kafka meanwhile; location updates carry on untouched.
**Why:** Kafka buffers requests, so nothing is lost while there is no primary, and location ingest never touches Postgres.
**Example:** a 30 s outage at 350 rides/s queues ~10K requests in Kafka; matching drains them once the new primary is up.

## Ride-hailing at 10× (10M online drivers): give the new ping rate, the shard count, and the one structural change. {#hld07-10x}
10M ÷ 4 s = 2.5M pings/s → 5M Redis ops/s ÷ 50K ≈ 100 shards (~70 with adaptive pings). Structural change: split city keys into geohash-4 sub-regions so no key outgrows a shard.
**Why:** many cities would now exceed one shard each, and only more keys spread one city's load. The Location Service is stateless, so it just scales out.
**Example:** Bengaluru at 1.5M drivers = 750K ops/s; at ~50K per shard that is ~15 sub-region keys.
