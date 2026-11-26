---
topic: HLD 09 · Distributed Cache
group: HLD
---

## Distributed cache: give the 30-second pitch in 4 beats. {#hld09-pitch}
1. Size: 1 TB and 1M ops/s → 24 primaries + 24 async replicas (memory decides). 2. Node: a RAM hash map plus an LRU list, O(1) everything; TTL lazy plus sampled. 3. Routing: a client-side consistent-hash ring with 150 vnodes, so a resize moves ~4%, not 96%. 4. Safety: majority-vote failover to a warm replica; cache-aside with delete-on-write.
**Why:** the DB is the source of truth, so every choice favours speed and keeping DB load flat over durability.
**Example:** a librarian's desk copies of popular books: fast to grab, and if a copy goes missing the original is still on the shelf.
Grade Got it only if you said all 4 beats.

## Distributed cache: which ONE clarifying question shapes the whole design, and how? {#hld09-scope}
"Is it a cache in front of a DB, or the only copy of the data?" Here it sits in front of a DB, so a lost key is just a miss.
**Why:** that takes durability off the cache's plate, which is what allows async replication, no disk persistence, and evicting keys when full.
**Example:** a whiteboard copy of the shop ledger can be wiped and recopied; if the whiteboard were the only record, you'd need a safe.

## Distributed cache: 1 TB of data, 1M ops/s, ~64 GB usable RAM per node filled to ~70%, ~100K ops/s per node. How many nodes? {#hld09-sizing}
24 primaries + 24 replicas = 48 nodes. Memory decides, not CPU.
**Why:** 1,000 GB ÷ (64 × 0.7 = 44.8 GB) ≈ 22.3, rounded up to 24 (~42 GB each, ~66% full). Ops: 1M ÷ 24 ≈ 42K per node, only ~42% of capacity.
**Example:** you choose the number of shelves by how many books you own, not by how many readers walk in.
**Trap:** 16 nodes (1,000 ÷ 64) is the bare minimum but ~98% full, with no room for growth.

## Distributed cache: 24 nodes serve 900K gets/s at a 95% hit ratio. One node dies with no replica. What does the DB feel? {#hld09-db-protection}
DB reads jump from 45K to ~82.5K/s (1.8×). It is a load problem, not data loss.
**Why:** the dead node's keys still exist in the DB, but every get for them now misses. A second failure at peak could tip the DB over, which is why each primary gets a replica.
**Example:** normal misses 900K × 5% = 45K/s; the dead node's share 900K ÷ 24 = 37.5K/s; total ≈ 82.5K/s.

## Distributed cache: a dead node can be replaced by a fresh empty node or by promoting its replica. Why the replica? {#hld09-hit-ratio}
The replica is already warm. A fresh node starts empty and refills ~42 GB only through misses, keeping ~37.5K extra DB reads/s going for minutes.
**Why:** cache-aside (the app fills the cache after a miss) only fills a key when someone misses on it, so a cold node is a DB load spike that lasts until its hot set is re-read.
**Example:** a new shopkeeper with an empty counter sends every customer to the warehouse; the assistant who already knows the stock serves them at once.

## Distributed cache: why must each node keep its data in a RAM hash map, not on SSD? {#hld09-node}
A p99 (99th-percentile latency) under ~2 ms over ~1B keys needs O(1) lookups at RAM speed: ~100 ns per access versus ~100 µs on SSD.
**Why:** a hash map finds any key in one step however many keys there are, and RAM is ~1,000× faster than SSD, so even several accesses per request stay far inside the budget.
**Example:** fetching a file from your desk drawer versus from a warehouse across town.

## Distributed cache: how does a node find and evict the least-recently-used key in O(1)? {#hld09-lru}
A hash map points each key to its node in a doubly linked list ordered by recency. A get moves the node to the head; when memory is full, drop the tail.
**Why:** each list node knows both neighbours, so unlinking from the middle is O(1), and the map points straight at it, so nothing ever walks the list.
**Example:** a desk that holds 5 books: the one you just read goes on top, and when a 6th arrives, the bottom book goes back to the shelf.

## Distributed cache at 1B keys: can you afford strict LRU's two pointers per entry? {#hld09-approx-lru}
Yes: ~16 B × 1B ≈ 16 GB across a 1 TB cluster, under 2% of memory.
**Why:** Redis instead uses approximate LRU (sample ~5 keys, evict the oldest of them) to save that memory and CPU; evicting "nearly the oldest" barely hurts the hit ratio, but at under 2% strict LRU is affordable too.
**Example:** 16 GB ÷ 1,000 GB = 1.6% of RAM for exact recency order.

## Distributed cache on Redis: you set `maxmemory` but leave the eviction policy at its default. What happens when memory fills, and the fix? {#hld09-noeviction}
Writes start failing: the default `maxmemory-policy` is `noeviction` (reject writes when full). Set `allkeys-lru` (evict any key, least recently used first).
**Why:** Redis defaults to database-safe behaviour (never silently drop data); a cache wants the opposite, because every key can be refetched from the DB.
**Example:** a full fridge that refuses new groceries instead of throwing out the oldest leftovers.

## Distributed cache: how are keys with a TTL removed without scanning all 1B keys? {#hld09-ttl}
Lazily on read (expired → delete and return a miss), plus active sampling: every 100 ms test ~20 random TTL keys, delete the expired ones, and repeat if over 25% were expired.
**Why:** lazy alone lets expired keys nobody reads fill memory forever; sampling keeps that share low at a bounded CPU cost.
**Example:** a shop checks a packet's expiry date when a customer picks it up, and also spot-checks a few shelves every morning.

## Distributed cache: you pick the node with `hash(key) % N` and grow from 24 to 25 nodes. What fraction of keys move, and what does the DB feel? {#hld09-mod-n}
~96% move. A key stays only if `hash % 24 == hash % 25`, true for 24 of every 600 hashes (600 = lcm of 24 and 25), so only 4% stay.
**Why:** changing N changes almost every remainder, so ~960M of 1B keys miss at once and DB reads head toward the full 900K gets/s.
**Example:** renumbering every house on the street because one new house was built: almost all the post goes astray.

## Distributed cache: on a consistent-hash ring you add node 25 to 24. How many keys move, and what does the DB feel? {#hld09-consistent-hashing}
~1/25 = 4% move, so ~900K × 4% ≈ 36K extra DB reads/s, briefly.
**Why:** on a ring (nodes and keys hashed onto a circle; a key belongs to the next node clockwise) the new node only takes the keys between it and its predecessor; every other key keeps its home.
**Example:** a new kirana shop opening on the street takes customers only from its own stretch of road.
**Trap:** add nodes one at a time, so each 4% refill wave passes before the next.

## Distributed cache: why give each machine ~150 positions (virtual nodes) on the ring instead of one? {#hld09-vnodes}
Even load. With one point each, random gaps can give one node 2–3× the average; ~150 points each brings the spread down to ~5–10%.
**Why:** many small arcs average out the randomness of where hashes land, just as many dice rolls average close to 3.5.
**Example:** 24 nodes × 150 = 3,600 ring points; a lookup is a binary search of ~12 comparisons. A machine with 2× the RAM simply gets 300.

## Distributed cache with ~150 virtual nodes per machine: one node dies. Who absorbs its keys? {#hld09-vnode-failover}
All 23 survivors, ~1/23 each, because its 150 small arcs are scattered around the ring.
**Why:** without virtual nodes the single next node clockwise takes everything and doubles its load, which can knock it over too and cascade.
**Example:** 37.5K gets/s ÷ 23 ≈ 1.6K extra per survivor, instead of +37.5K on one neighbour.

## Distributed cache: who holds the ring, the client library or a proxy? Pick one for a ~2 ms latency budget. {#hld09-routing}
A smart client library: it keeps the ring (updates pushed from ZooKeeper/etcd) and calls the right node directly, in one hop.
**Why:** a proxy (twemproxy, Envoy: a server that routes for you) keeps clients simple but adds ~0.2–0.5 ms per call and a fleet to run; the client's cost is one library per language.
**Example:** 0.5 ms of a 2 ms budget means a quarter of the time spent on a middleman.
**Trap:** Redis Cluster is not a ring: it maps 16,384 fixed hash slots (`CRC16(key) % 16384`) to nodes and moves whole slots on resize. Different mechanism, same goal.

## Distributed cache: primary 7 dies. Walk the failover in 3 beats. {#hld09-failover}
1. Detect: ~1 s heartbeats; after ~5 s of silence a majority of monitors agree it is down. 2. Promote replica 7. 3. The config service pushes the new ring entry to every client, and a fresh replica copies the data.
**Why:** the majority vote stops one flaky network link from causing a false failover.
**Example:** async replication means the last <1 s of acknowledged writes may be lost; those keys just miss and refill from the DB.
Grade Got it only if you said all 3 beats.

## Distributed cache: why replicate to the replica asynchronously? {#hld09-async-replica}
Synchronous replication roughly doubles put latency and stalls when a replica is slow, all for durability a cache doesn't need.
**Why:** a lost write here is only a cache miss (the DB has it), so async (reply without waiting for the replica) costs at most ~1 s of writes on failover.
**Example:** you post a letter without waiting for the photocopy; if the copy is lost, the original is still on file.

## Distributed cache: why don't clients read from the replicas? {#hld09-no-replica-reads}
A replica can be a few ms behind, which breaks read-your-writes (seeing your own update straight away), and at ~42% load there is no need for the extra capacity.
**Why:** the replicas exist so failover is instant and the new primary is already warm; serving reads would trade correctness for capacity we don't need.
**Example:** you change your profile photo, refresh, hit a lagging replica, and see the old photo.

## Distributed cache: one celebrity key gets 300K reads/s, and a node handles ~100K. What fixes it without touching the cache cluster? {#hld09-hot-key}
A 1–5 s in-process cache for that key on each app server.
**Why:** consistent hashing sends one key to one node, so it spreads keys, not traffic; local copies absorb the reads at the cost of up to 5 s of staleness.
**Example:** 200 app servers each see ~1.5K reads/s; with a 5 s local TTL each asks the cache once per 5 s, ~40 requests/s in total.

## Distributed cache: besides a local cache, how can you split one hot key's 300K reads/s across several nodes? {#hld09-key-copies}
Store 10 copies, `profile:99#0` … `profile:99#9`; readers pick a random suffix, so each copy takes ~30K reads/s.
**Why:** the suffix changes the hash, so the copies usually land on different nodes. The cost is that a writer must update or delete all 10.
**Example:** pinning the exam timetable on 10 notice boards instead of one crowded board.

## Distributed cache: a key read 20K times/s expires, and rebuilding it from the DB takes 100 ms. How many DB queries hit, and what cuts it to one? {#hld09-stampede}
20K × 0.1 s = 2,000 identical queries. A short lock (`SET lock:key 1 NX PX 3000`) lets only the first request rebuild; the rest wait ~50 ms and retry the cache.
**Why:** NX (set only if absent) lets exactly one request win, and PX 3000 (expire in 3 s) frees the lock if that request dies.
**Example:** the shutter opens at 10 with 500 people outside: one clerk restocks the shelf while the rest wait at the door.

## Distributed cache: after a deploy, 1M keys are written in the same minute with TTL 300 s. What happens 5 minutes later, and the fix? {#hld09-jitter}
They all expire in the same minute and the DB takes a miss wave. Fix: jitter the TTL, e.g. 300 s plus a random 0–30 s.
**Why:** the randomness turns one sharp spike into a spread-out trickle the DB can absorb.
**Example:** staggered office start times so the lift isn't mobbed at 9:00 sharp.

## Distributed cache: on a DB write, why delete the cache key instead of setting the new value? {#hld09-delete-not-set}
Racing writers can set the cache in the wrong order and leave an old value until TTL; a delete makes the next reader refill the latest value from the DB.
**Why:** the DB orders the writes, but cache sets can land in any order; a delete has the same effect whatever the order. TTL caps staleness if a delete fails.
**Example:** A writes 5 then B writes 7 to the DB; B's cache set lands first, then A's delayed set of 5, so the cache shows 5. With deletes, the next read gets 7.

## Distributed cache: why cache-aside, not write-back, for this design? {#hld09-cache-aside}
Write-back makes the cache the only copy of recent writes, so a node crash loses data. With cache-aside the DB stays the source of truth and a lost key is just a miss.
**Why:** the spec put durability in the DB, so the cache must fail safe. Write-through is also safe but slows every write and caches data nobody reads.
**Example:** noting sales on a whiteboard and copying them into the ledger at night (write-back) versus writing the ledger first (aside).

## Distributed cache: attackers request ids that don't exist. Why is that bad, and how do you stop it? {#hld09-penetration}
Every request misses the cache and the DB (cache penetration), so the cache protects nothing. Cache "not found" with a short TTL (~30–60 s), or check a Bloom filter of existing ids first.
**Why:** cache-aside fills only after the DB returns a value, so a missing key is never cached. A Bloom filter (compact set that can say "definitely absent") rejects them cheaply.
**Example:** a receptionist who checks the register for "Mr X" every time anyone asks, instead of a sticky note saying "no such person".

## Distributed cache: values average 1 MB and a node serves ~42K ops/s. What breaks first? {#hld09-big-values}
The network: 42K × 1 MB = 42 GB/s, far above a 10 Gbps NIC (~1.25 GB/s). Cap value size, alert on big keys, and compress or split large objects.
**Why:** the cost of a request grows with its value size, so a few huge values starve every small request on that node.
**Example:** one truck blocking a lane of scooters.

## Distributed cache: a network partition leaves two nodes both acting as primary for shard 7. How is it resolved, and what is lost? {#hld09-split-brain}
Promotion needs a majority of monitors, and the config service holds one ring version, so clients follow the newest ring and the minority primary steps down. Writes it took meanwhile are lost, which a cache can accept.
**Why:** a majority can exist on only one side of a partition, so only one primary can ever be official.
**Example:** two people claiming the same class-monitor badge: the class vote decides, and the loser's notes are thrown away.

## Distributed cache: traffic grows 10× to 10M ops/s on 24 primaries (~100K ops/s each). What changes? {#hld09-10x}
Each node would need ~417K ops/s, 4× over its limit, so ops now decides: ~140 primaries at ~70% load (or read from replicas too).
**Why:** memory needs are unchanged, but the per-node CPU ceiling is hit first; consistent hashing lets you add nodes while moving only ~1/N of keys each time.
**Example:** 10M ÷ 24 ≈ 417K; 10M ÷ 70K ≈ 143 primaries.
