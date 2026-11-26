---
topic: HLD · Building Blocks
group: HLD
---

## Day-to-second estimation: how do you turn "X per day" into "per second" in your head? {#hldbb-estimation}
Divide by 10^5 (a day is 86,400 s ≈ 10^5), then multiply by 2–3 for peak.
**Why:** every HLD estimate starts here, so doing it in one step leaves time for the numbers that decide the design (ratios, fan-out, storage).
**Example:** 1M/day ≈ 12/s; 100M/day ≈ 1,200/s; 500M notifications/day ≈ 5,000/s average, ~15K/s peak.

## Cache servers go from 5 to 6 and `hash(key) % N` moves most keys. What placement scheme moves only a few? {#hldbb-consistent-hashing}
Consistent hashing: put keys and servers on a hash ring; a key belongs to the next server clockwise. Adding a node remaps only one arc.
**Why:** with `% N`, a key stays put only if `h % 5 == h % 6`, which is 1 in 6 keys, so ~83% move and the origin DB takes a miss storm. On a ring, only the new node's arc (~1/6 of keys) moves.
**Example:** seats around a round table: a new guest sits between two people and takes only part of one neighbour's plate.

## Consistent hashing with one ring point per server gives lumpy load. What fixes it? {#hldbb-virtual-nodes}
Virtual nodes: each physical server takes many points (say 100–200) on the ring, so its share is many small arcs instead of one big one.
**Why:** with few random points, arc lengths vary wildly, so one server can own 3× another's keys. Many small arcs average out. A bigger machine can take more points.
**Example:** dealing a deck one card at a time gives everyone a fair hand; cutting it into 3 random chunks does not.

## Redis Cluster does not use a hash ring. How does it place keys on nodes? {#hldbb-hash-slots}
Fixed hash slots: slot = CRC16(key) mod 16,384, and each node owns a range of slots. Adding a node migrates whole slots to it.
**Why:** a fixed slot → node table is small, explicit and cacheable by clients, so moving load is an admin action on named slots, not a re-hash. Same effect as a ring: only the moved slots' keys move.
**Example:** a library with 16,384 numbered shelves split among 3 librarians; a 4th librarian takes over some shelves, and every book stays on its shelf.

## Redis Cluster: what does a hash tag like `{acme}` in a key do, and when does it hurt? {#hldbb-hash-tag}
Only the part inside `{}` is hashed, so `rl:{acme}:1` and `rl:{acme}:2` land in the same slot (one of 16,384 key buckets) and so on the same node.
**Why:** a Lua script or multi-key command may touch only one slot, so a hash tag makes related keys usable together. The cost: it defeats spreading, so never use it on keys you split to spread a hot key.
**Example:** writing the same pincode on several parcels sends them all to one post office.

## How do you pick a partition key? {#hldbb-partition-key}
Partition on the field every request carries and looks up by, and make it high-cardinality (many distinct values).
**Why:** the router must compute the partition from the request, or it asks all partitions. A field with few values caps how many partitions hold data: a true/false field fills at most 2 machines, however many you buy.
**Example:** a redirect `GET /abc1234` carries only the code, so the URL shortener partitions on `code`.

## One partition is overloaded while the others idle. What are the two causes, and does adding nodes help? {#hldbb-hot-partition}
Hot by data (one partition holds far more rows) or hot by traffic (rows spread fine, but requests pile on one key). Adding nodes helps neither.
**Why:** the hot key still hashes to one node; more nodes only shrink the idle ones' share. Sharding fixes volume, never skew. Fix skew with a cache, replicas of the hot key, or splitting the key.
**Example:** 10 supermarket counters assigned by surname initial: S has a 100-person queue, Z has nobody. An 11th counter changes nothing.

## The request does not carry the partition key. What happens, and what does it cost? {#hldbb-scatter-gather}
Scatter-gather: you query every partition and merge the replies.
**Why:** it multiplies load, you wait for the slowest of N replies (tail latency), and adding partitions makes both worse.
**Example:** 10 filing cabinets sorted by phone number, but the customer gives a name: you open all 10. At 6k QPS that is 60k internal queries/s.

## Leader-follower replication: what does it buy, and what bug does replication lag cause? {#hldbb-replication}
Writes go to one leader that streams them to followers. You gain read scaling, failover and durability; lag means a follower can return stale data, even to the person who just wrote.
**Why:** followers copy asynchronously, because making every write wait for the slowest replica would make writes slow and fragile.
**Example:** you post a comment, refresh, and it is gone: the read hit a replica 2 s behind.

## When do you choose multi-leader or leaderless replication over leader-follower? {#hldbb-replication-modes}
Multi-leader when writes must be accepted in several regions or on offline devices. Leaderless (Dynamo, Cassandra) when no single node may block a write; quorums give consistency.
**Why:** both give up one place that orders all writes, so concurrent writes to the same key conflict and need resolving (last-write-wins, merge, version vectors).
**Example:** two people edit the same shared doc offline; when both reconnect, someone has to merge.

## Users read from async replicas. How do you make sure a user always sees their own latest write? {#hldbb-read-your-writes}
Read-your-writes: send that user's reads to the leader (or write into their own view synchronously) for a short window after they write.
**Why:** strong consistency for everyone is expensive, but users mostly notice when their own action seems lost. Others can lag a few seconds.
**Example:** a just-created short link must redirect at once, so redirects never read the async replica.

## Leaderless store with N replicas: what does W + R > N guarantee? {#hldbb-quorum}
Any R replicas you read overlap any W replicas that acked the write in at least one node, so the read can see the latest acknowledged write.
**Why:** W and R trade write latency and availability against read latency: W=N, R=1 gives fast reads and fragile writes; W=1, R=N the reverse.
**Example:** N=3, W=2, R=2: write lands on {A,B}, read asks {B,C}; B has the new value.
**Trap:** sloppy quorums (writes parked on stand-in nodes) break the overlap, and overlap alone is not linearizable.

## You must answer "have I seen this before?" for billions of items in little memory. What structure? {#hldbb-bloom}
A Bloom filter: a bit array plus k hashes. "No" is always right; "maybe yes" is sometimes wrong, at a tunable rate.
**Why:** it answers in a few bits per item before you pay for a disk or network lookup; a false positive costs one wasted lookup, never a missed item.
**Example:** an LSM store checks each file's Bloom filter and skips files that certainly lack the key.
**Trap:** a standard Bloom filter cannot delete; for "seen in the last 7 days", keep one filter per day and check them all.

## Huge, append-mostly data, always read by a known key: which kind of store, and when not to use it? {#hldbb-wide-column}
A wide-column store (Cassandra): the partition key picks the node and the clustering key keeps rows sorted inside it. Avoid it when data fits one Postgres or you need joins or ad-hoc queries.
**Why:** it scales writes by adding nodes, but gives up joins and arbitrary WHERE clauses, so you design one table per query.
**Example:** chat messages partitioned by `chat_id`, sorted by `message_id`: "last 50 in this chat" is one partition slice.
**Trap:** node count is usually set by disk (~1–2 TB per node), not by write throughput.

## Write-heavy vs read-heavy with range scans: LSM tree or B-tree? {#hldbb-lsm-btree}
LSM tree (append to a log and memory, flush sorted files; Cassandra) for write-heavy; B-tree (Postgres) for read-heavy and range scans.
**Why:** LSM turns writes into sequential appends, but a read may check several files, and compaction (background merging) spikes latency. A B-tree reads in a few seeks but updates in place.
**Example:** sensor readings or chat messages → LSM; an orders table queried by date range → B-tree.

## Cache-aside vs read-through: who talks to the DB on a miss? {#hldbb-cache-read}
Cache-aside: the app checks the cache, then reads the DB and fills the cache. Read-through: the cache itself fetches from the DB.
**Why cache-aside is the default:** only requested data is cached, and if the cache dies the app falls back to the DB. Read-through puts the cache on the critical path.
**Example:** you walk to the store room yourself, or the kitchen porter fetches it for you.

## Write-around, write-through, write-back: when does each write reach the DB? {#hldbb-cache-write}
Write-around: DB only; the cache fills on the first read. Write-through: cache and DB together. Write-back: cache now, DB later.
**Why:** each moves a cost: around pays one slow first read, through pays two writes and may cache unread data, back is fastest but loses data if the cache dies before flushing.
**Example:** a shop updates only its ledger (around), the ledger and the shelf label together (through), or a sticky note copied to the ledger at closing (back).
**Trap:** never write-back data you cannot afford to lose.

## In one system most new items are rarely read soon; in another every new item is instantly the hottest. Which cache write strategy for each? {#hldbb-cache-choose}
Rarely read soon → write-around. Instantly hot → write-through.
**Why:** write-through pays off only when the cached copy is read before it is evicted; otherwise it wastes cache space and adds a second write. Write-around costs one miss per item, which is cheap when few items are read.
**Example:** URL shortener: most new links are clicked rarely (write-around). News feed post cache: a new post is read by thousands at once (write-through).

## Eviction vs invalidation: what is the difference? {#hldbb-eviction}
Eviction: the cache is full, so which entry to drop (LRU, LFU, TTL). Invalidation: the source data changed, so how the cache learns (TTL, delete-on-write, write-through).
**Why:** they solve different problems, space and staleness. Data that never changes needs eviction but no invalidation and no TTL.
**Example:** a fridge: you throw out the oldest jar when it is full (eviction); you throw out the milk when you learn it went off (invalidation).

## A hot cache key expires and the DB suddenly sees thousands of identical queries. What happened, and what is the main fix? {#hldbb-stampede}
A cache stampede: every concurrent request missed and went to the DB at once. Fix: single-flight, where one request refills the key while the others wait for its result.
**Why:** the DB is sized for the miss rate, not the full request rate; one refill instead of thousands keeps it there.
**Example:** a shop runs out of milk; one staff member goes to the storeroom while the queue waits, instead of every customer going.
**Trap:** a cold start (empty cache after a deploy) is the same flood for every key; warm the cache first.

## Many keys were cached at the same moment with the same TTL. What goes wrong, and what is the fix? {#hldbb-stampede-jitter}
They all expire together and miss together. Fix: jitter the TTL (add a random ±10%) or refresh popular keys early, before they expire.
**Why:** randomising expiry spreads refills over time, so the DB sees a trickle instead of a spike.
**Example:** a 60-minute TTL set during a deploy becomes 54–66 minutes, so the expiries spread over 12 minutes.

## Cache hit rate goes from 90% to 99%. What happens to DB load and to average latency? {#hldbb-hit-rate}
DB load drops 10× (misses fall from 10% to 1%), and average latency drops about 4× (5.9 ms to 1.5 ms with a 1 ms hit and a 50 ms miss).
**Why:** a miss costs 50× a hit, so misses dominate both numbers; each extra "9" of hit rate removes most of what is left.
**Example:** 0.9 × 1 + 0.1 × 50 = 5.9 ms; 0.99 × 1 + 0.01 × 50 = 1.5 ms.

## Where do video files go versus their metadata, and how do far-away users get them fast? {#hldbb-cdn}
Bytes go in a blob store (S3: cheap, durable, not a database); metadata goes in a DB; a CDN (edge caches near users) serves the bytes.
**Why:** big immutable files would bloat and slow the primary DB, and serving them from one region adds cross-world latency to every view.
**Example:** a video's title and owner live in Postgres, its file in S3, and a viewer in Chennai streams it from a Chennai edge server.

## What three jobs does a message queue do between services? {#hldbb-queue}
It decouples producer from consumer, absorbs bursts, and isolates failures so a slow consumer does not break the producer.
**Why:** the producer only needs the queue to accept the message; consumers drain at their own pace and retry on their own.
**Example:** a restaurant's order rail: waiters pin orders and walk away, cooks take them as they can, and a lunch rush just lengthens the rail.
**Trap:** justify a queue with a number (work too big to finish inside a request), not as a default.

## Why do queues deliver at-least-once rather than exactly-once, and what must the consumer do? {#hldbb-at-least-once}
The consumer acks after processing, so a crash between processing and the ack causes redelivery. The consumer must be idempotent (handling a message twice = handling it once).
**Why:** acking before processing loses messages on a crash. Duplicates are fixable, lost messages are not, so "exactly-once" in practice means at-least-once plus dedup by message ID.
**Example:** a worker sends an email, crashes before acking, and gets the message again; it checks "email for event 8812 already sent?" and skips.

## What is an idempotency key, and who chooses it? {#hldbb-idempotency-key}
A unique ID for one real-world intent, sent with the request. The server stores "key → result" and returns the stored result on a retry instead of acting again. The caller picks it per intent, not per attempt.
**Why:** on a timeout you cannot tell "request lost" from "response lost", so clients must retry, and retries must be safe.
**Example:** pressing "Pay" twice in a UPI app with the same transaction reference charges you once.

## Pub/sub vs a work queue: what is the difference? {#hldbb-pubsub}
Work queue: each message goes to one of many workers, to share the load. Pub/sub: each message goes to every subscribing service, so each can react.
**Why:** choose by asking "should this event be handled once, or once per interested service?" Kafka does both: every consumer group gets every message, and inside a group the partitions are split among workers.
**Example:** "order shipped" reaches both the email service and analytics (pub/sub); inside email, 40 workers split those messages (queue).

## Feed fanout: what decides push (fanout-on-write) vs pull (fanout-on-read)? {#hldbb-fanout}
The read:write ratio. Push does N writes at post time and makes each read one lookup, so it wins when reads dominate; pull writes once and merges M sources on every read.
**Why:** push pays once and spreads the cost over many reads. A celebrity (huge N) breaks push; following thousands of accounts under a tight latency budget breaks pull.
**Example:** a school notice: photocopy it into 500 lockers (push) or pin one copy on the noticeboard (pull).

## When does a feature need WebSockets instead of plain HTTP requests? {#hldbb-websockets}
When the server must push to the client without being asked: chat, presence, live location, live scores.
**Why:** the client cannot know when data arrives, so polling either wastes requests or adds delay. The cost is a held connection per user, so you need a connection tier and a map of which server holds each user's socket.
**Example:** a cricket app polling every 5 s makes 12 requests a minute per user for maybe one change; a socket delivers the boundary the moment it happens.

## L4 vs L7 load balancer: when does each win? {#hldbb-lb}
L7 (reads HTTP: path, headers, cookies) is the default for HTTP APIs; L4 (sees only IP and port, forwards bytes) wins for raw TCP or millions of long-lived connections.
**Why:** L7 can route by path, terminate TLS, check auth and rate-limit, at more CPU per request; L4 does almost no work per byte, so it is cheaper at huge connection counts.
**Example:** L4 is a guard who only checks which door you used; L7 is a receptionist who reads your letter.
**Trap:** both pin a WebSocket to one server for its lifetime; L4 is chosen for cost, not because L7 cannot hold sockets.

## What is a geohash, and why does it turn "near me" into a prefix lookup? {#hldbb-geo}
Repeatedly halve the map (alternating longitude and latitude), record each half as a bit, and encode the bits as a short string. Points in the same box share its prefix.
**Why:** a 2-D search becomes a 1-D sorted-key range scan, which ordinary indexes and Redis sorted sets handle.
**Example:** 5 characters ≈ a 5 km × 5 km box; 6 characters ≈ 1.2 km × 0.6 km.

## A driver 50 m away is missed by your geohash search. Why, and what is the fix? {#hldbb-geo-neighbours}
They sit across a cell boundary, so their prefix differs. Search your cell plus its 8 neighbours, with cells at least as big as the radius, then filter by exact distance.
**Why:** a shared prefix implies closeness, but closeness does not imply a shared prefix. Redis `GEOSEARCH` does this neighbour scan for you.
**Example:** two houses facing each other across a street that is a pincode border have different pincodes.

## Geohash or quadtree: when does each win? {#hldbb-geo-quadtree}
Geohash for fast-moving points (fixed cells, so a move is a cheap delete + insert). Quadtree (splits a cell into 4 when it holds over K points) for mostly static points of uneven density.
**Why:** a quadtree adapts cell size to density but must rebalance as points move; a geohash never rebalances.
**Example:** driver locations updating every few seconds → geohash; restaurants on a map → quadtree.

## How do you take and release a distributed lock in Redis? {#hldbb-lock}
Acquire with `SET lock:nightly-report <my-uuid> NX EX 10` (NX: only if absent; EX: auto-expire). Release by deleting only if the value is still my UUID, atomically in one Lua script.
**Why:** NX makes acquire atomic and EX stops a crashed holder blocking forever. Without the owner check, a slow holder whose lock already expired deletes the next holder's lock.
**Example:** release script: `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`.

## Your Redis lock's TTL expires while the holder is paused (GC, slow call). What goes wrong, and what fixes it? {#hldbb-lock-fencing}
Two clients both think they hold the lock. Fix: a fencing token, a number that increases on every acquire; storage rejects writes carrying a lower token than one it has seen.
**Why:** a TTL lock is a hint, not a guarantee, so the final check must live in the system being written (or be a conditional update such as `... WHERE status='HELD' AND held_by=:me`).
**Example:** A gets token 33 and freezes. The lock expires; B gets 34 and writes. A wakes and writes with 33: rejected.

## Two servers both check "is this code free?", both see yes, both insert. What is the bug, and the fix? {#hldbb-toctou}
TOCTOU (time-of-check to time-of-use): the world changed between the check and the act. Fix: skip the check, attempt the write, and let an atomic constraint reject the loser.
**Why:** only the database sees both writes in order, so only it can arbitrate; any check made outside it is stale by the time you act.
**Example:** inventory: `UPDATE stock SET qty = qty - 1 WHERE id = 7 AND qty > 0` instead of reading qty, then writing qty - 1.

## Many servers need unique, roughly time-sorted 64-bit IDs without a central counter. What layout? {#hldbb-id-gen}
Snowflake: 41-bit millisecond timestamp | 10-bit machine ID | 12-bit per-millisecond sequence.
**Why:** the machine ID makes IDs unique without coordination, and the timestamp in the top bits makes them sort by time, so ordering and cursor pagination come free.
**Example:** a chat sorts messages by ID alone, and "older than ID X" is the page cursor.
**Trap:** if a machine's clock moves backwards it can repeat IDs, so it must wait or refuse until the clock catches up.

## A dependency is failing or very slow. What stops every request from waiting out the full timeout? {#hldbb-circuit-breaker}
A circuit breaker: Closed (calls flow, failures counted) → Open (past a failure threshold: fail fast or use a fallback) → Half-open (after a cool-off, a few test calls; success closes it, failure re-opens it).
**Why:** a slow dependency is worse than a dead one, because every caller holds a thread for the full timeout; failing fast frees them and gives the dependency room to recover.
**Example:** your home's MCB trips on a fault; you flip it back to test, and it trips again if the fault is still there.

## Monolith or microservices for a new system? {#hldbb-monolith}
Start with a monolith (or modular monolith). Split out a service only for a named pressure: very different scaling, team autonomy, a different datastore, or fault isolation.
**Why:** every in-process call becomes a network hop (~0.5 ms, can fail), and a write across two services becomes a distributed transaction.
**Example:** split out image resizing because it needs 50× the CPU of the rest, not "because microservices scale".

## During a network partition, what does CAP force you to choose, and at what level? {#hldbb-cap}
Consistency (refuse rather than risk a stale answer) or Availability (answer, maybe stale), chosen per operation, not per system.
**Why:** a cut-off node cannot confirm it has the latest data, so it must either wait or guess.
**Example:** an ATM that cannot reach the bank refuses withdrawals (CP), or allows up to ₹5,000 offline (AP).

## CAP only covers partitions. What does PACELC add? {#hldbb-pacelc}
Else (no partition), you still trade Latency against Consistency.
**Why:** a strongly consistent read or write must wait for replicas to agree on every request, even on a healthy network; partitions are rare, but this cost is paid always.
**Example:** Cassandra at consistency ONE answers from the nearest replica (fast, maybe stale); at QUORUM it waits for a majority (slower, current).
