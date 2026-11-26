---
topic: HLD 10 · Key-Value Store
group: HLD
---

## KV store: which ONE clarifying answer shapes the whole design, and what do you assume? {#hld10-scope}
"On a network split, stay available or refuse?" Assume a shopping cart: stay available, with tunable consistency (the caller picks per request how many replicas must answer).
**Why:** because that answer picks leaderless replication with quorums over one leader per shard; sizes and QPS only change the node count.
**Example:** a failed "add to cart" loses a sale; a duplicate item in the cart is a small annoyance fixed at checkout.

## KV store (shopping cart): a network partition splits the cluster. Which CAP side does it take, and why is that right for carts? {#hld10-cap}
AP (available): both sides keep accepting reads and writes, and conflicting versions are reconciled after the split heals.
**Why:** because a refused write is a lost sale, while a stale or doubled cart item is cheap to fix; the cost is that the app must handle conflicting versions.
**Example:** your phone's "add milk" lands on one side and your laptop's "add bread" on the other. Both succeed, and after healing the cart shows both.
**Trap:** CAP (Consistency vs Availability during a Partition) only describes the split; the rest of the time the choice is latency vs consistency.

## KV store: with NO partition, what does every request still trade, and who picks? {#hld10-pacelc}
Latency vs consistency (the "Else" half of PACELC: if Partition, A or C; Else, Latency or Consistency). The caller picks per request by choosing W and R.
**Why:** because waiting for more replicas means waiting for a slower reply. Partitions are rare, so this dial is the everyday choice; Cassandra/Dynamo are PA/EL, single-leader SQL is PC/EC.
**Example:** asking one friend for directions is fast; asking three and taking the majority is safer but slower.

## KV store: 100 TB of data, 3 replicas, 8 TB SSD nodes filled to 50%. How many nodes? {#hld10-sizing}
75 nodes: 100 TB × 3 = 300 TB raw ÷ 4 TB usable per node = 75.
**Why:** fill only to 50% because compaction (background merging of data files) writes the merged copy before deleting the old files, so it briefly needs extra free space.
**Example:** a node with 4 TB of data compacting a 1 TB set of files needs up to ~1 TB spare while both copies exist.

## KV store: 75 nodes, 100K ops/s at 50/50 read/write, reads ask R=2, writes go to N=3. Storage-bound or traffic-bound? {#hld10-bound}
Storage-bound: only ~3.3K replica operations/s per node, against an SSD's 10–20K.
**Why:** because disk capacity already forced 75 nodes, traffic gets 3–6× headroom for free.
**Example:** 50K reads × 2 + 50K writes × 3 = 100K + 150K = 250K replica-ops/s ÷ 75 ≈ 3.3K per node.

## KV store: a key hashes to a point on the ring. Which nodes store it, and which node handles the client's request? {#hld10-ring}
The first N=3 distinct physical nodes clockwise (the preference list) store it. Any node that receives the request acts as coordinator (fans it out to the replicas).
**Why:** because each machine owns many vnodes (virtual ring positions), skipping repeats keeps 3 copies on 3 machines; with no fixed leader there is no failover pause.
**Example:** `cart:42` hashes to a point; walking clockwise you meet A, A again (another vnode), B, D. Preference list = [A, B, D].

## KV store: walk one `put(k, v)` through the cluster with N=3, W=2. {#hld10-put-path}
Client → any node (the coordinator) → it hashes k, finds the 3 preference-list replicas (the N=3 owners), sends to all 3, and acks the client after 2 reply.
**Why:** because waiting for 2 of 3 tolerates one slow or dead replica, and the third copy still arrives later (or via hinted handoff).
**Example:** replicas A, B, D. A and B ack in 2 ms, D is slow, so the client gets OK at ~2 ms.

## KV store: why a leaderless Dynamo/Cassandra-style design and not sharded Postgres? {#hld10-why-not-postgres}
Sharded Postgres has one leader per shard, so that shard's writes stop during failover. Leaderless accepts a write on any 2 of 3 replicas.
**Why:** because a cart must stay writable, and we need no joins or multi-key transactions; the cost is resolving conflicting versions ourselves.
**Example:** a counter with one cashier closes when she steps out; a counter where any 2 of 3 clerks can stamp your form stays open.
**Trap:** Postgres is the right answer when you need transactions and joins.

## KV store, N=3, W=2, R=2: x=4 on A, B, D; a put x=5 reaches only A and B. A read asks B and D. What comes back, and why is it guaranteed? {#hld10-quorum}
5. Any 2 of the 3 replicas must overlap the 2 that took the write (2 + 2 > 3), and the newer timestamp wins.
**Why:** because the read always touches at least one replica with the latest write, it can never see only stale copies.
**Example:** tell a secret to 2 of 3 roommates; ask any 2 of them and at least one knows it.
**Trap:** this is not full strong consistency: sloppy quorums, concurrent writes and clock skew under last-write-wins can still return stale or lost data.

## KV store, N=3: a "likes" counter tolerates stale reads. Which W and R, and what do you give up? {#hld10-dial}
W=1, R=1: fastest, and works with 2 of 3 replicas down, but W + R = 2 ≤ 3, so a read may miss the latest write.
**Why:** because each request waits only for the single fastest replica instead of the 2nd-fastest.
**Example:** a like count showing 1,203 instead of 1,204 for a second hurts nobody.

## KV store, N=3: reads are 10× writes and must be fresh. Which W and R, and what breaks? {#hld10-dial-reads}
W=3, R=1: every read hits one replica and is still fresh (3 + 1 > 3), but a write fails if any one replica is down.
**Why:** because all 3 replicas must ack the write, the read can ask any one of them; the cost moves entirely to write availability.
**Example:** a product catalogue edited a few times a day but read constantly; a blocked edit for a minute is acceptable.

## KV store across two regions: QUORUM would wait on a ~100 ms cross-region reply. What do you use instead? {#hld10-local-quorum}
LOCAL_QUORUM: 2 of 3 replicas in the caller's own datacenter must answer; the other region catches up asynchronously.
**Why:** because a quorum normally waits for the 2nd-fastest reply, which is a fraction of a ms locally but ~100 ms if it has to cross regions.
**Example:** a Mumbai user's write waits for 2 Mumbai replicas (~2 ms); the Singapore replicas get it ~100 ms later.

## KV store: two clients write the same cart key on opposite sides of a partition. Which conflict rule do you ship, and what does it cost? {#hld10-conflicts}
Last-write-wins (LWW: highest timestamp kept, the other dropped). The cost is a silently lost write, so store each cart item as its own key or column.
**Why:** because the alternative, vector clocks, pushes merge code onto every client.
**Example:** phone adds milk at 10:00:01, laptop adds bread at 10:00:02 to one `cart:42` value: LWW keeps only bread. With one column per item, both survive.

## KV store: how do vector clocks tell "newer" from "conflict"? {#hld10-vector-clock}
Version X replaces Y only if every counter in X is ≥ the matching one in Y. Otherwise they are concurrent siblings and the app merges them.
**Why:** because a vector clock (one counter per node that wrote the value) records who saw what, so "neither saw the other's update" is detectable.
**Example:** D2 [A:2]. B writes D3 [A:2, B:1], C writes D4 [A:2, C:1]. Neither dominates: conflict. The client merges into D5 [A:3, B:1, C:1], which dominates both.

## KV store, 75 nodes, no leader: how does a node learn another is dead? {#hld10-gossip}
Gossip: every second each node swaps its heartbeat-counter table with 1–3 random peers; a node whose counter stops rising for ~10 s is marked down.
**Why:** because news spreads like a rumour, reaching all nodes in ~log₂(75) ≈ 7 rounds at 1 message per node per second, versus all-to-all heartbeats of 75 × 74 = 5,550/s.
**Example:** office gossip: you tell two colleagues, they each tell two, and the whole floor knows by lunch.

## KV store: a replica is down for 5 minutes. How do its writes still end up on 3 copies? {#hld10-hinted-handoff}
Hinted handoff: the coordinator (or the next healthy ring node) keeps the write plus a hint "belongs to D", and replays it when gossip says D is back.
**Why:** because W=2 is already met by the two live replicas; the hint only restores the third copy later.
**Example:** a courier leaves your parcel with your neighbour and a note; you collect it when you get home.

## KV store: two of a key's three replicas are down. How can a W=2 write still succeed, and what does it cost? {#hld10-sloppy-quorum}
Sloppy quorum: count the first 2 healthy nodes on the ring, even outside the preference list (the key's 3 owners), holding hints for the owners.
**Why:** because it keeps writes available, but W + R > N no longer guarantees a fresh read until the hints are delivered: that is the AP trade-off.
**Example:** owners A, B, D; B and D are down, so A and E accept. A read that asks B and D after they recover misses the write until E hands it over.

## KV store: a replica lost its disk. How do you find which of its ~4 billion keys differ, cheaply? {#hld10-merkle}
Merkle-tree repair: hash each bucket of keys, hash pairs of hashes up to one root, compare roots between replicas and descend only into branches that differ.
**Why:** because matching hashes prove a whole subtree is equal, so you skip it without reading any keys.
**Example:** 1M buckets of ~4,000 keys; if 1% differ you copy 10K × 4K × 1 KB ≈ 40 GB, not 4 TB.

## KV store: three repair mechanisms keep replicas in sync. Which fixes which kind of drift? {#hld10-repair-layers}
1. Read-repair: keys that are read often. 2. Hinted handoff: short outages. 3. Merkle repair: everything else (lost disks, expired hints). Grade Got it only if you matched all three.
**Why:** because each is cheapest for its case: read-repair rides on reads, hints are small, Merkle scans are heavy and run in the background.
**Example:** a library fixes a torn page when a reader notices (read-repair), keeps returns for an absent member (hints), and does a yearly stock-take (Merkle).

## KV store at 50K writes/s: walk the write path on one replica until it acks. {#hld10-lsm}
Append to the commit log, insert into the in-memory memtable, ack. Later the memtable is flushed at ~128 MB as an immutable sorted file (SSTable).
**Why:** because an append and a RAM insert need no random disk seek, unlike a B-tree's in-place page update; the cost is that reads may check several SSTables and compaction rewrites data in the background.
**Example:** a shopkeeper writes each sale in a running notebook (log) and on a whiteboard (memtable), then copies the board into a sorted register at night.

## KV store: files are immutable. How does `delete(k)` work, and what can go wrong? {#hld10-tombstone}
Write a tombstone (a "deleted at time T" marker); reads that find it return not-found. Compaction drops it after a grace period (~10 days).
**Why:** because you cannot erase from an immutable file, the delete is itself a newer write that outranks the old value.
**Example:** crossing out a name in a register with today's date instead of tearing out the page.
**Trap:** the grace period must exceed the repair interval, or a replica that missed the delete resurrects the key.

## KV store: a `get(k)` on one replica. In what order does it look, and how does it skip most files? {#hld10-read-path}
Memtable first, then SSTables newest to oldest; each SSTable's bloom filter (a bit array saying "definitely not here" or "maybe") skips files without a disk read.
**Why:** because the newest copy wins, searching newest-first can stop at the first hit.
**Example:** 4 billion keys × 10 bits (1% false positives) ≈ 5 GB of RAM per node for all the filters, which fits.

## KV store: why N = 3 replicas, not 2 or 5? {#hld10-why-n3}
N=3 is the smallest N where a quorum (2) survives one node down and still overlaps; N=5 costs 67% more disk for rare benefit.
**Why:** because with N=2 a quorum is 2 of 2, so any single failure blocks writes.
**Example:** 100 TB × 3 = 300 TB raw; × 5 = 500 TB, i.e. 200 TB more SSD to survive a second simultaneous failure.

## KV store: during a quorum read the replicas disagree. What does the coordinator do beyond answering? {#hld10-read-repair}
Read-repair: return the newest version and write it back to the stale replica in the background.
**Why:** because the read already fetched both versions, fixing the stale one costs one extra write and no separate job; rarely read keys still need Merkle repair.
**Example:** B says x=5, D says x=4: the client gets 5, and D is quietly updated to 5.

## Give the 30-second pitch for the key-value store as 4 beats. {#hld10-pitch}
1. Scale: 100 TB × 3 ÷ 4 TB = 75 nodes, storage-bound. 2. Placement: consistent hashing with vnodes, N=3, any node coordinates. 3. Consistency: AP, W=2/R=2, last-write-wins. 4. Healing + storage: gossip, hints, Merkle repair, LSM engine. Grade Got it only if you said all 4.
**Why:** because this order goes from the number that sizes the cluster to the choices that keep it correct.
**Example:** essentially Cassandra, or Amazon's Dynamo paper, built for a shopping cart.
