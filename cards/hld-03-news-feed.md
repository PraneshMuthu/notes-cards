---
topic: HLD 03 · News Feed
group: HLD
---

## Pitch the news feed in 30 seconds. {#hld03-pitch}
Hybrid fanout: push each post into followers' Redis timelines (lists of post IDs) by default; accounts above ~1M followers are not pushed and are merged in at read time. Posts live in Cassandra, bodies in a write-through Redis post cache, and a 2 s in-process cache of celebrity lists protects Redis. Timelines are a rebuildable cache.
**Why:** pure push dies on one 100M-follower post; pure pull costs ~30x more.

## What numbers define the news feed problem? {#hld03-spec}
200M DAU, 100M posts/day, 10 timeline opens/user/day, peak 3x. Follows: median 200 (max 50k). Followers: median 100, p99 10k, max 100M; ~1,000 accounts over 1M, ~15% daily active. Staleness ~5 s (30 s at peak), your own post immediate. Timeline p99 <= 100 ms. Reverse-chron.
**Why:** the problem turns on the read:write ratio and the follower distribution, not on any mean.

## Which Stage 1 questions are "permission" questions, and what did they buy? {#hld03-permissions}
Can a timeline be a sample (cap it), be rebuilt from posts (so it is a cache, no backups), skip back-catalogue on follow, and filter deletes at read time?
**Why:** a generous answer deletes work you would otherwise design around. "Rebuildable?" removed durability and a restore runbook for 1.6 TB of RAM.
**Trap:** the owner never asked availability or "how many celebrities does a user follow".

## Load and read:write ratio for the feed? {#hld03-load}
Opens: 200M x 10 / 86,400 = 23k QPS avg, x3 = 70k peak. Posts: 100M / 86,400 = 1,200 avg, 3,500 peak. Ratio is ~20:1, read-heavy.
**Why:** it only puts precompute on the table. Whether push wins depends on per-write cost (amplification).

## Push vs pull: what is the amplification, and who wins? {#hld03-push-vs-pull}
Push: read 1, write N (followers). Pull: read M (follows), write 1. At the median: push 23k + 1,200 x 100 = ~145k ops/s; pull 23k x 200 = ~4.6M ops/s.
**Why:** pull is ~30x more work. You pay M on the frequent side instead of N on the rare side.
**Trap:** 100 is a floor; power-law accounts post more, so push's real cost is higher.

## Why does a timeline open cost 1 + 50 and not 1? {#hld03-hydration}
The timeline stores post IDs, so 50 bodies must be fetched (MGET from the post cache). That second amplification makes hydration 70k x 50 = 3.5M ops/s, the biggest fleet (~55 Redis nodes).
**Why IDs:** storing bodies in every timeline multiplies storage by fan-out and breaks delete and edit.

## Why does pure push fail, and what does the average hide? {#hld03-skew}
One 100M-follower post = 15M writes (15% active). To land in 5 s you need 3M ops/s; spare fleet capacity is ~1.2M, so it is short by ~2.5x.
**Why:** celebrities add only ~20% to daily fanout on average (26k/s vs 116k/s), so averaging hides it. Skew is a burst problem: indivisible and deadline-bound.

## How do you derive the celebrity threshold T? {#hld03-threshold}
Ceiling: 5% of 1.2M spare = 60k ops/s x 4 s (5 s minus 1 s queue) = 240k writes / 0.15 active = T <= ~1.6M. Floor: T >= ~500k keeps the pulled set small. Chose T = 1M: 150k writes / 5 s = 30k ops/s = 2.5% of spare.
**Why:** the 5% is a policy knob. T is runtime config, not a constant.
**Trap:** the "~10 celebrities per user" figure is an assumption.

## Walk through the post write path. {#hld03-write-path}
1. Write Cassandra (durable, ~10 ms).
2. SET the body in the post cache (write-through).
3. LPUSH to the author's own timeline.
4. Enqueue one fanout job.
5. Return 201 (~14 ms).
Async worker: if followers < T, LPUSH to each and LTRIM to 500; else do nothing.
**Why:** the median post (100 writes) could be sync, but a near-T post (150k writes, ~4 s) cannot. The queue makes a threshold possible.

## Why is the post cache write-through? {#hld03-write-through}
A new post is the most-read object in the system. Lazy loading makes the first wave of readers all miss on the same key at once: a thundering herd on one Cassandra partition.
**Why:** one SET on a 3,500 QPS path removes the failure mode.
**Example:** a shop opening a hot product with an empty shelf, while thousands queue at the storeroom door.

## Walk through the timeline read path. {#hld03-read-path}
1. LRANGE own timeline (60 IDs, over-fetch).
2. LRANGE ~10 celebrity lists.
3. Merge by Snowflake ID, take the top 50 (local).
4. MGET 50 bodies.
5. Drop deleted ones.
About 12 round trips, ~16 ms p99 against a 100 ms budget.
**Why:** 12, not 200, because only the exempt tail is pulled. Latency eliminates nothing here; skew does.

## How do read-your-writes, follow, and delete work? {#hld03-frs}
- Own post: synchronous LPUSH into your own timeline before returning; the queue handles everyone else.
- Follow: nothing for push; pull backfills automatically.
- Delete: delete in Cassandra only. Hydration returns empty and is dropped, so fetch 60 to return 50.
**Why:** never un-fan-out 100M lists.

## What is the hybrid's hidden cost, and the fix? {#hld03-celebrity-reads}
It moves the hot key from write to read. 70k opens/s x ~10 celebrity lists = 700k ops/s, 10x the planned read load, and the threshold's ceiling collapses to ~667k.
**Fix:** a 2 s in-process cache of the ~1,000 celebrity lists on each app box: 70 boxes x 1,000 keys / 2 s = 35k ops/s (20x cut), ~480 KB per box.
**Why:** it makes Redis load independent of request rate. A carve-out relocates load; price the side you moved it to.

## Why lists, not sorted sets, for timelines? {#hld03-list-vs-zset}
A sorted set makes redelivered fanout idempotent, but costs ~70 B/entry vs ~16 B (500 entries exceed the 128 listpack threshold): 1.6 TB becomes ~7 TB, 25 nodes become ~110.
**Why:** the timeline tier is RAM-bound, so it is the worst place to spend 4x. Dedup during the read merge instead, which is free.

## Why is the followers table bucketed? {#hld03-followers-bucket}
Partition key `(followee_id, bucket)`, clustering key `follower_id`. A 100M-follower account would be ~5 GB in one partition (guidance: ~100 MB). Reads are fine, since only the worker reads it and only below T; the damage is compaction, repair, bootstrap and heap.
**Fix:** `shard_count = ceil(followers / 100,000)`, a field on the user row. The clustering key also makes fanout resumable from the last `follower_id`.

## Why store the follow edge twice? {#hld03-follow-twice}
Cassandra queries only by partition key, so "who do I follow" (fan-in) and "who follows me" (fan-out) need different partition keys: `follows` and `followers`.
**Why:** denormalising is the model, not a smell. Drift means a missed fanout, not lost data, since `posts` is the truth and timelines are rebuildable.

## Why Cassandra for posts, and when would Postgres do? {#hld03-cassandra}
Storage decides: 35 GB/day x RF 3 x 5 years is ~190 TB, ~130 nodes at 1.5 TB each, while throughput needs about 1 node. Postgres would have to be hand-sharded.
**Why:** writes are append-only (LSM-friendly). At 10M posts/day (1.3 TB/yr), Postgres is right. DynamoDB is also fine. "NoSQL because it scales" is not a reason.

## Ops and bytes disagreed at every tier. What bound each? {#hld03-binding}
Timeline index: ops 8 nodes, RAM 1.6 TB / 64 GB = 25 nodes (RAM-bound). Post cache: ops 55 nodes, RAM ~135 GB (op-bound). Cassandra: ops 1 node, storage 130 nodes (storage-bound).
**Why:** compute both and say which wins, or you under-provision by 3x.
**Rule:** each per-node divisor (64 GB, 1.5 TB) is a recovery-time budget in disguise.

## A timeline Redis node dies. What now? {#hld03-node-death}
8M users' timelines vanish (1/25th). Rebuild lazily on miss using the pull path: read follows, fetch recent posts, merge, write back. ~2,800 misses/s x 200 fetches = 560k Cassandra reads/s, ratio 0.43.
**Why not eager:** 1.6B reads is ~20 minutes of the whole Cassandra fleet. Recovery is code that already runs on every celebrity read.

## What fanout work is done for nobody, and how do you cut it? {#hld03-inactive}
With ~1B registered vs 200M DAU, ~80% of fanout writes are never read. Skip inactive followers with an `active_recently` flag or a bloom filter (seen in ~7 days): 350k to ~70k ops/s.
**Why:** a lapsed user returning takes a miss and uses the lazy rebuild path. A false positive only wastes a write.
**Trap:** apply the discount everywhere, not just to celebrities.

## Cursor or offset pagination for a feed? {#hld03-pagination}
Cursor: `GET /v1/timeline?cursor=<snowflake_id>&limit=50`, meaning everything older than this ID.
**Why:** the feed changes under the reader. With `offset=50`, new posts shift everything down and page 2 repeats items. Snowflake IDs are time-sortable, so the cursor is free (and ordering and merging are too).

## What breaks first at 10x for the feed? {#hld03-10x}
Not capacity: timelines (250 nodes), post cache (550), Cassandra (1,300) all scale linearly, and spare fanout capacity rises, so T can go up. Geography breaks first: a cross-region round trip (~100 ms) spends the whole budget.
**Fix:** regional read replicas, writes homed to one region. Runner-up: cost. The first lever is the 500-entry cap.

## What weak spots do you name in the news feed? {#hld03-weak-spots}
1. "~10 celebrities per user" was never verified; 200 gives 200 reads, so cap merge width.
2. Availability was never asked (reads matter more than writes).
3. The 500-entry cap is unjustified.
4. T is one global constant, but 1.1M and 100M followers cost 100x apart.
5. Crossing T is a live migration; let old pushed posts age out.
