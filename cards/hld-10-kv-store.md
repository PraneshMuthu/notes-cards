---
topic: HLD 10 · Key-Value Store
group: HLD
---

## What do you clarify for a distributed key-value store, and which answer shapes the design? {#hld10-scope}
Only get/put/delete by exact key, values under 10 KB (~1 KB typical), ~100 TB, ~100K ops/s at 50/50 read/write, p99 under 10 ms. The big one: on a network split, stay available or refuse? Here: stay available, with tunable consistency (the caller picks per request how many replicas must answer).
**Example:** a shopping cart. A failed "add to cart" loses money; a duplicate item is a small annoyance.

## Explain CAP in plain words and which side this store picks. {#hld10-cap}
When the network splits (Partition), each side must either refuse requests (Consistency) or keep answering and risk staleness (Availability). You cannot have both during the split. This store picks AP with a quorum dial.
**Why:** partitions are rare, so the dial matters the other 99.9% of the time.
**Example:** two bank branches lose their phone line. A bank refuses (CP); a shopping cart pays out and reconciles later (AP).

## How many nodes for 100 TB, and is it storage-bound or traffic-bound? {#hld10-sizing}
75 nodes, storage-bound. 100 TB × 3 replicas = 300 TB raw; each node is 8 TB SSD filled to 50% = 4 TB usable; 300 ÷ 4 = 75.
**Why:** traffic is 50K reads × 2 (quorum R=2) + 50K writes × 3 (N=3) = 250K replica-ops/s ÷ 75 ≈ 3.3K per node, far below an SSD's 10-20K. Fill only to 50% because compaction needs free space.

## How do you partition and replicate keys? {#hld10-ring}
Consistent hashing: hash the key to a point on a ring, walk clockwise to the first node, then store on the first N=3 distinct physical nodes (the preference list). Each physical node owns many virtual nodes (ring positions). Any node can be the coordinator: the node that receives the client request and fans it out.
**Why:** adding node 76 moves ~1/76 of data, not nearly all as `hash % 75` would. Virtual nodes make a new node pull small slices from many peers, and there is no leader to fail.

## Why a leaderless Dynamo/Cassandra design and not sharded Postgres? {#hld10-why-not-postgres}
Postgres has one leader per shard, so writes pause during failover (CP). We need writes to succeed on any 2 of 3 replicas and an append-only engine for 50K writes/s.
**Trap:** Postgres is right when you need transactions and joins; here we do not.

## Explain W + R > N with numbers. {#hld10-quorum}
N=3 copies, write waits for W=2, read asks R=2. Two groups of 2 from 3 nodes must share a node (2+2=4 > 3), so a read always touches a replica with the latest write.
**Example:** replicas are A, B, D. put x=5 lands on A,B (D still has 4). A read of B,D sees 5 and 4, returns 5 (newer) and read-repairs D: the reader notices the stale copy and writes the newer value back.
**Trap:** this is not full strong consistency. Sloppy quorums, concurrent writes and last-write-wins clock skew can still return stale or lost data.

## What does the consistency dial look like (N=3)? {#hld10-dial}
| Setting | W+R>N | Behaviour |
|---|---|---|
| W=2, R=2 | yes | default; tolerates 1 node down |
| W=3, R=1 | yes | fast reads; write fails if any replica down |
| W=1, R=3 | yes | fast writes; reads fail if any down |
| W=1, R=1 | no | fastest, may read stale (metrics, likes) |

**Why:** QUORUM waits for the 2nd-fastest reply, a fraction of a ms. Across regions use LOCAL_QUORUM (2 of 3 in this datacenter) to avoid a ~100 ms trip.

## Two clients update the same key on different sides of a partition. How do you resolve it? {#hld10-conflicts}
Last-write-wins (LWW, Cassandra): highest timestamp wins, the other is dropped. Or vector clocks (Dynamo): a per-node counter list per value; if neither version dominates, return both and let the app merge.
**Why:** ship LWW because vector clocks push merge logic onto every client. The cost is a lost write under clock skew, so model carts as one key or column per item.

## How do vector clocks detect a conflict? {#hld10-vector-clock}
Version X replaces Y only if every counter in X is ≥ the matching counter in Y. Otherwise they are concurrent siblings and the app merges them.
**Example:** D2 [A:2]. B updates it to D3 [A:2, B:1], C to D4 [A:2, C:1]. Neither dominates, so conflict. The client merges and writes D5 [A:3, B:1, C:1], which dominates both.

## With no leader, how does a node learn that another is dead? {#hld10-gossip}
Gossip: each second every node swaps its heartbeat table with 1-3 random peers. If a node's counter has not advanced for ~10 s, it is marked down.
**Why:** news reaches all nodes in ~log₂(75) ≈ 7 rounds, with 1 message per node per second, instead of all-to-all heartbeats (75 × 74 = 5,550/s). Cassandra uses a phi-accrual detector, a suspicion score instead of a fixed timeout.

## A replica is down for 5 minutes. How do writes still reach 3 copies? {#hld10-hinted-handoff}
Hinted handoff: the coordinator, or the next healthy ring node, stores the write plus a note "belongs to D". When gossip says D is back, it replays the hints and deletes them.
**Why:** W=2 is already met by the other two replicas, and hints restore the third copy.

## What is a sloppy quorum and what does it cost? {#hld10-sloppy-quorum}
Count the first W healthy nodes on the ring even if they are outside the preference list, so writes succeed when two of three replicas are down.
**Trap:** W + R > N no longer guarantees fresh reads until the hint is delivered. That is the AP trade-off. Cassandra stores hints but does not count them toward QUORUM.

## A replica lost its disk or hints expired. How do you re-sync cheaply? {#hld10-merkle}
Merkle-tree repair: hash each bucket of keys, then hash pairs of hashes up to one root. Compare roots between replicas and descend only into branches that differ, then copy just those buckets.
**Why:** a node holds ~4 TB (~4 billion keys), so comparing key by key is far too slow. With ~1M buckets (~4,000 keys each), if 1% differ you copy ~10K buckets × 4K × 1 KB ≈ 40 GB, not 4 TB.
**Example:** the three layers: read-repair (hot keys), hinted handoff (short outages), Merkle repair (everything else).

## Why an LSM tree instead of a B-tree for storage? {#hld10-lsm}
A B-tree updates pages in place, so each write is a random seek. An LSM (log-structured merge) tree turns every write into a sequential append. With 50% writes this wins.
**Why:** write path: append to the commit log (crash recovery only), insert into the in-memory memtable and ack, flush at ~128 MB to an immutable SSTable (sorted file), then compaction (background merging of SSTables, keeping the newest version of each key) shrinks the file count. Used by Cassandra, RocksDB and HBase.

## How does a delete work in an immutable-file store? {#hld10-tombstone}
Write a tombstone, a "deleted at time T" marker. Reads that find it return not found. Compaction drops it only after a grace period (~10 days).
**Trap:** the grace period must exceed the repair interval, or a replica that missed the delete would resurrect the key.

## How does a read find a key on one replica, and what does the bloom filter do? {#hld10-read-path}
Check the memtable, then each SSTable newest first. A bloom filter is a small bit-array that says "definitely not here" or "maybe", so most files are skipped without disk reads. On "maybe", use the SSTable index to read the value; the newest timestamp wins.
**Why:** RAM cost is 4 billion keys × 10 bits (1% false positives) ≈ 5 GB per node, which fits.
**Example:** too many SSTables slow reads, so compaction keeps the count low.

## Why N = 3 replicas, not 2 or 5? {#hld10-why-n3}
With N=3, QUORUM (2) survives one node down while still overlapping. With N=2, quorum is 2, so any failure blocks writes. N=5 needs 500 TB raw (67% more) for rare benefit.

## Give the 30-second pitch for the key-value store. {#hld10-pitch}
A Dynamo-style leaderless store, essentially Cassandra: 100 TB × 3 replicas = 300 TB ÷ 4 TB per node = 75 nodes, ~3.3K ops/s each. Consistent hashing with vnodes, N=3, any node coordinates, AP with W=2, R=2 and last-write-wins.
**Why:** gossip detects failures, hinted handoff covers short outages, Merkle repair fixes drift, and an LSM engine (commit log, memtable, SSTables, bloom filters) makes writes sequential.

## What is read-repair? {#hld10-read-repair}
During a quorum read, if the replicas disagree, the coordinator returns the newest version and writes it back to the stale replica.
**Why:** it heals hot keys for free, with no separate job. Rarely-read keys still need hinted handoff or Merkle repair.
