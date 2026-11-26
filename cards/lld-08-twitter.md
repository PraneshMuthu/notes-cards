---
topic: LLD 08 · Twitter / Spotify
group: LLD
---

## Mini Twitter: what are the entities and who owns what? {#lld08-entities}
`Tweet` (id, author, text, seq, liked_by), `User` (following set, own tweets list), and `TwitterService`, a **Facade** (one front-door class that hides the internals). The service owns all state, validation, the lock and the counter.
**Why:** callers talk to one class, so thread-safety and validation live in one place, not scattered over `User` and `Tweet`.
**Example:** a restaurant waiter. You never walk into the kitchen.

## Why order tweets by a counter, not `time.time()`? {#lld08-monotonic-counter}
Give each tweet `seq = next(counter)`, a number that only goes up (a **monotonic counter**), read inside the lock.
**Why:** two tweets in the same millisecond get the same timestamp, and clocks can jump backwards (NTP correction). A counter gives a strict, unique order.
**Trap:** unique `seq` also means the heap never has to compare two `Tweet` objects on a tie.

## How do you build the news feed without sorting everything? {#lld08-k-way-merge}
Each author's tweet list is already sorted (append-only). Do a **k-way merge** with a heap: hold only each author's newest tweet, pop the newest, push that author's next-older one, stop after 10 pops.
**Why:** sorting is O(N log N) over all tweets; the merge is O(k + 10 log k), k = number of followees.
**Example:** 5 bank queues ordered by token. Call the smallest front token, then that queue steps forward.

## In `heapq`, how do you get newest-first? {#lld08-heap-negate}
Python's `heapq` is a min-heap, so push `-seq`. Each entry is `(-seq, which_timeline, index_in_it)`.
**Why:** the smallest `-seq` is the largest `seq`, i.e. the newest tweet.
**Example:** seq 9 becomes -9, which is smaller than -4, so it pops first.

## Which pattern sits behind the feed, and what does it replace? {#lld08-strategy}
**Strategy**: a `FeedStrategy` interface with `ChronologicalMergeStrategy`. `get_news_feed` gathers timelines, then calls `strategy.build_feed(...)`.
**Why:** it replaces an `if feed_type == "ranked" ... elif` ladder in the service. A ranked feed becomes one new class, and the service does not change.
**Example:** Google Maps "fastest or avoid tolls": same trip, swappable way of computing it.

## Pull (fanout-on-read) vs push (fanout-on-write): which did you build? {#lld08-pull-vs-push}
**Pull**: tweets are stored once under the author, and the feed is merged when opened. Post is cheap, read is costly. **Push**: on post, copy the tweet into every follower's feed list. Read is cheap, post is costly.
**Why pull here:** single process, no extra storage, and delete/unfollow stay trivially correct. Real Twitter uses a hybrid (push for normal users, pull for celebrities).
**Example:** a celebrity with 10M followers means 10M writes per post under push.

## When would you switch this design to push, and what breaks? {#lld08-switch-to-push}
When reads far outnumber writes and feed latency matters (say users read 100x more than they post). Add an **Observer** (notify subscribers on an event): `post_tweet` notifies each follower's `FeedCache`, which prepends the tweet.
**Trap:** delete and unfollow now have to clean up copies in many feeds.

## Where is the race condition in `get_news_feed`? {#lld08-race}
The feed iterates `user.following` and several tweet lists. A concurrent `follow` raises "Set changed size during iteration"; a concurrent post or delete shifts the list under your indexes. `next(seq)` must also hand out unique numbers.
**Fix:** one service-wide `threading.Lock` that every writer also takes.

## Snapshot under the lock, merge outside: how does that work? {#lld08-snapshot}
Inside the lock: build `{me} | following` (a new set) and copy each author's `tweets[-limit:]` (slices are copies). Release the lock, then run the heap merge on the copies.
**Why:** nobody can mutate what the strategy is reading, and the critical section stays short.
**Trap:** running the whole merge inside the lock, or reading `following` without it.

## Why one global lock, not one lock per user? {#lld08-one-lock}
A feed touches the user and all followees, so per-user locks means holding many at once. Without a fixed acquisition order, two threads can each hold one lock the other wants (**deadlock**).
**Why:** one lock is obviously correct and the held time is short. If profiling shows contention, use per-user locks with sorted acquisition, or a read-write lock.

## Which feed rules and validations are easy to forget? {#lld08-traps}
- Own tweets must appear in your own feed (`{me} | following`).
- Reject self-follow (follow is one-way).
- Text is at most 280 chars and not blank.
- Only the author can delete (`NotAuthorizedError`).
- Follow and like use sets, so repeating them is harmless.
**Trap:** sorting every followee's tweets to show 10.

## 30-second pitch: mini Twitter LLD {#lld08-pitch}
`User`, `Tweet`, and a `TwitterService` facade. Each user keeps a followee set and an append-only tweet list, so it is already sorted. Order comes from a monotonic counter. The feed is pull: a heap-based k-way merge of the newest 10 per author, behind a `FeedStrategy`. One service lock guards writes; the feed only snapshots under it, then merges outside. For read-heavy loads, switch to push via an Observer.
