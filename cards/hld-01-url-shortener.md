---
topic: HLD 01 · URL Shortener
group: HLD
---

## Pitch a URL shortener in 30 seconds. {#hld01-pitch}
Two ops: create (~12 QPS) and redirect (~1,200 avg, ~6,000 peak, 100:1 read-heavy). LB, 3-4 stateless app servers, Redis with cache-aside (the app reads the DB on a miss and fills the cache) for reads, one Postgres primary with a failover replica. Codes are 7 random base62 chars; the primary key catches collisions. Redirect is a 301.
**Why:** the 100x read/write gap is the whole story, so caching is the main lever.
**Example:** a phone book you look up constantly but rarely add to.

## What requirements and numbers do you pin down for a URL shortener? {#hld01-requirements}
Functional: shorten, custom alias, redirect. Out: analytics, expiry, update/delete, accounts, rate limiting. Non-functional: redirect p99 < 100 ms, 99.9% availability, never lose a mapping, read-your-writes (a just-created link works at once), unguessable codes.
**Numbers:** 1M/day / 86,400 = ~12 writes/s; x100 = 1,200 reads/s; x5 = 6,000 peak. 1M x 500 B = 500 MB/day, ~0.9 TB in 5 years: one DB node. Redirect ~1 KB x 6k = ~6 MB/s: trivial. Hot set 50-500 MB: one Redis.
**Why:** a dead redirect hurts far more than a failed create.

## Why 3-4 app servers and no Key Generation Service? {#hld01-app-servers}
Availability, not throughput: one server means a crash or deploy is a total outage (~99%, not 99.9%), so N >= 2. At ~2,000 QPS each, 6,000 / 2,000 = 3, plus 1 spare = 4.
**Why no key service:** random codes need no coordination between servers, and the DB unique constraint is the backstop. A service adds a ~0.5 ms hop and a new failure point for nothing. Only a counter scheme would need it, and that was rejected.

## Why 7 base62 characters and not 6? {#hld01-key-length}
~2B URLs in 5 years. 62^6 = 57B fits by count, but then it is 3.5% full, so a random guess hits a live URL ~1 in 28. 62^7 = 3.5T is 0.06% full, ~1 in 1,760.
**Why:** the non-sequential/unguessable requirement overrides the raw count. Cost is one extra character.

## Why 301 and not 302 for the redirect? {#hld01-301}
301 (Moved Permanently) is cached by the browser, so repeat clicks skip your server.
**Why:** it cuts load, and you scoped out analytics and link edits anyway.
**Trap:** a typo'd link can never be fixed. If that is unacceptable, use 302 and lose the load win. Still plan capacity for the un-discounted 6,000 peak.

## Why SQL and not NoSQL for the links table? {#hld01-sql}
Name the guarantee: a transactionally enforced UNIQUE on `long_url` (dedup plus race handling) and read-your-writes.
**Why:** a DynamoDB GSI (global secondary index) enforces no uniqueness and is eventually consistent, so a stale read lets a duplicate slip in. At ~1 TB and ~6k QPS, one SQL node plus Redis wins.
**Trap:** "NoSQL can only have one key" is a myth. It can have a second index. Justify by guarantee, never by feature myth.

## What is the partition key for `links`, and why not `long_url`? {#hld01-partition-key}
`code`. `GET /abc1234` carries only the code, so the node is computable: a one-partition point read.
**Why:** hashing on `long_url` would need the URL you are looking up. Every redirect becomes scatter-gather (ask all N partitions): 6k x 10 = 60k/s of self-made load, and p99 is the slowest reply.
**Rule:** partition on the field you look up by.

## Why is the dedup index a partial unique index? {#hld01-partial-index}
`UNIQUE (long_url) WHERE is_alias = false`.
**Why:** custom aliases bypass dedup, so URL X may have both an auto row and an alias row. A plain UNIQUE would reject that.
**Example:** a person may have one official ID card (auto code) but any number of nicknames (aliases).

## Two identical creates race. What happens? {#hld01-create-race}
Both miss the lookup, both INSERT. The DB commits one; the loser catches the uniqueness violation server-side, re-reads, and returns the winner's code with 200.
**Why:** contention stays server-side. The client never sees a 409. `long_url` is the idempotency key, so no Idempotency-Key header.
**Trap:** idempotent means same effect on server state, not same bytes (201 vs 200 is fine).

## How do you generate codes, and why no pre-check SELECT? {#hld01-key-gen}
Draw 7 random chars with a CSPRNG (cryptographically secure random generator: `secrets`, not `Math.random`), INSERT, and let the primary key catch collisions. Retry up to 3 times, then 503 + Retry-After.
**Why:** SELECT-then-INSERT is TOCTOU (time-of-check to time-of-use): two servers both see the code free. Only the constraint is safe. Try-and-catch beats check-then-act.

## A create INSERT fails. How do a PK violation and a UNIQUE violation differ? {#hld01-violations}
- `PRIMARY KEY (code)`: two different URLs drew the same random code. Retry with a new code; the client never notices.
- `UNIQUE (long_url)` (partial): two identical URLs raced to be first. Re-read and return the winner's code with 200; never retry generation.
**Why:** conflating them is the classic mistake. Same event type, opposite handling.

## How likely are collisions, and how many retries? {#hld01-collisions}
p = 2x10^9 / 3.5x10^12 = 5.7x10^-4 (1 in 1,760) at 5-year fill. Attempts = 1/(1-p) = 1.0006, about 570 retries/day.
**Why:** that is ~0.6 s of extra DB work a day: noise. All 3 capped attempts collide with p^3 = 1.8x10^-10, about once in 15 years.
**Why 503, not 500:** it is transient and retryable.

## Why not counter-to-base62, hash(url), or Snowflake IDs? {#hld01-rejected-gen}
- Counter: sequential, so anyone can enumerate every URL; also needs a global counter service.
- hash(url)[:7]: deterministic, so a collision is a bug, not a retry. Birthday bound is ~470,000 colliding pairs, i.e. links silently going to the wrong place. It also lets anyone confirm a URL was shortened.
- Snowflake: 64 bits is 11 chars, and time-ordered, so near-sequential.

## What do you monitor as the key space fills? {#hld01-monitor}
The retry rate, not the failure rate. Retries scale as f (fill ratio), failures as f^3.
**Why:** at 90% fill retries are only 10x while 73% of creates fail. Retry rate is the fuel gauge; failure rate speaks once, at the end. Alarm at E[attempts] > 1.1.
**Example:** reaching 50% fill takes ~4,800 years at 1M/day. The escape hatch is 8 chars: 62x space, backward compatible.

## What does the system do when Postgres is down? {#hld01-cap}
CAP is per-operation. CP = refuse rather than be wrong; AP = answer rather than refuse.
Create is CP: no DB means no uniqueness or durability check, so return a retryable 503. Redirect is AP for the hot set: Redis still serves ~90-95% (e.g. 93% of 6,000 QPS).
**Why:** mappings are immutable, so cached values cannot be stale; availability costs no consistency.
**Trap:** misses return 503, never 404. You cannot tell "does not exist" from "cannot check".

## Why is the read replica idle? {#hld01-replica}
It is for failover (durability: never lose a mapping), not read load. After a ~90-95% cache hit the DB sees only ~300 read QPS.
**Why:** serving redirects from an async replica breaks read-your-writes: a creator checking a fresh link could get a 404 on a live link.

## Why write-around caching, and how does LRU cope? {#hld01-write-around}
Creates write only to the DB. Redirects use cache-aside: read Redis, on miss read the DB and backfill.
**Why:** write-around keeps one system of record, so no dual-write ("DB committed, cache write failed?"). The cost is at most ~1 point of hit rate. Links are immutable, so no invalidation and no TTL (time-to-live expiry) needed; LRU (evict least-recently-used) self-sorts hot from cold.

## At 10x, what does the dedup index cost, and how do you shrink it? {#hld01-dedup-index}
18B rows x 516 B = 9.4 TB, bigger than the 9.1 TB table, with a B-tree about 9 levels deep.
**At 10x** (58k reads, 580 writes) the first break is the DB connection pool, 30 x 20 = 600 (fix: PgBouncer).
**Fix:** index a 128-bit hash of the URL (16 B): ~580 GB, depth ~5. Query by hash AND `long_url`.
**Why 128 bits:** at 64 bits the birthday bound gives about 9 false collisions, each wrongly rejecting a real URL.

## Why do you really shard, and what blocks it? {#hld01-sharding}
Not disk (19 TB fits). Restoring 19 TB at 500 MB/s takes ~11 h, more than the 8.76 h/year downtime budget at 99.9%. RAM is only ~3%. Sharding on `code` fixes both.
**Why dedup blocks it:** UNIQUE(long_url) is global uniqueness on a different key, which needs a distributed transaction (2PC, two-phase commit: slow, all shards agree) or an index table. Drop dedup at that scale.
**Rule:** the strongest guarantee breaks first.
