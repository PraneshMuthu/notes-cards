---
topic: HLD 03 · News Feed
group: HLD
---

## Pitch the news feed in 30 seconds. {#hld03-pitch}
Hybrid fanout (copying one post to many followers' lists): push each post into followers' Redis timelines (lists of post IDs) by default; accounts above ~1M followers are not pushed and are merged in at read time. Posts live in Cassandra, bodies in a write-through Redis post cache, and a 2 s in-process cache of celebrity lists protects Redis. Timelines are a rebuildable cache.
**Why:** pure push dies on one 100M-follower post; pure pull costs ~30x more.

## What numbers define the news feed problem? {#hld03-spec}
200M DAU (daily active users), 100M posts/day, 10 timeline opens/user/day, peak 3x. Follows: median 200 (max 50k). Followers: median 100, p99 10k, max 100M; ~1,000 accounts over 1M, ~15% daily active. Staleness ~5 s (30 s at peak), your own post immediate. p99 <= 100 ms. Reverse-chron.
**Permission questions that bought simplicity:** a timeline may be a capped sample and is rebuildable from posts (so a cache, no backups); no back-catalogue on follow; deletes filtered at read time.
**Trap:** availability and "celebrities per user" were never asked.

## Push vs pull: what is the load and amplification, and who wins? {#hld03-push-vs-pull}
Load: opens 200M x 10 / 86,400 = 23k QPS (x3 = 70k peak); posts 1,200 (3,500 peak); ratio ~20:1. Push: read 1, write N (followers). Pull: read M (follows), write 1. At the median: push 23k + 1,200 x 100 = ~145k ops/s; pull 23k x 200 = ~4.6M ops/s.
**Why:** pull is ~30x more work: you pay M on the frequent side instead of N on the rare side.
**Trap:** 100 is a floor; power-law accounts post more, so push costs more.

## Why does a timeline open cost 1 + 50 and not 1? {#hld03-hydration}
The timeline stores post IDs, so 50 bodies must be fetched with one MGET (multi-get) from the post cache. That second amplification makes hydration 70k x 50 = 3.5M ops/s, the biggest fleet (~55 Redis nodes).
**Why IDs:** storing bodies in every timeline multiplies storage by fan-out and breaks delete and edit.

## Why does pure push fail, and what does the average hide? {#hld03-skew}
One 100M-follower post = 15M writes (15% active). To land in 5 s you need 3M ops/s. Spare capacity: 25 nodes x 100k = 2.5M, x 65% target = 1.6M, minus 0.42M normal traffic = ~1.2M. Short by ~2.5x.
**Why:** celebrities add only ~20% to daily fanout (26k/s vs 116k/s), so averages hide it. Skew is a burst problem: indivisible and deadline-bound.

## How do you derive the celebrity threshold T? {#hld03-threshold}
Ceiling: 5% of 1.2M spare = 60k ops/s x 4 s (5 s minus 1 s queue lag) = 240k writes / 0.15 active = T <= ~1.6M. Floor: T >= ~500k keeps the pulled set small. Chose T = 1M: 150k writes / 4 s = 37,500 ops/s = 3.1% of spare.
**Why:** the 5% is a policy knob. T is runtime config, not a constant.
**Trap:** "~10 celebrities per user" is an assumption.

## Walk through the post write path. {#hld03-write-path}
1. Write Cassandra (durable, ~10 ms).
2. SET the body in the post cache (write-through).
3. LPUSH (push to the head of a list) to the author's own timeline.
4. Enqueue one fanout job.
5. Return 201 (~14 ms).
Async worker: if followers < T, LPUSH to each and LTRIM (cut) to 500; else nothing.
**Why:** a near-T post (150k writes, ~4 s) cannot run in a request. The queue makes a threshold possible.

## Which queue, and how is the 5 s staleness budget split? {#hld03-queue}
The queue carries one message per post: 3,500 msg/s. So SQS is enough; Kafka's only edge is replay (rebuilding timelines). Budget: ~2 ms enqueue + 1 s queue lag + 4 s fanout execution. Alarm on queue lag, not enqueue rate.
**Why:** delivery is at-least-once, so a post can land twice; dedup in the read merge (free). Order does not matter because Snowflake IDs (time-prefixed unique IDs) sort by time.

## Why is the post cache write-through? {#hld03-write-through}
A new post is the most-read object in the system. Lazy loading makes the first wave of readers all miss on the same key at once: a thundering herd on one Cassandra partition.
**Why:** one SET on a 3,500 QPS path removes the failure mode.
**Example:** a shop opening a hot product with an empty shelf, while thousands queue at the storeroom door.

## Walk through the timeline read path. {#hld03-read-path}
1. LRANGE (read a slice of a list) own timeline, 60 IDs (over-fetch).
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
A sorted set makes redelivered fanout idempotent, but costs ~70 B/entry vs ~16 B (500 entries exceed the 128-entry listpack threshold, the compact encoding): 1.6 TB becomes ~7 TB, 25 nodes become ~110.
**Why:** the timeline tier is RAM-bound, so it is the worst place to spend 4x. Dedup during the read merge instead, which is free.

## Size the timeline Redis tier. {#hld03-timeline-size}
200M DAU x 500 IDs x 16 B = 1.6 TB; at 64 GB/node that is 25 nodes by RAM, versus 420k ops/s / 100k = ~8 by ops.
**Why:** it is RAM-bound, so sizing by ops under-provisions 3x. Knobs: shrink the cap (200 IDs = 640 GB) or materialise only for recently active users (count DAU, not total users).

## Why is the followers table bucketed, and why store the follow edge twice? {#hld03-followers-bucket}
PK (partition key: which drawer) is `(followee_id, bucket)`; CK (clustering key: order of folders inside) is `follower_id`, which makes fanout resumable. A 100M-follower account would be ~5 GB in one partition (guidance ~100 MB): damage is compaction (background merging), repair and heap, not reads. Fix: `shard_count = ceil(followers / 100,000)`.
**Twice:** `follows` and `followers` need different partition keys; drift means a missed fanout, not lost data.

## Why Cassandra for posts, and when would Postgres do? {#hld03-cassandra}
Storage decides: 35 GB/day x RF 3 (3 copies) x 5 years is ~190 TB, ~130 nodes at 1.5 TB each, while throughput needs about 1 node. Postgres would have to be hand-sharded.
**Why:** writes are append-only (LSM tree: write to memory, flush sorted files). At 10M posts/day (1.3 TB/yr), Postgres is right. "NoSQL because it scales" is not a reason.

## Ops and bytes disagreed at every tier. What bound each? {#hld03-binding}
Timeline index: ops 8 nodes, RAM 25 (RAM-bound). Post cache: ops 55, RAM ~135 GB (op-bound). Cassandra: ops 1, storage 130 (storage-bound). Compute both, say which wins.
**Why per-node sizes are recovery budgets:** Redis 60 s x 1.25 GB/s (10 Gbps NIC) = ~75 GB, rounded to 64 GB. Cassandra: re-streaming 1 TB / 200 MB/s = ~1.5 h, so ~1.5 TB/node.

## A timeline Redis node dies. What now? {#hld03-node-death}
8M users' timelines vanish (1/25th). Rebuild lazily on miss using the pull path: read follows, fetch recent posts, merge, write back. ~2,800 misses/s x 200 fetches = 560k Cassandra reads/s, ratio 0.43.
**Why not eager:** 1.6B reads is ~20 minutes of the whole Cassandra fleet. Recovery is code that already runs on every celebrity read.

## What fanout work is done for nobody, and how do you cut it? {#hld03-inactive}
With ~1B registered vs 200M DAU, ~80% of fanout writes are never read. Skip inactive followers with an `active_recently` flag or a bloom filter (seen in ~7 days): peak fanout 350k (3,500 posts/s x 100) falls to ~70k ops/s.
**Why:** a lapsed user returning takes a miss and uses the lazy rebuild path. A false positive only wastes a write.
**Trap:** apply the discount everywhere, not just to celebrities.

## Cursor or offset pagination for a feed? {#hld03-pagination}
Cursor: `GET /v1/timeline?cursor=<snowflake_id>&limit=50`, meaning everything older than this ID.
**Why:** the feed changes under the reader. With `offset=50`, new posts shift everything down and page 2 repeats items. Snowflake IDs (time-prefixed unique IDs) are time-sortable, so the cursor is free (and ordering and merging are too).

## What breaks first at 10x for the feed? {#hld03-10x}
Not capacity: timelines (250 nodes), post cache (550), Cassandra (1,300) all scale linearly, and spare fanout capacity rises, so T can go up. Geography breaks first: a cross-region round trip (~100 ms) spends the whole budget.
**Fix:** regional read replicas, writes homed to one region. Runner-up: cost. The first lever is the 500-entry cap.
