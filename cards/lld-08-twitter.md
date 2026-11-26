---
topic: LLD 08 · Mini Twitter
group: LLD
---

## Mini Twitter: why put all state, validation, the lock and the counter in one `TwitterService` instead of on `User` and `Tweet`? {#lld08-entities}
It is a **Facade** (one front-door class that hides the internals): `User` and `Tweet` stay plain data, and the service owns everything that must be checked or locked.
**Why:** callers talk to one class, so thread-safety and validation live in one place, not scattered over `User` and `Tweet`.
**Example:** a restaurant waiter. You never walk into the kitchen.

## Mini Twitter: why order tweets by a counter, not `time.time()`? {#lld08-monotonic-counter}
Give each tweet `seq = next(counter)`, a number that only goes up (a **monotonic counter**), read inside the lock.
**Why:** two tweets in the same millisecond get the same timestamp, and clocks can jump backwards (the OS syncing its clock with a time server). A counter gives a strict, unique order, so the heap never has to compare two `Tweet` objects on a tie.
**Example:** a bank token machine: two people arriving in the same second still get tokens 41 and 42.

## Mini Twitter: how do you build the 10-tweet news feed without sorting every followee's tweets? {#lld08-k-way-merge}
Each author's list is already sorted, so do a **k-way merge** with a **heap** (hands back its smallest item in O(log k)): hold each author's newest tweet, pop the newest, push that author's next-older one, stop after 10 pops.
**Why:** only the front of each list can be next, so the cost is O(k + 10 log k) for k followees, independent of how many tweets exist.
**Example:** 5 bank queues by token: call the smallest front token.
**Trap:** gathering and sorting every followee's tweets to show 10.

## Mini Twitter: Python's `heapq` is a min-heap. How do you get newest-first? {#lld08-heap-negate}
Push `-seq`. Each entry is `(-seq, which_timeline, index_in_it)`.
**Why:** a min-heap hands back its smallest item first, and the smallest `-seq` is the largest `seq`, i.e. the newest tweet.
**Example:** seq 9 becomes -9, which is smaller than -4, so it pops first.

## Mini Twitter: chronological today, ranked feed tomorrow. Which pattern sits behind the feed, and what does it replace? {#lld08-strategy}
**Strategy** (swap the algorithm behind one interface): a `FeedStrategy` interface with `ChronologicalMergeStrategy`. `get_news_feed` gathers timelines, then calls `strategy.build_feed(...)`.
**Why:** it replaces an `if feed_type == "ranked" ... elif` ladder in the service. A ranked feed becomes one new class, and the service does not change.
**Example:** Google Maps "fastest or avoid tolls".

## Mini Twitter in one process: build the feed by pull (fanout-on-read) or push (fanout-on-write), and why? {#lld08-pull-vs-push}
**Pull**: tweets are stored once under the author and the feed is merged when opened. (**Push** copies each tweet into every follower's feed list on post: cheap reads, costly posts.)
**Why pull here:** single process, no extra storage, and delete/unfollow stay trivially correct. Real Twitter uses a hybrid (push for normal users, pull for celebrities).
**Example:** a celebrity with 10M followers means 10M writes per post under push.

## Mini Twitter: when would you switch to push, and what breaks? {#lld08-switch-to-push}
When reads far outnumber writes and feed latency matters (say users read 100x more than they post). Add an **Observer** (notify subscribers on an event): `post_tweet` notifies each follower's `FeedCache` (that follower's precomputed feed list), which prepends the tweet.
**Why:** each read then just returns a ready list, paying the cost once per post instead of once per read.
**Example:** a newspaper delivered to every door beats everyone walking to the stall, if everyone reads it.
**Trap:** delete and unfollow now have to clean up copies in many feeds.

## Mini Twitter: where is the race condition in `get_news_feed`? {#lld08-race}
The feed iterates `user.following` and several tweet lists. A concurrent `follow` raises "Set changed size during iteration"; a concurrent post or delete shifts a list under your indexes.
**Fix:** one service-wide `threading.Lock` that every writer also takes (and `next(seq)` is read under it, so numbers stay unique).
**Example:** counting the people in a queue while others keep joining and leaving it.

## Mini Twitter: snapshot under the lock, merge outside. How does that work? {#lld08-snapshot}
Inside the lock: build `{me} | following` (a new set) and copy each author's `tweets[-limit:]` (slices are copies). Release the lock, then merge the copies.
**Why `[-limit:]`:** older tweets can never make the top 10, so copying more is wasted work.
**Why outside:** nobody can mutate what the strategy reads, and the critical section (code run while holding the lock) stays short.
**Example:** photocopy the notice board, then read the copy at your desk.
**Trap:** merging inside the lock, or reading `following` without it.

## Mini Twitter: why one global lock, not one lock per user? {#lld08-one-lock}
A feed touches the user and all followees, so per-user locks means holding many at once. Without a fixed acquisition order, two threads can each hold one lock the other wants (**deadlock**).
**Why:** one lock is obviously correct and the held time is short. If profiling shows contention, use per-user locks with sorted acquisition, or a read-write lock.
**Example:** two people each holding one chopstick and waiting for the other's.

## Mini Twitter: you open your own feed right after tweeting and your tweet is missing. What rule was forgotten? {#lld08-own-tweets}
The feed's author set must be `{me} | following`, not just `following`.
**Why:** you never follow yourself (self-follow is rejected), so your own tweets appear only if the feed adds you explicitly.
**Example:** posting in a WhatsApp group and not seeing your own message.

## Mini Twitter: name three inputs the service must reject. {#lld08-traps}
Self-follow, blank text or text over 280 chars, and a delete by anyone other than the author (`NotAuthorizedError`).
**Why:** the facade is the single front door, so each rule is checked once there and nowhere else.
**Example:** a form that will not submit with an empty name field, checked once at the counter, not by every clerk behind it.

## Give the mini Twitter design as four beats. {#lld08-pitch}
1. `User`, `Tweet` and a `TwitterService` facade; each user has a followee set and an append-only, already-sorted tweet list.
2. Order comes from a monotonic counter.
3. Feed is pull: a heap-based k-way merge of each author's newest 10, behind a `FeedStrategy`.
4. One service lock guards writes; the feed snapshots under it and merges outside. For read-heavy loads, switch to push.

Grade Got it only if you said all four beats.

## Mini Twitter: how does like work, and why is it safe to repeat? {#lld08-like}
`Tweet.liked_by` is a set of user ids, and `like` adds the user id. Liking twice changes nothing, so `like_count` is `len(liked_by)`.
**Why:** a set makes "like once per user" automatic, with no check needed. Follow works the same way (a set of followees).
**Example:** a class attendance register: marking yourself present twice is still one present.
**Trap:** counting likes in a plain integer, which lets one user like twice.
