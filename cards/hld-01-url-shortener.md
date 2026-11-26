---
topic: HLD 01 · URL Shortener
group: HLD
---

## Pitch a URL shortener in 30 seconds: what are your 4 beats? {#hld01-pitch}
(1) Numbers: ~12 creates/s, ~6,000 peak redirects/s, 100:1 reads, so caching is the main lever. (2) Shape: LB → 3–4 stateless app servers → Redis cache-aside → one Postgres primary plus failover replica. (3) Codes: 7 random base62 chars; the primary key catches collisions, up to 3 attempts. (4) Redirect is a 301; links are immutable, so no cache invalidation.
**Grade:** Got it only if you said all 4 beats.
**Example:** a phone book: looked up constantly, rarely added to.

## URL shortener: what do you scope out, and which later decision does each cut unlock? {#hld01-requirements}
Out: analytics, link edit/delete, expiry, accounts. No analytics and no edits make a 301 (browser-cached redirect) safe; no edits and no expiry make links immutable, so the cache needs no invalidation or TTL.
**Why:** a scope cut is a design lever, so say which decision it buys.
**Example:** "no edits" is why a cached 301 can never point at a stale URL.

## URL shortener: from 1M new links/day and 100:1 reads, derive write, read and peak QPS. {#hld01-requirements-qps}
~12 writes/s, ~1,200 reads/s, ~6,000 reads/s at peak (QPS: queries per second).
**Why:** the 100× gap makes the cache the main lever, and the 6,000 peak sizes the app tier.
**Example:** 1M ÷ 86,400 ≈ 12; × 100 = 1,200; × 5 peak = 6,000.

## URL shortener: does 5 years of storage force you to shard? {#hld01-requirements-storage}
No: about 0.9 TB in 5 years fits one Postgres node.
**Why:** compute storage before saying "NoSQL because it scales"; here the data fits one box, so you keep SQL's UNIQUE constraint and transactions.
**Example:** 1M/day × 500 B = 500 MB/day; × 1,825 days ≈ 0.9 TB, smaller than a laptop SSD.

## URL shortener: why 3–4 app servers for ~6,000 peak QPS? {#hld01-app-servers}
Three carry the peak (~2,000 QPS each) and the fourth is a spare; the real reason for more than one is availability, not throughput.
**Why:** with one server, every crash or deploy is a full outage, which alone breaks 99.9% uptime.
**Example:** 6,000 ÷ 2,000 = 3, plus 1 spare = 4, so a deploy can take one out while three serve.

## URL shortener: do you need a key-generation service handing out codes? {#hld01-no-kgs}
No. Each app server draws random codes on its own, and the DB's primary key catches the rare collision.
**Why:** random codes need no coordination; a key service adds a ~0.5 ms network hop and a new failure point for nothing. Only a counter-based scheme needs one.
**Example:** two people each roll their own dice; the referee only steps in on the rare matching roll.

## URL shortener: ~2B links in 5 years. Why 7 base62 characters, not 6? {#hld01-key-length}
6 chars (57B codes) would be 3.5% full, so a random guess hits a live link about 1 in 28. 7 chars (3.5T) is 0.06% full: about 1 in 1,760.
**Why:** unguessable codes are a requirement, and they need a mostly empty space, not just enough codes. The cost is one character.
**Example:** 2B ÷ 57B ≈ 3.5%; 2B ÷ 3.5T ≈ 0.06%.

## URL shortener: 301 or 302 for the redirect? {#hld01-301}
301 (Moved Permanently), because browsers cache it, so repeat clicks never reach your servers.
**Why:** it cuts load for free, and it is safe only because you scoped out analytics (you won't see repeat clicks) and edits (the target never changes).
**Example:** like a shop's "we have moved" sign that customers photograph: they go straight to the new address next time.
**Trap:** a cached 301 cannot be fixed later; if links may be edited, use 302 and give up the load win.

## URL shortener: why SQL and not NoSQL for the links table? {#hld01-sql}
Because you need a transactional UNIQUE on `long_url` (dedup and race handling) plus read-your-writes, and the data fits one node.
**Why:** a DynamoDB GSI (global secondary index) enforces no uniqueness and is eventually consistent, so a stale read lets a duplicate in. At ~1 TB and ~6k QPS, one Postgres plus Redis is enough.
**Example:** justify by the guarantee you need ("UNIQUE across all rows"), never by a myth like "NoSQL can only have one key".

## URL shortener: what is the partition key for `links`, and why not `long_url`? {#hld01-partition-key}
`code`, because `GET /abc1234` carries only the code, so every redirect is a one-partition read.
**Why:** partitioning on `long_url` needs the URL you are looking up, so every redirect becomes scatter-gather across all partitions.
**Example:** 6k redirects/s × 10 partitions = 60k internal queries/s of self-made load.

## URL shortener: custom aliases skip dedup, but auto codes must be unique per URL. How do you index `long_url`? {#hld01-partial-index}
A partial unique index: `UNIQUE (long_url) WHERE is_alias = false`.
**Why:** one URL may have one auto code plus any number of aliases; a plain UNIQUE would reject the alias rows.
**Example:** a person has one official ID number (auto code) but any number of nicknames (aliases).

## URL shortener: two identical create requests race. What does the losing request return? {#hld01-create-race}
The winner's code with 200: the loser's INSERT hits the UNIQUE violation, re-reads the row, and returns that code. The client never sees a 409.
**Why:** `long_url` itself is the idempotency key, so the conflict is resolved server-side and no Idempotency-Key header is needed.
**Example:** two clerks both file the same form; the second finds it already filed and hands you the first receipt number.
**Trap:** idempotent means same effect on server state, not same bytes; 201 for the winner and 200 for the loser is fine.

## URL shortener: how do you generate a code, and why no "is it free?" SELECT first? {#hld01-key-gen}
Draw 7 random chars with a CSPRNG (secure random generator, e.g. `secrets`), INSERT, and let the primary key reject a collision; up to 3 attempts, then 503.
**Why:** SELECT-then-INSERT is a check-then-act race: two servers both see the code free and both insert. Only the constraint arbitrates safely.
**Example:** attempt 1 collides → draw again → attempt 2 succeeds; the client never notices.

## URL shortener: a create INSERT fails. How do you handle a PK violation vs a UNIQUE violation? {#hld01-violations}
PK on `code`: two different URLs drew the same code, so retry with a new code. UNIQUE on `long_url`: the same URL raced, so re-read and return the winner's code; never retry.
**Why:** same error type, opposite meaning; conflating them is the classic mistake.
**Example:** two people given the same locker number (reassign one) vs one person queueing twice (send them to their existing locker).

## URL shortener at 5-year fill: how often does a random 7-char code collide, and does it matter? {#hld01-collisions}
About 1 in 1,760, roughly 570 silent retries a day at 1M creates/day: noise.
**Why:** each retry is one extra INSERT (~1 ms), so ~0.6 s of DB work a day; it is cheaper to retry than to coordinate.
**Example:** 2B used ÷ 3.5T possible ≈ 0.057%; × 1M/day ≈ 570.

## URL shortener: why cap code generation at 3 attempts, and what do you return when all 3 collide? {#hld01-collisions-cap}
503 with Retry-After; at today's fill all 3 colliding happens about once in 15 years.
**Why:** the cap is a guard against a broken assumption (bad random generator, full key space): a fast visible error instead of an endless loop. 503 says "transient, retry"; 500 says "broken".
**Example:** p³ = (5.7×10⁻⁴)³ ≈ 2×10⁻¹⁰ per create; × 1M/day ≈ once per 5,400 days.

## URL shortener: why not encode an auto-increment counter in base62? {#hld01-rejected-gen}
Codes become sequential, so anyone can walk every link (abc1, abc2, …) and private links leak.
**Why:** unguessable codes are a requirement; a counter also needs a global counter service shared by all app servers.
**Example:** numbered tokens at a bank counter tell you exactly how many people came before you.

## URL shortener: why not use the first 7 chars of hash(long_url) as the code? {#hld01-no-hash}
Because it is deterministic: two URLs that collide always collide, so you cannot retry, and over 2B links about 470,000 pairs would.
**Why:** a random code can be redrawn on collision; a hash gives the same answer every time. It also lets anyone check whether a URL was ever shortened.
**Example:** birthday bound: n² ÷ 2m = (1.8×10⁹)² ÷ (2 × 3.5×10¹²) ≈ 470,000 pairs.

## URL shortener: why not use Snowflake IDs as codes? {#hld01-no-snowflake}
A 64-bit ID needs 11 base62 chars, not 7, and it is time-ordered, so codes made close together look alike and are guessable.
**Why:** Snowflake optimises for sortable, coordination-free IDs; a short link needs short and unguessable.
**Example:** 62¹¹ ≈ 5×10¹⁹ > 2⁶⁴ ≈ 1.8×10¹⁹ > 62¹⁰, so 11 chars.

## URL shortener: as the key space fills, which metric warns you early? {#hld01-monitor}
Average attempts per create, ≈ 1/(1−f) where f is the fraction used; it moves from the first percent of fill. Alarm at 1.1 (f ≈ 9%).
**Why:** the failure rate f³ (all 3 capped attempts collide) stays near zero until the space is nearly full, so it alarms only when it is too late.
**Example:** at 30% fill, attempts ≈ 1.4 (40% extra INSERTs) while only 2.7% of creates fail. Reaching 50% fill takes ~4,800 years at 1M/day.

## URL shortener: Postgres is down. What do create and redirect each do? {#hld01-cap}
Create returns a retryable 503 (consistency first). Redirect keeps serving from Redis for the cached ~90–95% of traffic (availability first).
**Why:** without the DB you cannot check uniqueness, so creating is unsafe; but links never change, so cached answers cannot be stale.
**Example:** ~93% of 6,000 QPS still redirects normally during the outage.
**Trap:** a cache miss returns 503, never 404: you cannot tell "does not exist" from "cannot check".

## URL shortener: why not serve redirects from the read replica? {#hld01-replica}
Because it is async: a link created a moment ago may not be there yet, so its creator gets a 404 on a live link. The replica exists for failover.
**Why:** read-your-writes is a requirement, and after a 90–95% cache hit the primary sees only ~300 read QPS, so it needs no offloading.
**Example:** 6,000 × 5% misses = 300 reads/s, trivial for one Postgres.

## URL shortener: should a create also write the new link into Redis? {#hld01-write-around}
No: write-around. Creates write only to Postgres; the first redirect misses and fills the cache.
**Why:** one system of record means no dual-write failure ("DB committed, cache write failed?"); the cost is at most ~1 point of hit rate, since few links are clicked right after creation.
**Example:** a library shelves a new book; it reaches the "popular" display only once someone asks for it.

## URL shortener: what TTL and invalidation do cached links need? {#hld01-no-ttl}
None. Links are immutable, so a cached value is never stale; LRU (evict least-recently-used) keeps the hot set in memory.
**Why:** a TTL would only force needless re-reads of data that cannot change.
**Example:** a printed dictionary on your desk never needs re-checking; you just shelve the ones you stop using.

## URL shortener at 10×: the UNIQUE index on `long_url` is bigger than the table. How do you shrink it? {#hld01-dedup-index}
Index a 128-bit hash of the URL (16 B) instead of the URL (~500 B), and look up by hash AND `long_url` to rule out false matches.
**Why:** with 18B rows a 64-bit hash gives ~9 accidental collisions, each wrongly rejecting a real URL; 128 bits gives effectively zero.
**Example:** 18B × 516 B ≈ 9.4 TB of index becomes ~580 GB.

## URL shortener at 10× (~58k reads/s): what breaks first, and what is the cheap fix? {#hld01-10x-first-break}
Postgres connections: 30 app servers × 20 = 600, each a separate OS process. Fix: PgBouncer, a proxy that multiplexes them onto ~50 real connections.
**Why:** past a point, more connections lower throughput (memory and context switching). The first break at 10× is often operational, not architectural.
**Example:** 600 waiters for 12 tables don't serve faster; they collide in the doorway.

## URL shortener at 10×: 19 TB fits on disk, so why shard? {#hld01-sharding}
Recovery time: restoring 19 TB at ~500 MB/s takes ~11 h, more than the whole year's 8.76 h downtime budget at 99.9%.
**Why:** a node's size is a recovery budget; sharding on `code` makes each restore small.
**Example:** 19 TB ÷ 500 MB/s ≈ 38,000 s ≈ 10.6 h.

## URL shortener: you shard on `code`. Which guarantee breaks? {#hld01-shard-dedup}
Dedup: UNIQUE on `long_url` becomes global uniqueness on a key you did not shard by, so it needs 2PC (two-phase commit across shards) or a separate index table. At that scale, drop dedup.
**Why:** a constraint is cheap only within one node; the strongest guarantee is the first to break when you shard.
**Example:** each branch of a bank can check its own account numbers, but "no customer anywhere has two accounts" needs a call to head office.
