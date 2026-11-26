---
topic: HLD · Building Blocks
group: HLD
---

## What is consistent hashing, and why not `hash(key) % N`? {#hldbb-consistent-hashing}
Place keys and servers on a hash ring; a key belongs to the next server clockwise. Adding or removing a node remaps only one arc.
**Why:** `hash(key) % N` remaps ~83% of keys going from 5 to 6 nodes (~99% at 100), causing a cache-miss storm on the origin. Even load needs virtual nodes (many ring points per physical node).
**Reach for it:** a changing pool of nodes sharing data (distributed caches, sharded DBs, Dynamo-style stores).

## How do you pick a partition key? {#hldbb-partition-key}
Partition on the field you look up by, and make it high-cardinality (many distinct values).
**Why:** a 2-value field gives at most 2 non-empty partitions however many machines you buy. If the request does not carry the key, you need scatter-gather.
**Example:** 10 supermarket counters. A bad rule ("counter by surname initial") gives S a 100-person queue and Z nobody.

## What is scatter-gather and what does it cost? {#hldbb-scatter-gather}
When you cannot compute which partition holds the answer, you query all of them and merge the replies.
**Why it is bad:** (1) amplification: 6k QPS x 10 partitions = 60k/s; (2) tail latency: you wait for the slowest of N; (3) it scales backwards: more partitions means more fan-out.
**Example:** 10 cabinets ordered by phone number, but the customer gives a name. You open all 10.

## Hot partition: by data or by traffic? {#hldbb-hot-partition}
Hot by data: one partition holds far more rows. Hot by traffic: rows spread fine but requests pile on one (a celebrity's partition). The system runs at the speed of the most overloaded node.
**Why:** sharding fixes volume, never skew. A single viral key is separate from a bad key choice; absorb it with a cache or key-splitting.

## Replication: leader-follower, multi-leader, leaderless? {#hldbb-replication}
Copy data to N nodes for durability, read scale and availability. Leader-follower sends writes to the leader and reads to followers (replication lag means stale reads). Multi-leader and leaderless (Dynamo-style, quorum) exist too.
**Why:** more replicas buy availability and read throughput but add consistency headaches (CAP).

## What does quorum W + R > N mean? {#hldbb-quorum}
With N replicas, a write needs W acks and a read needs R replies. If W + R > N, a read must overlap the latest write.
**Why:** it dials CP vs AP. W=N, R=1 is fast reads and fragile writes; W=1, R=N the opposite; W=R=ceil((N+1)/2) is balanced.
**Example:** N=3, W=2, R=2: any 2 readers overlap any 2 writers in at least one node.

## What is a Bloom filter and when do you use it? {#hldbb-bloom}
Probabilistic set membership in tiny space: no false negatives, tunable false positives.
**Why:** answers "have I seen this / might it exist?" before hitting disk or network. Used on LSM read paths, crawler dedup, and the news feed's "active recently" check.
**Example:** a false positive on "is this user active?" only wastes one write.

## What is a wide-column store (Cassandra) and when do you reach for it? {#hldbb-wide-column}
A write-optimised, horizontally endless store for huge, append-mostly data always read by a known key. The partition key picks the drawer; the clustering key keeps rows sorted inside it. No joins, no ad-hoc WHERE.
**Why:** ~10,000 writes/s/node (LSM tree: commit log + memtable + immutable SSTables). Tunable consistency per query. Do not use it when data fits one Postgres or you need joins.
**Trap:** storage, not throughput, sets node count (~1-2 TB/node).

## How do you size a Cassandra partition? {#hldbb-cassandra-partition}
Keep a partition under ~100 MB / ~100k rows. It never splits across nodes, so an oversized one means slow reads, compaction pain and a hot node more hardware cannot fix.
**Fix:** bucket the key: `PK ((entity_id, bucket), ck)`. Make `bucket_count = ceil(rows / 100k)`, stored on the entity. Fixed is wrong both ways. Same trick as rate-limiter key-splitting.

## Cache-aside vs read-through: who talks to the DB on a miss? {#hldbb-cache-read}
Cache-aside: the app checks the cache, then reads the DB and fills the cache. Read-through: the cache fetches from the DB itself.
**Why cache-aside is the default:** only requested data is cached, and cache down is not site down (the app falls back to the DB). Read-through puts the cache on the critical path.
**Example:** you walk to the store room yourself, or the kitchen porter does it for you.

## Write-around, write-through, write-back: how do they differ? {#hldbb-cache-write}
- Around: write to the DB only; the first read misses.
- Through: write cache and DB synchronously; never stale, but pays both latencies and may cache data never read.
- Back: write the cache, flush the DB later; fast, but data is lost if the cache dies first.
**Trap:** never write-back for durability-critical data.

## How do you choose a cache write strategy? {#hldbb-cache-choose}
Ask four questions. What fraction of writes are ever read (high favours write-through, low favours write-around)? Can you tolerate one slow first read? Is the data durability-critical (never write-back)? Must the site survive the cache dying (cache-aside)?
**Example:** URL shortener uses write-around (few links read soon); the news feed's post cache is write-through (a new post is instantly the hottest key).

## What is a cache stampede and how do you stop it? {#hldbb-stampede}
One hot key expires and thousands of concurrent requests all miss and hit the DB at once.
**Fixes:** single-flight lock (one refills, the rest wait), jittered TTLs, probabilistic early refresh, or never-expire plus async refresh.
**Trap:** a cold start (empty cache after a deploy) sends 100% of load to the DB. Can it survive that?

## How do you quote cache hit-rate impact? {#hldbb-hit-rate}
effective latency = hit% x cache + miss% x DB. At 90% hit: 0.9 x 1 ms + 0.1 x 50 ms = ~5.9 ms, and the DB sees 10x less load. At 99%: ~1.5 ms and 100x less.
**Why:** hit rate is the metric to quote. A cache hit is RAM (~100 ns) vs ~0.5 ms+ for a DB read: ~1,000x cheaper.

## Eviction vs invalidation: what is the difference? {#hldbb-eviction}
Eviction is what to drop when the cache is full: LRU (default), LFU (stable hot set), FIFO, TTL. Invalidation is what to do when data changes: TTL (accept staleness), delete-on-write (fresh, but every writer must remember), or write-through.
**Why:** immutable data needs neither invalidation nor a TTL (the URL shortener's links).

## CDN and blob storage: what goes where? {#hldbb-cdn}
A blob store (S3-like) holds big immutable bytes: cheap, durable, not a database. A CDN caches those bytes at edge locations near users to kill cross-region latency.
**Why:** metadata goes in a DB, bytes go in blob + CDN. Never store big blobs in the primary DB.

## Message queue: what three jobs does it do? {#hldbb-queue}
It decouples producer from consumer, absorbs bursts, and isolates failure. Delivery semantics, idempotency and a dead-letter queue (DLQ) live here.
**Why:** a queue must be justified by a number. In the news feed, a near-threshold post is 150k writes (~4 s), which cannot be held in a request.
**Trap:** at-least-once delivery means duplicates, so the consumer must be idempotent.

## Pub/sub vs fanout decision: what is the difference? {#hldbb-pubsub}
Pub/sub is the transport: one event reaches many subscribers (topics/partitions give ordering and parallelism). Push-vs-pull is the decision of when to do the work. They co-occur constantly.
**Reach for it:** notifications, feed fanout, event-driven designs.

## Feed fanout: push vs pull, and what decides it? {#hldbb-fanout}
Push (fanout-on-write): N writes at post time, 1 lookup at read. Pull (fanout-on-read): 1 write, M fetches plus a merge at read.
**Why:** the read:write ratio decides. Push amortises work over reads, so it wins when reads dominate. A single huge fan-out (the celebrity) kills push; a large fan-in under a tight budget kills pull.
**Example:** photocopy a notice into 500 lockers, or pin one on the noticeboard.

## What is push's real cost, and when is a feed "a cache"? {#hldbb-fanout-cost}
Push's real cost is N x (fraction of followers who are active), not N. A timeline for someone who never opens the app is wasted work.
**Why:** if a precomputed feed can be rebuilt from source posts, it is a cache, not a store: no durability, no backups, no replication. Ask for that permission in scoping.

## When do you need WebSockets? {#hldbb-websockets}
When the server must push to the client: chat, presence, live location, live scores. A connection-manager tier holds millions of open sockets, and routing a message means finding which server holds the recipient's socket.
**Why:** a TCP connection cannot move once open, so a socket tier needs L4 (or L7 in front, L4 for sockets) for huge counts of long-lived connections.

## How does a geo-index answer "what is near me"? {#hldbb-geo}
Geohash interleaves lat/long bits into a string; a shared prefix means spatial proximity, so neighbours are range-queried. Quadtree splits space into 4 until each cell holds at most K points, so dense cities get finer cells.
**Why:** Redis GEO is a sorted set whose score is a 52-bit geohash. TTL is per key, not per member, so stale drivers need a `lastseen` sorted set plus a sweeper.

## What is a distributed lock, and what beats a DB lock? {#hldbb-lock}
Mutual exclusion across nodes via Redis `SET key val NX EX ttl`. NX means only if absent (atomic acquire); EX auto-expires so a dead holder does not deadlock.
**Why:** it beats a pessimistic DB lock, which exhausts the connection pool under contention (10k clients vs ~1k DB connections). It is the seat-hold mechanism in BookMyShow.

## base62 vs Snowflake IDs: when do you use which? {#hldbb-id-gen}
base62 `[0-9a-zA-Z]` encodes a number into a short string (URL shortener). Snowflake is `timestamp | machine | sequence`: 64 bits, roughly time-sortable, generated locally with no coordination.
**Why:** time-sortable IDs make ordering, merging and cursor pagination free in the news feed.
**Trap:** in the URL shortener, sequential or time-ordered codes violate the "unguessable" requirement.

## L4 vs L7 load balancer? {#hldbb-lb}
L4 sees only IPs and ports, picks a server at TCP connect and passes bytes through: cheap, fast, cannot route by URL. L7 reads the HTTP request (path, headers, cookies), so it can route by path, check auth and rate-limit, at more CPU cost.
**Default:** L7 for HTTP APIs.
**Example:** L4 is a guard checking which door you used; L7 is a receptionist who reads your letter.

## Monolith or microservices? {#hldbb-monolith}
Default to the monolith or modular monolith. Split out a service only for a named pressure: independent scaling (one path 100x the other), team autonomy, a different DB or tech need, or fault isolation.
**Why:** every in-process call becomes a network hop (~0.5 ms, can fail), and a write across two services becomes a distributed transaction.
**Trap:** leading with "microservices" is a buzzword pick, like "NoSQL because it scales".

## Which rate-limiting algorithms exist, and what does distributed add? {#hldbb-rate-limit}
Fixed window, sliding window, token bucket (allows bursts), leaky bucket, per user/IP/key. The distributed version needs a shared counter (Redis) and cares about hot keys and clock skew. Return `429` + `Retry-After`.
**Why:** the lock from the single-process version becomes a server-side atomic Lua script.

## How do you protect a DB from a traffic spike? {#hldbb-backpressure}
Fail fast and cheap in a layered funnel: CDN, waiting room, token gate, atomic decrement (Redis Lua `DECR`), queue, then a DB unique constraint. Each layer sheds roughly an order of magnitude.
**Why:** oversell prevention is an atomic inventory decrement, never read-then-write (TOCTOU).

## What is idempotency, and how do you get "exactly-once"? {#hldbb-idempotency}
Idempotent means the retry has the same effect on server state (the response bytes may differ). Exactly-once is at-least-once delivery plus an idempotent consumer, using an idempotency key and dedup.
**Example:** a retried POST with the same `long_url` returns the same code (201 vs 200), so no double-charge or double-create.
