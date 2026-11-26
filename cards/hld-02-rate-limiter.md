---
topic: HLD 02 · Distributed Rate Limiter
group: HLD
---

## Pitch the distributed rate limiter in 30 seconds: what are your 4 beats? {#hld02-pitch}
(1) Placement: middleware inside each of the 30 app servers, because a 2 ms budget allows one network hop. (2) Rules (10 MB) live in every process, refreshed by polling every 5 s. (3) One Redis Lua script per request refills and takes from a token bucket atomically, using Redis's clock. (4) Failure: slow or down Redis trips a circuit breaker to local limits; a hot key is split into sub-buckets.
**Grade:** Got it only if you said all 4 beats.
**Example:** 50k req/s × 1 Redis op = 50k ops/s, half of one node's ~100k.

## Rate limiter: which clarifying question shapes every later trade-off, and what did the answer lock? {#hld02-clarify}
"Which error is worse: wrongly rejecting a legit request, or letting an extra one through?" Answer: rejecting a paying customer is near-forbidden; ~1% extra is fine.
**Why:** that asymmetry decides every later choice: designs that err toward over-allowing (key splitting) pass, designs that err toward rejecting (token leasing) fail.
**Example:** ask for the cost of each mistake, not "do you prefer consistency or availability?", which gets a vague answer.

## Rate limiter: the interviewer asks "so Pro customers really get 101/s?" How do you frame the 1% overshoot? {#hld02-tolerance}
The limit is still 100/s; 1% is the counting mechanism's error budget, not a permission granted to customers.
**Why:** an error budget is the most a correct design may drift under failure or races. Calling it "allowed" invites the question, which has no good answer.
**Example:** a petrol pump calibrated to ±0.5% does not mean you sell 1.005 litres per litre.

## Rate limiter: bursts up to 2× are fine, but sustained excess is not. Which algorithm, and how do you size it? {#hld02-token-bucket}
A token bucket: tokens refill at the limit rate, each request takes one, and capacity (the largest burst) = 2 × rate.
**Why:** capacity expresses the allowed burst directly, while the refill rate still caps the long-run average, so sustained excess drains the bucket and is rejected.
**Example:** a prepaid card topped up ₹100 every second with a ₹200 ceiling: you can spend ₹200 at once, but not ₹200 every second.

## Rate limiter: why is a fixed-window counter ("100 per minute, reset on the minute") weak? {#hld02-fixed-window}
It allows 2× the limit across a boundary: 100 requests at 0:59 and 100 more at 1:00. A sliding-window counter fixes this with two numbers per key.
**Why:** the sliding count = current window + previous window × the fraction of it still inside the last 60 s, so the boundary jump disappears. A sliding log (every timestamp) is exact but stores one entry per request.
**Example:** at 1:15, count = this minute's 20 + last minute's 100 × 0.75 = 95.

## Rate limiter: what does a rejected client receive? {#hld02-429}
HTTP 429 Too Many Requests, with `Retry-After` (seconds to wait) and `X-RateLimit-Limit`, `-Remaining` and `-Reset` headers.
**Why:** 429 says "you, slow down", so the client backs off; 503 would wrongly say the server is struggling. The headers let well-behaved clients pace themselves before hitting the wall.
**Example:** a banking app's "too many attempts, try again in 30 seconds".

## Rate limiter: should a rejected request use up a token? {#hld02-deny-free}
No. A denial reads the bucket but takes nothing.
**Why:** if rejections cost tokens, a client stuck in a retry loop keeps its own bucket empty and can never recover, even after slowing down.
**Example:** a client sends 200/s against a 100/s limit; only the 100 allowed requests drain tokens, so when it drops to 90/s it is fully served at once.

## Rate limiter: do the Redis counters need persistence (AOF, snapshots) or backups? {#hld02-durability}
No. If counters are wiped, each key gets a fresh allowance for about one second, then traffic rebuilds them.
**Why:** counters cover a ~1 s window and are derived from live traffic, so losing them costs at most one burst of up to 2× per key. Any replica is for availability, not durability.
**Example:** the opposite of the URL shortener, where one lost row is a dead link forever.

## Rate limiter: 50k req/s, each reading a rule and a counter from Redis. Is one Redis node (~100k ops/s) enough? {#hld02-amplification}
No: 2 ops × 50k = 100k ops/s, 100% of the node at peak. Moving rules in-process halves it to 50k ops/s, leaving 50% headroom (spare capacity).
**Why:** "2 ops per request" is not an estimate until you multiply by load and divide by capacity. At 100% one spike or failover tips you into degraded mode.
**Example:** a 2× spike on 50% headroom lands at 100%, which is your signal to move to Redis Cluster.

## Rate limiter with a 2 ms latency budget: where does the limiter run? {#hld02-placement}
As a middleware library inside each app server, calling Redis directly.
**Why:** one network hop costs ~1 ms at p99 (99th-percentile latency), so app → limiter service → Redis uses the whole 2 ms on hops alone. In-process is viable because each server sees only ~1,667 QPS.
**Example:** 50,000 QPS ÷ 30 servers ≈ 1,667 QPS each.
**Trap:** the cost is deploy coupling: a limiter change ships with every service, in every language.

## Rate limiter: how do 30 servers get 200k rules and see changes within 10 s? {#hld02-rules}
Each server holds a full in-process copy (~10 MB) and polls an 8-byte `rules:version` key every 5 s, fetching the snapshot only when the version changes.
**Why:** a full copy has no miss path, no eviction and no cold-start stampede, and 5 s polling keeps worst-case staleness inside 10 s.
**Example:** 200k × 50 B = 10 MB; 30 servers ÷ 5 s = 6 Redis reads/s.

## Rate limiter: why poll for rule changes instead of pushing them with Redis pub/sub? {#hld02-poll-only}
Polling already meets the deadline nearly for free, and Redis pub/sub is fire-and-forget, so a restarting server silently misses a push.
**Why:** push only triggers the fetch the poll does anyway, a bit sooner; you would still need the poll as a backstop. Price the simpler option first.
**Example:** polling every 1 s is 30 reads/s, 0.03% of a node; push pays off only near ~1,000 consumers.

## Rate limiter: why one Redis Lua script per request instead of GET then INCR, or a lock? {#hld02-lua}
A Lua script runs atomically inside Redis: read `{tokens, last_refill}`, refill, take a token if one exists, write back, all in one round trip.
**Why:** GET then INCR is check-then-act (two servers both see 9 of 10 and both allow), and a lock adds a round trip that eats the whole 2 ms budget.
**Example:** refill = min(capacity, tokens + elapsed × rate); the script also returns `remaining` and `reset` for the response headers.

## Rate limiter: one customer sends 5,000 QPS to a single counter key. Why doesn't adding Redis nodes help? {#hld02-hot-key}
The key hashes to one slot (one of Redis Cluster's 16,384 key buckets), and each slot lives on one node, so it stays on one node while new nodes idle.
**Why:** sharding spreads many keys; it cannot spread one. Sharding fixes volume, never skew.
**Example:** one checkout counter with a 5,000-person queue; opening more shops does not shorten it.

## Rate limiter: how do you spread one hot counter key across Redis nodes? {#hld02-key-split}
Split it into N sub-buckets (`rl:acme:0..7`), each with limit ÷ N, and pick one per request by `hash(server_id) % N`.
**Why:** each sub-bucket is its own key, so they hash to different slots and nodes; use more buckets than nodes so they spread.
**Example:** at 10×, 50,000 ops/s on one key becomes 8 × 6,250 across the cluster.
**Trap:** never wrap the name in a hash tag like `{acme}`: that forces every sub-bucket into one slot.

## Rate limiter: key-splitting can deny a client at an empty sub-bucket while others have tokens. How do you limit that? {#hld02-key-split-cost}
On a deny, retry once on one random other sub-bucket, and split only keys above ~1,000/s (a per-rule `shard_count`, default 1).
**Why:** this wrong rejection is the forbidden error direction; one probe makes it rare at ~1.01 ops per request, and leaving small keys whole avoids the error for most customers.
**Example:** sub-bucket 3 is empty, sub-bucket 6 has 40 tokens: the probe finds them and the request passes.

## Rate limiter: why not let each server lease a block of tokens for a hot key? {#hld02-leasing}
Tokens parked on an idle server can't be used by a busy one, and a crashed server loses its lease, so real customers get wrongly rejected.
**Why:** leasing cuts Redis load far more (5,000 ops/s to ~50), but it moves error toward rejection, the forbidden direction; key-splitting errs toward over-allowing.
**Example:** 30 servers each hold 100 tokens; traffic lands on 5 of them, which run dry while 2,500 tokens sit unused.

## Rate limiter: Redis is unreachable, and a wrong allow costs only some extra backend load. Fail open, fail closed, or what? {#hld02-degrade}
Neither: degrade to in-process counting at 2 × (limit ÷ 30) per server, so the whole fleet allows at most ~2× the limit.
**Why:** fail-open leaves the backend unprotected at full traffic; fail-closed rejects paying users. A bounded local limit keeps both errors small, and counters rebuild from traffic on recovery.
**Example:** a 100/s key gets ~6.7/s per server; 30 × 6.7 ≈ 200/s worst case.
**Trap:** use the live server count, not a hard-coded 30.

## Rate limiter: Redis is slow (800 ms), not down. What happens to your 2 ms budget, and what do you add? {#hld02-slow-redis}
Every API call becomes 800 ms slower. Add a ~5 ms client timeout plus a circuit breaker that switches to local limits after repeated timeouts.
**Why:** a timeout alone still makes every request wait 5 ms for the whole outage; the breaker stops calling Redis and probes every few seconds to switch back.
**Example:** 10 timeouts in a row trip the breaker; a probe succeeds 5 s later and Redis counting resumes.

## Rate limiter: whose clock should the token bucket's refill use? {#hld02-clock}
Redis's own, via `TIME` inside the Lua script.
**Why:** 30 app servers have 30 clocks; NTP (network time sync) leaves them tens of ms apart, and a server running fast grants free tokens on every refill. One clock on the machine that owns the counter avoids it.
**Example:** a server 200 ms fast makes every refill think 200 ms more passed: a 100/s key gets ~20 bonus tokens each time.

## Rate limiter at 10× (500k req/s): what changes for the counters? {#hld02-10x}
Move to Redis Cluster with about 8 nodes (5 is the bare minimum), and split hot keys.
**Why:** the design is already cluster-ready because each Lua script touches exactly one key, and Cluster forbids a command spanning slots.
**Example:** 500k ops/s ÷ 100k per node = 5 nodes at 100%; 8 nodes run at ~63%.
