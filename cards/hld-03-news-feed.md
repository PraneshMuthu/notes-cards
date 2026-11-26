---
topic: HLD 03 · News Feed
group: HLD
---

## Pitch the news feed design in 30 seconds: say the 4 beats. {#hld03-pitch}
(1) Push each post into followers' Redis timelines by default. (2) Accounts over ~1M followers are not pushed; merge them in at read time. (3) Posts in Cassandra, bodies in a write-through Redis cache. (4) Timelines are a rebuildable cache.
**Why:** pure push dies on one 100M-follower post; pure pull costs ~30× more work. The hybrid (mix of both) is the only option left standing.
**Example:** a newspaper delivers to every subscriber's door, but for the 5 celebrity columnists you pick up their page at the kiosk when you open the paper.
**Trap:** grade Got it only if you said all 4 beats.

## News feed: which three "may I…?" questions to the interviewer made the design simpler? {#hld03-spec}
(1) May a timeline be a capped, rebuildable copy? (2) May a new follow skip old posts? (3) May deletes be filtered at read time?
**Why:** each "yes" deletes a subsystem: no timeline backups, no backfill job, no un-fanout (removing one post from 100M lists). Asking is cheaper than building.
**Example:** asking a caterer "can the menu be fixed?" before you price a 500-guest buffet.

## News feed: from 200M DAU, 10 opens/day and 100M posts/day, derive peak read and write rate. {#hld03-spec-load}
Reads ≈ 23k/s, ~70k/s at 3× peak. Writes ≈ 1,200/s, ~3,500/s at peak. Read:write ≈ 20:1.
**Why:** DAU (daily active users) × opens ÷ 86,400 s gives the average; peak is ~3×. The 20:1 ratio is what makes "do the work at write time" (push) attractive.
**Example:** 200M × 10 = 2B opens/day ÷ ~10⁵ s ≈ 23k/s; 100M posts ÷ 10⁵ ≈ 1,200/s.

## News feed: 23k opens/s, 1,200 posts/s, median 100 followers, median 200 follows. Push or pull, by how much? {#hld03-push-vs-pull}
Push, by ~30×: push ≈ 145k ops/s, pull ≈ 4.6M ops/s.
**Why:** push (copy each post into every follower's list) pays N followers on the rare side, writes. Pull (gather from everyone you follow at read time) pays M follows on the frequent side, reads.
**Example:** push = 23k reads + 1,200 × 100 writes ≈ 145k; pull = 23k × 200 = 4.6M.
**Trap:** 100 followers is a floor; big accounts post more often, so real push cost is higher.

## News feed: timelines hold only post IDs. What extra work does every open do, and how big is it at 70k opens/s? {#hld03-hydration}
One MGET (fetch many keys in one call) of 50 post bodies from the post cache: 70k × 50 = 3.5M ops/s, the largest Redis fleet (~55 nodes).
**Why:** a list of IDs is useless until "hydrated" (each ID swapped for its post body), so every page read multiplies by page size.
**Example:** a library catalogue gives you 50 shelf numbers; you still have to walk to the shelves to get the books.

## News feed: why not store the full post body inside every follower's timeline? {#hld03-ids-not-bodies}
Because fanout would copy the body N times, and an edit or delete would have to touch every copy.
**Why:** an 8-byte ID per follower is cheap to copy; a ~350 B body × 100M followers is not. One shared body means one place to edit or delete.
**Example:** a WhatsApp group forwards a link to a Google Doc, not 200 copies of the document; fix the doc once and everyone sees it.

## News feed: a 100M-follower account posts. Can pure push land it in every timeline within 5 s? {#hld03-skew}
No. 15M writes (15% of followers active) in 5 s need 3M ops/s; the Redis fleet has only ~1.2M ops/s spare. Short by ~2.5×.
**Why:** the burst is one indivisible job with a deadline. On a daily average celebrities add only ~20% to fanout, so averages hide the problem.
**Example:** spare = 25 nodes × 100k ops/s = 2.5M raw, × 65% safe utilisation ≈ 1.6M, − 0.42M normal traffic ≈ 1.2M.

## News feed: how do you derive the celebrity threshold T instead of guessing "1 million"? {#hld03-threshold}
T ≤ (fanout budget ops/s × seconds allowed) ÷ active fraction = 60k × 4 ÷ 0.15 ≈ 1.6M. Pick T = 1M, below that ceiling.
**Why:** a pushed post must land inside the staleness deadline without starving normal traffic. 60k = 5% of the 1.2M spare (a policy knob); 4 s = 5 s minus ~1 s queue lag. T is runtime config, not a constant.
**Example:** a lift rated 640 kg carries 8 people because 640 ÷ 80 = 8, not because 8 "feels right".
**Trap:** there is also a floor (~500k): set T too low and every read must merge hundreds of pulled accounts.

## News feed: walk through what happens when someone posts. Say the 4 beats. {#hld03-write-path}
(1) Write the post to Cassandra (durable). (2) SET the body in the post cache. (3) LPUSH (add to list head) the ID into the author's own timeline. (4) Enqueue one fanout job, return 201 in ~14 ms.
**Why:** a 150k-follower fanout takes seconds, so it cannot run inside the request. The queue lets the worker push to followers if they are under T, and skip celebrities.
**Example:** a restaurant takes your order and gives a token at once; the kitchen cooks after you have sat down.
**Trap:** grade Got it only if you said all 4 beats.

## News feed: the fanout queue carries one message per post, ~3,500/s at peak. SQS or Kafka? {#hld03-queue}
Either works; SQS is enough. Kafka's only extra is replay (re-reading old messages), useful if you ever rebuild timelines from the log.
**Why:** 3,500 msg/s is tiny for both. Pick by features, not throughput: the queue holds one job per post, not one per follower.
**Example:** a post with 1M followers is still 1 message; the worker turns it into 150k Redis writes.

## News feed: how do you split the 5 s staleness budget, and which metric do you alarm on? {#hld03-staleness-budget}
~1 s for the job to wait in the queue, ~4 s for the worker to fan it out. Alarm on queue lag (age of the oldest waiting job).
**Why:** staleness (delay before followers see a post) is lag plus execution time. Enqueue rate can look normal while workers fall behind; lag shows the user-visible delay directly.
**Example:** at a ration shop the queue length matters less than "how long has the person at the back been waiting?".

## News feed: why must the post cache be write-through, not filled on first miss? {#hld03-write-through}
A new post is the most-read object for its first minutes. Filling on miss makes thousands of readers miss together and all hit one Cassandra partition.
**Why:** write-through (SET the cache at post time) costs one write on a 3,500/s path and removes this stampede (many simultaneous misses on one key) entirely.
**Example:** a shop launches a hot phone with an empty shelf, so thousands queue at the storeroom door at once.

## News feed: walk through a timeline open. Say the 4 beats. {#hld03-read-path}
(1) LRANGE (read a slice of a list) your timeline, 60 IDs. (2) LRANGE ~10 celebrity lists you follow. (3) Merge by ID, keep the top 50. (4) MGET the 50 bodies and drop deleted ones.
**Why:** ~12 round trips (~16 ms at p99, the slowest 1%) against a 100 ms budget, because only the few celebrities are pulled, not all 200 follows.
**Example:** a newspaper on your doorstep plus 10 columns picked up at the kiosk, sorted together by date.
**Trap:** grade Got it only if you said all 4 beats.

## News feed: fanout is async (up to 5 s), yet your own post must appear instantly. How? {#hld03-frs}
Before returning 201, synchronously LPUSH the post ID into the author's own timeline. The queue handles everyone else.
**Why:** one extra Redis write (~1 ms) gives read-your-writes (you always see your own changes) to the one person who checks immediately.
**Example:** you post, refresh at once, and see it, while friends get it a few seconds later.

## News feed: a post whose ID sits in 100M timelines is deleted. How do you remove it? {#hld03-frs-delete}
Don't touch the timelines. Delete the post row; at read time hydration finds no body and drops the ID. Over-fetch 60 IDs to still return 50.
**Why:** un-fanning-out is up to 100M writes for a rare event. Filtering at read time costs a few spare IDs per page.
**Example:** a library removes a book but leaves old catalogue cards; a missing book is simply skipped.

## News feed: you follow someone new. What work happens, and why is that enough? {#hld03-frs-follow}
Nothing at follow time. Their future posts reach you by fanout, or by the read-time merge if they are a celebrity.
**Why:** backfilling old posts is a burst of writes per follow for content the interviewer said nobody needs.
**Example:** subscribing to a newspaper gets you tomorrow's edition, not last month's.

## News feed: celebrities are pulled at read time. What load does that move, and to where? {#hld03-celebrity-reads}
It moves the hot key from writes to reads: 70k opens/s × ~10 celebrity lists = 700k Redis reads/s, 10× the planned read load.
**Why:** a carve-out relocates load, it doesn't delete it. That extra read load eats the spare capacity, so the threshold's ceiling drops from ~1.6M to ~667k, below the T = 1M chosen.
**Example:** closing a crowded front gate just moves the crowd to the side gate.

## News feed: 700k reads/s hit ~1,000 celebrity lists. What fix makes Redis load independent of traffic? {#hld03-celebrity-cache}
A 2 s in-process cache (in the app server's own memory) of all ~1,000 celebrity lists on every app box.
**Why:** load becomes boxes × keys ÷ TTL, not requests: 70 × 1,000 ÷ 2 s = 35k ops/s, a 20× cut, and still 35k at 10× traffic. 2 s is inside the 5 s staleness budget.
**Example:** each office floor keeps today's newspaper on a table instead of every employee phoning the newsagent.
**Trap:** replicating the hot keys across more Redis nodes spreads the 700k but still pays it.

## News feed: why are timelines Redis lists, not sorted sets? {#hld03-list-vs-zset}
Lists cost ~16 B per entry vs ~70 B for a sorted set, and the timeline tier is RAM-bound: 1.6 TB would become ~7 TB (25 nodes → ~110).
**Why:** a sorted set would make duplicate fanout deliveries harmless, but you can drop duplicates free during the read merge. Above 128 entries a sorted set leaves Redis's compact encoding, hence the 4×.
**Example:** a queue at fanout redelivers post 981 twice; the merge sees 981, 981 and keeps one.

## News feed: from 200M DAU × 500 IDs × 16 B, size the timeline Redis tier. How many nodes? {#hld03-timeline-size}
1.6 TB ÷ 64 GB per node = 25 nodes. Sized by ops (420k ÷ 100k) it would be only ~8, so provision 25: the tier is RAM-bound.
**Why:** provisioning by the smaller number under-provisions the real limit 3×.
**Example:** 200M × 500 × 16 B = 1.6 × 10¹² B = 1.6 TB.
**Trap:** count DAU, not registered users; inactive users need no timeline in RAM.

## News feed: timelines are RAM-bound. Can you size the post cache and Cassandra the same way? {#hld03-binding}
No: each tier has its own binding constraint. Post cache is ops-bound (55 nodes, only ~135 GB); Cassandra is disk-bound (130 nodes for 3,500 writes/s).
**Why:** a tier needs max(nodes by ops, nodes by RAM, nodes by disk). Compute all, provision the largest, and say which one binds.
**Example:** a moving truck: 10 boxes fit by weight but only 6 by volume, so you need the bigger truck.

## News feed: why cap a Redis node near 64 GB and a Cassandra node near 1.5 TB, even if bigger machines exist? {#hld03-binding-node-size}
Node size is a recovery budget: a dead node must be rebuilt fast. 64 GB copies over 10 Gbps in ~1 min; 1.5 TB re-streams in ~2 h.
**Why:** a bigger node means a longer window with one copy fewer after a failure. Cassandra re-streams at only ~200 MB/s, so its budget in bytes is larger but its window longer.
**Example:** one giant warehouse burns down and takes a month to restock; ten small ones each take a few days.

## News feed: one account has 100M followers. How do you store its follower list in Cassandra? {#hld03-followers-bucket}
Split it into buckets: partition key `(followee_id, bucket)`, with `bucket_count = ceil(followers ÷ 100,000)`. Clustering key `follower_id`.
**Why:** one partition (the rows stored together on one node) would be ~5 GB against ~100 MB guidance; it hurts compaction (background merge of files) and repair. Sorting by follower ID lets a crashed fanout resume from the last ID.
**Example:** a phone book split into volumes A–F, G–M… instead of one 50 kg book.

## News feed: why store each follow edge twice, in `follows` and in `followers`? {#hld03-follow-edge-twice}
Cassandra looks rows up only by partition key: "who do I follow?" needs user as the key, "who follows me?" needs followee as the key.
**Why:** a table can be partitioned one way. Dual-write both; if they drift, the cost is a missed fanout (one post not pushed), not lost data.
**Example:** a school keeps a register per class and a timetable per teacher: the same facts, filed by two keys.

## News feed: 100M posts/day × 350 B. Cassandra or Postgres for posts? {#hld03-cassandra}
Cassandra: storage decides. 35 GB/day × 3 copies × 5 years ≈ 190 TB ≈ 130 nodes, while 3,500 writes/s need about one.
**Why:** Postgres would have to be hand-sharded across 100+ machines. Cassandra spreads data by key and handles append-only writes well (LSM tree: buffer in memory, flush sorted files).
**Example:** at 10M posts/day (~1.3 TB/year) one Postgres box is fine; "NoSQL because it scales" is not a reason.

## News feed: a timeline Redis node dies and its replica is lost too. How do you rebuild 8M timelines? {#hld03-node-death}
Lazily, on each user's next open, using the pull path: read their follows, fetch recent posts, merge, write back.
**Why:** an eager rebuild is 1.6B Cassandra reads, ~20 min of the whole fleet. Lazy is ~2,800 misses/s × 200 = 560k reads/s, under half of Cassandra's capacity.
**Example:** after a power cut a shop restocks each shelf when the first customer asks, not the whole store overnight.

## News feed: with ~1B registered users but 200M daily active, what fanout work is wasted, and how do you cut it? {#hld03-inactive}
~80% of fanout writes go to people who won't open the app. Skip followers unseen for ~7 days: peak fanout falls 350k → ~70k ops/s.
**Why:** a flag or Bloom filter (compact "seen recently?" set) answers per follower. A returning user just misses and takes the lazy-rebuild path, which already exists. A wrong "active" answer only wastes one write.
**Example:** a newspaper stops delivering to a house that hasn't taken in its paper for a week; restart when they call.

## News feed: new posts keep arriving while you scroll. Cursor or offset pagination, and why? {#hld03-pagination}
Cursor: `GET /timeline?cursor=<last_post_id>&limit=50` returns posts older than that ID.
**Why:** the feed changes under the reader. With `offset=50`, new posts push everything down and page 2 repeats items. Post IDs are Snowflake (time-ordered), so "older than this ID" is "older than this time".
**Example:** 3 new posts arrive while you read page 1; offset 50 now starts at your old item 48, showing 3 repeats.

## News feed at 10× (2B users): what breaks first? {#hld03-10x}
Geography, not capacity. Users are global and a cross-region round trip (~100 ms) spends the whole latency budget. Fix: regional read copies, writes homed to one region.
**Why:** every tier scales by adding nodes (timelines 250, post cache 550, Cassandra 1,300), and spare fanout grows too, so T can even rise.
**Example:** a Mumbai user reading from a US-only cluster waits ~200 ms before any work starts.
