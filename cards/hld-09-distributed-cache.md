---
topic: HLD 09 · Distributed Cache
group: HLD
---

## What do you clarify first for a distributed cache, and what does it unlock? {#hld09-scope}
Is it a cache in front of a database (DB stays source of truth) or the only copy? Here: in front of a DB, get/put/delete with optional TTL, ~1 TB, ~1M ops/s (90% reads), p99 under a few ms, evict when full.
**Why:** if the DB is the source of truth, losing a key is just a miss, so you can skip durability and use async replication.
**Example:** TTL (time-to-live) = after N seconds the key counts as gone.

## How many cache nodes do you need for 1 TB and 1M ops/s? {#hld09-sizing}
24 primaries plus 24 replicas = 48 nodes. Memory decides, not CPU.
**Why:** usable RAM ~64 GB per node, planned ~70% full: 1,000 GB ÷ (64 × 0.7 = 44.8) ≈ 22.3, round to 24 (~42 GB each, ~66% full). Ops: 1M ÷ 24 ≈ 42K per node vs ~100K capacity, so ~42% busy.
**Trap:** 16 nodes is the bare minimum (1,000 ÷ 64 = 15.6) but would be ~98% full.

## Why does a dead cache node matter if the data is in the DB anyway? {#hld09-db-protection}
It is a load problem, not a durability problem. Every key on that node becomes a miss and hits the DB.
**Why:** with a 95% hit ratio the DB sees 900K × 5% = 45K reads/s. One node down adds 900K ÷ 24 = 37.5K, so ~82.5K reads/s (1.8×). With no cache at all it would be 900K, 20× more.
**Example:** that is why each primary gets a replica.

## What lives inside one cache node? {#hld09-node}
A hash map from key to entry (O(1) lookup) plus an LRU doubly linked list. Each entry holds value and `expires_at`.
**Why:** RAM access is ~100 ns vs ~100 µs for SSD, and the p99 target is under 2 ms. With 1 billion keys, every operation must be O(1).
**Example:** the map points straight at the list node, so nothing ever walks the list.

## How does LRU eviction work in O(1)? {#hld09-lru}
Keep keys ordered from most to least recently used. A get moves the entry to the head; when full, drop the tail.
**Why:** moving an item from the middle is O(n) in an array but O(1) in a doubly linked list, because each node knows both neighbours.
**Example:** a desk holding 5 books: the one you read goes on top, and the bottom book returns to the shelf.

## Strict LRU or approximate LRU at 1 billion keys? {#hld09-approx-lru}
Strict LRU is fine here: its two pointers cost ~16 B per entry, ~16 GB across a 1 TB cluster, under 2%. Redis uses approximate LRU instead: sample ~5 keys and evict the oldest, which saves memory and is close enough.
**Trap:** Redis's default `maxmemory-policy` is `noeviction` (rejects writes when full). A cache must set `allkeys-lru`.

## How does a key expire (TTL) without scanning everything? {#hld09-ttl}
Two ways. Lazy: on `get`, if `now > expires_at`, delete and return a miss. Active: every 100 ms sample ~20 random TTL keys, delete the expired ones, and resample if over 25% were expired.
**Why:** lazy alone lets expired keys nobody reads fill memory forever.

## Why not `hash(key) % N` to pick the node? {#hld09-mod-n}
Resizing moves almost every key. Going 24 → 25 nodes, a key stays only if `hash % 24 == hash % 25`: 24 of every 600 hashes (lcm of 24 and 25), so 4% stay and 96% move.
**Why:** ~960M of 1B keys miss at once and DB reads head toward 900K/s.
**Example:** consistent hashing moves only ~1/25 = 4%, about 36K extra DB reads/s briefly.

## How does consistent hashing work? {#hld09-consistent-hashing}
Hash nodes and keys onto a ring (0 to 2³²−1); a key belongs to the first node clockwise. Adding node 25 takes over only the keys between it and its predecessor.
**Why:** only ~1/N of keys move on a resize, instead of ~all with `hash % N`.
**Example:** a clock face: each node sits at a time, each key walks clockwise to the next node.

## Who holds the ring: the client library or a proxy? {#hld09-routing}
Smart client library (the pick): it holds the ring, gets updates from a config store (ZooKeeper or etcd) and talks straight to the node, one hop. A proxy (twemproxy, Envoy: a middle server that routes for you) keeps clients simple but adds ~0.2-0.5 ms and a fleet to run.
**Why:** the latency budget is ~2 ms. The cost of client-side routing is one client library per language.
**Example:** Redis Cluster uses 16,384 fixed hash slots (`CRC16(key) % 16384`) assigned to nodes, the same idea.

## A primary dies. Walk through failover. {#hld09-failover}
Each primary streams writes asynchronously to its replica. Heartbeats (~1 s) detect it; a majority of monitors (watcher processes) must agree it is down; the replica is promoted, the config service pushes the new ring entry, and a fresh replica copies the data.
**Why:** the majority vote stops one flaky network link from causing a false failover. Async means the primary replies without waiting for the replica.
**Example:** the loss is under a second of acknowledged writes, which just miss or are briefly stale until TTL.

## Why asynchronous replication, and why not read from replicas? {#hld09-async-replica}
Sync replication roughly doubles put latency and stalls if the replica is slow, for durability a cache does not need. Replica reads can be a few ms stale and break read-your-write.
**Why:** at ~42% ops load there is no need for extra read capacity, so replicas only serve failover.

## One celebrity key gets 300K reads/s. What do you do? {#hld09-hot-key}
Consistent hashing sends one key to one node (~100K ops/s max). Fix: a 1-5 s local cache in each app server, or store copies `profile:99#0..#9` under different suffixes, which readers pick at random.
**Why:** with 200 app servers each sees ~1.5K reads/s, and a 5 s local TTL means ~1 cache call per 5 s each. 10 copies gives ~30K reads/s each. Writers must update all copies.
**Trap:** consistent hashing spreads keys, not traffic.

## What is a cache stampede and how do you stop it? {#hld09-stampede}
A hot key expires and every request misses at once and hits the DB (thundering herd). Fixes: lock/coalesce so one request rebuilds, jittered TTLs, early refresh.
**Why:** 20K reads/s × 100 ms rebuild = 2,000 identical DB queries. A lock (`SET lock:key 1 NX PX 3000`, set only if absent, expire in 3 s) makes it 1.
**Example:** TTL 300 s ± random 0-30 s stops keys from one deploy expiring together.

## On a DB write, why delete the cache key instead of setting it? {#hld09-delete-not-set}
Write the DB first, then `cache.delete(key)`. The next reader misses and refills from the DB. A TTL is the safety net.
**Why:** two racing writers can set an old value into the cache and leave it there until TTL. If the delete fails, TTL caps staleness at ~5 min.

## Why cache-aside and not write-through or write-back? {#hld09-cache-aside}
Cache-aside: the app reads the cache, on a miss reads the DB and fills the cache, so the cache stays a plain key-value store and the DB stays the source of truth.
**Why:** write-through makes writes slower and caches data nobody reads. Write-back can lose writes on a node crash, and durability is not the cache's job.

## Give the 30-second pitch for the distributed cache. {#hld09-pitch}
A cache in front of a DB: 1 TB and 1M ops/s means 24 primaries plus 24 async replicas. Each node is a hash map plus LRU list, O(1) everything, TTL lazy plus sampled.
**Why:** clients route with a consistent-hash ring (150 vnodes), so a resize moves ~4%, not 96%. Failover by majority vote and replica promotion. Cache-aside with delete-on-write. Hot keys: local cache or key suffixes. Stampedes: a lock and jittered TTLs.

## Why does each node need virtual nodes? {#hld09-vnodes}
A virtual node (vnode) is one of many ring positions a physical machine owns (`"A#1"`, `"A#2"`, ... ~150 each; 24 × 150 = 3,600 points).
**Why:** with one point per node the arcs are uneven (one node may own 2-3× average); 150 points gives a load std dev of ~5-10%. When a node dies its small arcs spread to all survivors (~1/23 each), not one neighbour.
**Example:** a machine with 2× the RAM gets 300 vnodes.

## What hit ratio does the design assume, and what happens on a cold node? {#hld09-hit-ratio}
95% hits, so the DB sees 5% of 900K gets/s = 45K reads/s. Hit ratio is what protects the DB.
**Why:** a replaced node starts empty and every key it owns misses until refilled via cache-aside. Refilling ~42 GB of cold data takes minutes, which is why a replica (already warm) is promoted instead.
