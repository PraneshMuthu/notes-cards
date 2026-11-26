---
topic: LLD 08 · Mini Twitter
group: LLD
---

## Mini Twitter: what are the entities and who owns what? {#lld08-entities}
`Tweet` (id, author, text, seq, liked_by), `User` (following set, own tweets list), and `TwitterService`, a **Facade** (one front-door class that hides the internals). The service owns all state, validation, the lock and the counter.
**Why:** callers talk to one class, so thread-safety and validation live in one place, not scattered over `User` and `Tweet`.
**Example:** a restaurant waiter. You never walk into the kitchen.

## Why order tweets by a counter, not `time.time()`? {#lld08-monotonic-counter}
Give each tweet `seq = next(counter)`, a number that only goes up (a **monotonic counter**), read inside the lock.
**Why:** two tweets in the same millisecond get the same timestamp, and clocks can jump backwards (the OS syncing its clock with a time server). A counter gives a strict, unique order.
**Bonus:** unique `seq` means the heap never has to compare two `Tweet` objects on a tie.

## How do you build the news feed without sorting everything? {#lld08-k-way-merge}
Each author's list is already sorted. Do a **k-way merge** with a **heap** (a structure that hands back its biggest or smallest item in O(log k)): hold each author's newest tweet, pop the newest, push that author's next-older one, stop after 10 pops.
**Cost:** merge is O(k + 10 log k), k = followees, plus an O(10k) snapshot copy. End to end O(k * limit), independent of total tweets. Sorting the snapshots is the common brute-force answer.
**Example:** 5 bank queues by token: call the smallest front token.

## In `heapq`, how do you get newest-first? {#lld08-heap-negate}
Python's `heapq` is a min-heap (it always hands back its smallest item first), so push `-seq`. Each entry is `(-seq, which_timeline, index_in_it)`.
**Why:** the smallest `-seq` is the largest `seq`, i.e. the newest tweet.
**Example:** seq 9 becomes -9, which is smaller than -4, so it pops first.

## Which pattern sits behind the feed, and what does it replace? {#lld08-strategy}
**Strategy** (swap the algorithm behind one interface): a `FeedStrategy` interface with `ChronologicalMergeStrategy`. `get_news_feed` gathers timelines, then calls `strategy.build_feed(...)`.
**Why:** it replaces an `if feed_type == "ranked" ... elif` ladder in the service. A ranked feed becomes one new class, and the service does not change.
**Example:** Google Maps "fastest or avoid tolls".

## Pull (fanout-on-read) vs push (fanout-on-write): which did you build? {#lld08-pull-vs-push}
**Pull**: tweets are stored once under the author, and the feed is merged when opened. Post is cheap, read is costly. **Push**: on post, copy the tweet into every follower's feed list. Read is cheap, post is costly.
**Why pull here:** single process, no extra storage, and delete/unfollow stay trivially correct. Real Twitter uses a hybrid (push for normal users, pull for celebrities).
**Example:** a celebrity with 10M followers means 10M writes per post under push.

## When would you switch this design to push, and what breaks? {#lld08-switch-to-push}
When reads far outnumber writes and feed latency matters (say users read 100x more than they post). Add an **Observer** (notify subscribers on an event): `post_tweet` notifies each follower's `FeedCache` (that follower's precomputed feed list), which prepends the tweet.
**Trap:** delete and unfollow now have to clean up copies in many feeds.

## Where is the race condition in `get_news_feed`? {#lld08-race}
The feed iterates `user.following` and several tweet lists. A concurrent `follow` raises "Set changed size during iteration"; a concurrent post or delete shifts the list under your indexes. `next(seq)` must also hand out unique numbers.
**Fix:** one service-wide `threading.Lock` that every writer also takes.

## Snapshot under the lock, merge outside: how does that work? {#lld08-snapshot}
Inside the lock: build `{me} | following` (a new set) and copy each author's `tweets[-limit:]` (slices are copies). Release the lock, then merge the copies.
**Why `[-limit:]`:** older tweets can never make the top 10, so copying more is wasted work.
**Why outside:** nobody can mutate what the strategy reads, and the critical section stays short.
**Trap:** merging inside the lock, or reading `following` without it.

## Why one global lock, not one lock per user? {#lld08-one-lock}
A feed touches the user and all followees, so per-user locks means holding many at once. Without a fixed acquisition order, two threads can each hold one lock the other wants (**deadlock**).
**Why:** one lock is obviously correct and the held time is short. If profiling shows contention, use per-user locks with sorted acquisition, or a read-write lock.

## Which feed rules and validations are easy to forget? {#lld08-traps}
- Own tweets must appear in your own feed (`{me} | following`).
- Follow is one-way.
- Self-follow is rejected.
- Text is at most 280 chars and not blank.
- Only the author can delete (`NotAuthorizedError`).
**Trap:** sorting every followee's tweets to show 10.

## 30-second pitch: mini Twitter LLD {#lld08-pitch}
`User`, `Tweet`, and a `TwitterService` facade. Each user keeps a followee set and an append-only tweet list, so it is already sorted. Order comes from a monotonic counter. The feed is pull: a heap-based k-way merge of the newest 10 per author, behind a `FeedStrategy`. One service lock guards writes; the feed only snapshots under it, then merges outside. For read-heavy loads, switch to push via an Observer.

## How does like work, and why is it safe to repeat? {#lld08-like}
`Tweet.liked_by` is a set of user ids, and `like` adds the user id. Liking twice changes nothing, so `like_count` is `len(liked_by)`.
**Why:** a set makes "like once per user" automatic, with no check needed. Follow works the same way (a set of followees).
**Trap:** counting likes in a plain integer, which lets one user like twice.
