---
topic: HLD 02 · Distributed Rate Limiter
group: HLD
---

## Pitch the distributed rate limiter in 30 seconds. {#hld02-pitch}
Middleware in the 30 app servers (not a separate service): the 2 ms budget buys one network hop. Rules (10 MB) sit in every process, polled every 5 s. One Redis Lua script per request refills the token bucket, decides, and returns the header values atomically: 50,000 ops/s against 100,000 per node.
**Left open:** the 5,000 QPS hot key, and Redis being down.

## Which clarifying questions change the rate limiter design? {#hld02-clarify}
- Which is worse: rejecting a legit request or letting an extra one through?
- How big a burst is fine (the magnitude picks the algorithm)?
- Key (API key / user / IP) and how many are active?
- Added-latency budget? Same limit for everyone? How fast must a limit change apply?
**Why:** each answer deletes an option. Ask for the cost, not "do you prefer C or A".

## What are the locked requirements and numbers? {#hld02-spec}
Key = API key. Tiers: Free 10/s, Pro 100/s, Enterprise up to 10,000/s. Burst up to 2x is fine. Overshoot ~1% OK, undershoot ~0. p99 added latency <= 2 ms. Rule change live in ~10 s. 50k QPS peak, ~20k active keys, 30 servers, single region.
**Why:** a rejected request does not consume budget, or a retry loop could never recover.

## Why is the 1% overshoot an "error budget", not a permission? {#hld02-tolerance}
It is the counting mechanism's tolerance. The customer's limit is still the limit.
**Trap:** saying "the system can allow up to 1% over" invites "so Pro customers get 101/s?", which has no good answer.
**Why asymmetric:** overshoot is a bit of extra backend load; undershoot is a paying customer wrongly rejected.

## Why no durability for counters? {#hld02-durability}
The enforcement window is ~1 s and counters are derived from live traffic. Wipe them all and a key gets a fresh allowance (up to ~2x its limit for that one second), then it self-heals. So no AOF/RDB, no backups.
**Why:** any Redis replica is for availability, not durability. The inverse of URL shortener, where one lost row is a dead link.

## What is the ops amplification and Redis headroom ratio? {#hld02-amplification}
Each decision needs the rule and the counter: 50,000 req/s x 2 ops = 100,000 ops/s. One Redis node does ~100,000 ops/s, so the ratio is 1.0: 100% utilised at peak.
**Why:** "2 ops per request" alone is not an estimate. Push it through the load and divide by capacity.
**Fix:** move rules in-process: 1 op, ratio 0.5.

## Where does the limiter live, and what rules out the others? {#hld02-placement}
Middleware library in each app server. p99 per hop is ~1 ms (0.5 ms median, tail 2-3x), so 2 ms buys one hop. A dedicated service or gateway tier costs app->limiter->Redis = 2 hops. Sidecar is the runner-up.
**Cost:** deploy coupling, blast radius, one implementation per language.
**Rule:** let the constraint eliminate options before preference does.

## How are rules distributed to 30 servers? {#hld02-rules}
Every server holds a full in-process replica: 200k rules x 50 B = 10 MB. It polls an 8-byte `rules:version` key every 5 s (30 / 5 = 6 reads/s) and fetches the snapshot only when the version moves. Unknown key means Free tier, never reject.
**Why not a cache:** no miss path, no eviction, no cold-start stampede. Worst staleness is 5 s, inside the 10 s budget.

## Why poll only, with no pub/sub invalidation? {#hld02-poll-only}
Push would only trigger the fetch the poll already does, sooner. Polling 1/s is 30 reads/s: 0.03% of a node, so freshness is a free config knob. Redis pub/sub is at-most-once, so a restarting server misses a message silently.
**Rule:** price the simpler option first. "X alone is unsafe" does not mean "do both".
**Push pays off** at ~1,000+ consumers, not for freshness.

## What does the Redis Lua script do, and why one script? {#hld02-lua}
Atomically: read `{tokens, last_refill}`, refill = min(capacity, tokens + elapsed x rate), take a token if there is >= 1, write, and return `{allowed, remaining, reset}`.
**Why:** atomic inside Redis, so two servers cannot both read `tokens = 1` and both allow (no lock). It returns the FR-5 header values for free, and only decrements on allow.
**Why TTL is free:** a key idle long enough to expire has refilled anyway.

## Why does a lock or `GET`+`INCR` not work? {#hld02-no-lock}
A lock costs about a round trip to acquire plus one to release, more than the whole 2 ms budget. `GET` then `INCR` is check-then-act: two servers both see 9 of 10 and both allow.
**Why:** atomic read-modify-write belongs server-side. This replaces the per-key lock from the single-process (LLD) version.

## Why does sharding Redis not fix a hot key? {#hld02-hot-key}
One customer is 5,000 QPS on a single Redis key. A key hashes to one of 16,384 slots, and a slot lives on one node, so adding nodes leaves it on one node while the rest idle.
**Rule:** sharding fixes volume, never skew.
**Example:** one checkout counter with a 5,000-person queue. Opening more shops does not shorten it.

## How do you split a hot key? {#hld02-key-split}
Split the Redis key into N sub-buckets: `rl:acme:*:0..7`, limit/8 each, picked by `hash(server_id) % 8`. At 10x: 50,000 ops/s on one key becomes 6,250 x 8, and spreads across nodes.
**Why:** the node holding the whole key sat at 106k ops/s (ratio 1.06) while the cluster was 63% used. Use more buckets than nodes.
**Trap:** never use a Cluster hash tag `{acme}`; it sends every sub-bucket to one node.

## What does key-splitting cost, and which keys get split? {#hld02-key-split-cost}
A client may be denied at a dry sub-bucket while another has tokens: undershoot. Fix: on DENY, retry once on one random other sub-bucket (1.01 ops/req).
**Why:** the probe is a second serial call, ~2 ms total, exactly the budget. Cache the DENY in-process for a pinned key.
**Which keys:** `shard_count` is a rule field, default 1, raised only above ~1,000/s. A new whale is a field change, not a deploy.

## Why not local token leasing for hot keys? {#hld02-leasing}
Each server leasing 100 tokens cuts 5,000 ops/s to ~50, a far bigger win. But tokens parked on an idle server are unavailable to a busy one, and a dying server takes its lease with it.
**Why:** that moves error to undershoot, the forbidden direction. Key-splitting keeps error on the tolerated side.

## Redis is unreachable. Fail open or fail closed? {#hld02-degrade}
Neither: degrade. Fall back to in-process counting at `limit / 30 x 2` per server. The fleet is bounded at ~2x the limit instead of unbounded.
**Why:** fail-open means no limiting during the outage (backend gets 50k unprotected QPS); fail-closed rejects legit users. Counters rebuild from live traffic on recovery.
**Trap:** `/30` is a constant; it should use the live replica count.

## Redis is slow, not down. What then? {#hld02-slow-redis}
A Redis answering in 800 ms turns a 2 ms budget into an 800 ms API. Use a ~5 ms client timeout and a circuit breaker: N consecutive timeouts trip to local mode, and a probe every few seconds closes it.
**Why:** without the breaker you pay the full timeout on every request for the whole outage. A slow dependency is worse than a dead one.

## Whose clock does the token bucket use? {#hld02-clock}
Redis's own, via `TIME` inside the Lua script.
**Why:** a `now_ms` from 30 app servers means 30 clocks. A server 200 ms fast grants 200 ms of free tokens on every request. NTP skew of tens of ms is normal. One clock, on the machine owning the counter, costs nothing.

## What breaks at 10x (500k QPS), and what is the fix? {#hld02-10x}
Counter ops reach 500,000 ops/s: Redis Cluster, 5 nodes minimum, ~8 for headroom (ratio 0.63). The hot key hits 50,000 ops/s: key-splitting. Rules stay 10 MB. Poll is 300 / 5 = 60 reads/s (revisit push at ~1,000 servers).
**Why it is already cluster-ready:** the Lua script touches exactly one key, since Cluster forbids a command spanning slots.

## Why is the dataset only ~11 MB, and what is the real constraint? {#hld02-size}
Rules: 200k x 50 B = 10 MB. Counters: 20k active x 70 B = 1.4 MB (idle ones expire).
**Why:** storage is a non-issue. The binding constraint is operations per second, and the one that adding nodes cannot fix is the hot key.

## What weak spots do you name yourself in the rate limiter? {#hld02-weak-spots}
1. Deploy coupling: a limiter fix needs an app deploy (exit: sidecar, ~0.1 ms).
2. A 429 still costs a connection and a few hundred microseconds of app server.
3. `limit / 30` is a config constant.
4. A whale pinned at its limit makes the sub-bucket retry cost 2 ops/req; cache the DENY locally.
