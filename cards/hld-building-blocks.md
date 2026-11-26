---
topic: HLD · Building Blocks
group: HLD
---

## What is consistent hashing, and why not `hash(key) % N`? {#hldbb-consistent-hashing}
Place keys and servers on a hash ring; a key belongs to the next server clockwise. Adding or removing a node remaps only one arc.
**Why:** `hash(key) % N` remaps ~83% of keys going from 5 to 6 nodes (~99% at 100), causing a cache-miss storm on the origin. Even load needs virtual nodes (many ring points per physical node).
**Reach for it:** a changing pool of nodes sharing data (distributed caches, sharded DBs, Dynamo-style stores).

## How do you pick a partition key, and what is a hot partition? {#hldbb-partition-key}
Partition on the field you look up by, and make it high-cardinality (many distinct values). A 2-value field gives at most 2 non-empty partitions however many machines you buy.
**Hot partition:** one node drowns while others idle. Hot by data (one partition holds far more rows) or by traffic (rows spread fine, requests pile on one). Sharding fixes volume, never skew.
**Example:** 10 supermarket counters; "counter by surname initial" gives S a 100-person queue and Z nobody.

## What is scatter-gather and what does it cost? {#hldbb-scatter-gather}
When you cannot compute which partition holds the answer, you query all of them and merge the replies.
**Why it is bad:** (1) amplification: 6k QPS x 10 partitions = 60k/s; (2) tail latency: you wait for the slowest of N; (3) it scales backwards: more partitions means more fan-out.
**Example:** 10 cabinets ordered by phone number, but the customer gives a name. You open all 10.

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
**Why:** hit rate is the metric to quote. A hit is RAM (~100 ns) vs an SSD read (~100 us): ~1,000x cheaper.

## Eviction vs invalidation: what is the difference? {#hldbb-eviction}
Eviction: the cache is full, so what to drop (LRU default, LFU for a stable hot set, FIFO, TTL). Invalidation: the data changed, so how the cache learns (TTL, delete-on-write, or write-through).
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
**Why:** the read:write ratio decides. A huge fan-out (celebrity) kills push; a large fan-in under a tight budget kills pull. Push's real cost is N x active fraction. If a feed can be rebuilt from posts, it is a cache: no backups.
**Example:** photocopy a notice into 500 lockers, or pin one on the noticeboard.

## When do you need WebSockets? {#hldbb-websockets}
When the server must push to the client: chat, presence, live location, live scores. A connection-manager tier holds millions of open sockets, and routing a message means finding which server holds the recipient's socket.
**Why L4:** both L4 and L7 balancers pin a socket to one server (a TCP connection cannot move once open); L4 is chosen for cost with huge numbers of long-lived connections.

## How does a geo-index answer "what is near me"? {#hldbb-geo}
Geohash interleaves lat/long bits into a string; a shared prefix means spatial proximity, so neighbours are range-queried. Quadtree splits space into 4 until each cell holds at most K points, so dense cities get finer cells.
**Example:** ride-hailing driver matching.

## What is a distributed lock, and what beats a DB lock? {#hldbb-lock}
Mutual exclusion across nodes via Redis `SET key val NX EX ttl`. NX means only if absent (atomic acquire); EX auto-expires so a dead holder does not deadlock.
**Why:** it beats a pessimistic DB lock, which exhausts the connection pool under contention (10k clients vs ~1k DB connections). It is the seat-hold mechanism in BookMyShow.

## base62 vs Snowflake IDs: what is each, and which do you use? {#hldbb-id-gen}
base62 is just an alphabet `[0-9a-zA-Z]` for short codes. The textbook answer encodes a counter into it; the URL shortener rejects that (enumerable) and draws 7 random chars. Snowflake is `timestamp | machine | sequence`: 64 bits, roughly time-sortable, generated locally with no coordination.
**Why:** time-sortable IDs make ordering, merging and cursor pagination free in the news feed.

## L4 vs L7 load balancer? {#hldbb-lb}
L4 sees only IPs and ports, picks a server at TCP connect and passes bytes through: cheap, fast, cannot route by URL. L7 reads the HTTP request (path, headers, cookies), so it can route by path, check auth and rate-limit, at more CPU cost.
**Default:** L7 for HTTP APIs.
**Example:** L4 is a guard checking which door you used; L7 is a receptionist who reads your letter.

## Monolith or microservices? {#hldbb-monolith}
Default to the monolith or modular monolith. Split out a service only for a named pressure: independent scaling (one path 100x the other), team autonomy, a different DB or tech need, or fault isolation.
**Why:** every in-process call becomes a network hop (~0.5 ms, can fail), and a write across two services becomes a distributed transaction.
**Trap:** leading with "microservices" is a buzzword pick, like "NoSQL because it scales".

## What is CAP? {#hldbb-cap}
When the network partitions (nodes cannot reach each other), pick: Consistency (every read sees the latest write; refuse if you cannot guarantee it) or Availability (always answer, maybe stale). It is decided per operation, not per system.
**Example:** a bank ATM that goes offline when it cannot reach the bank is CP; one that dispenses up to 50 offline is AP.

## LSM tree or B-tree? {#hldbb-lsm-btree}
Write-heavy: LSM (append to a log and memtable, flush immutable files; Cassandra). Read-heavy with range scans: B-tree (fast reads, a seek per write; Postgres).
**Why:** LSM reads may touch several files, so they have a fatter tail; background compaction can spike latency.

## What is TOCTOU, and what replaces check-then-act? {#hldbb-toctou}
Time-of-check to time-of-use: you check a condition then act, and the world changes in the gap (two servers both see a code free, both insert).
**Fix:** try the write and let an atomic constraint arbitrate, then catch the conflict. Same idea: atomic decrement instead of read-then-write for inventory, and an idempotency key so retries are safe.
