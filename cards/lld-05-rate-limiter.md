---
topic: LLD 05 · Rate Limiter
group: LLD
---

## What is the scope and public API of the LLD rate limiter? {#lld05-scope-api}
Single process, multi-threaded, in-memory. One method: `allow(key) -> bool`. The key is an opaque string (user id, IP or API key), and keys are created lazily on first sight.
**Why:** distributed counters are the HLD twin. A richer `Decision(allowed, remaining, retry_after)` is the first upgrade, for a real 429 with `Retry-After`.

## Which two things carry the marks in the rate limiter problem? {#lld05-two-marks}
The algorithm choice (Strategy) and concurrency.
**Why:** the algorithms differ on burst behaviour and memory per key, and every request reads and writes the counter, many at once for the same key. Counting itself is easy.

## How does the rate limiter use the Strategy pattern? {#lld05-strategy}
`RateLimiter` is a facade (a thin front door) that reads `now` from the `Clock` and delegates to `RateLimiterStrategy.is_allowed(key, now) -> bool`. Five concretes sit behind it.
**Why:** swapping the algorithm never touches `RateLimiter.allow`. This is the third Strategy rep, on an algorithmic axis.

## Compare the five rate-limit algorithms on burst behaviour and memory. {#lld05-algo-table}
| Algorithm | Edge burst | Memory/key |
|---|---|---|
| Fixed window | 2× spike | O(1) |
| Sliding log | exact | O(N) |
| Sliding counter | approx | O(1) |
| Token bucket | burst to capacity | O(1) |
| Leaky bucket | smoothed | O(1) |

**Example:** fixed window, limit 100: 100 at 12:00:59.9 plus 100 at 12:01:00.1 is 200 in 0.2 s.

## How does the sliding window counter estimate, and why is it the production default? {#lld05-sliding-counter}
`estimate = current + previous × overlap fraction`. 30 s into the minute: 20 + 90 × 0.5 = 65.
**Why:** O(1) memory (two counters) with most of the sliding log's fairness. The log stores a timestamp per request, so a key doing 10k per minute stores 10k entries.

## Token bucket versus leaky bucket: when do you pick which? {#lld05-token-vs-leaky}
Token bucket allows a burst up to capacity, then caps the sustained rate. Leaky bucket smooths output to a steady stream.
**Example:** capacity 10, 1 token/s: after idling, 10 requests pass at once, the 11th is rejected, then about 1 per second.
**Also:** as a synchronous `-> bool` limiter, leaky bucket is the dual of token bucket. Real smoothing needs a queue and a worker.

## Why is refill computed lazily, not by a timer thread? {#lld05-lazy-refill}
Elapsed time is computed on the next call, which is O(1) and needs no thread.
**Why:** a timer per key does not scale and adds a whole concurrency surface.

## Why is `Clock` injected, and what is the rule behind it? {#lld05-clock}
Time makes output non-deterministic. `Clock.now()` has `RealClock` and `FakeClock` implementations, so tests advance time without `sleep`.
**Why:** anything from the outside world that breaks determinism (time, randomness, external I/O) goes behind a small injected interface. Pure logic you just create inline.

## At 99/100 two threads hit the same key. What goes wrong without a lock? {#lld05-check-then-act}
Both read 99, both decide "allowed", both write 100. Two allows where one was allowed.
**Why:** read, decide and write must be one critical section. Lock the decision, not just the data structure.
**Trap:** a thread-safe dict does not help. The three steps are individually safe but not together.

## Does Python's GIL (Global Interpreter Lock) make the counter safe? {#lld05-gil}
No. The GIL makes one bytecode atomic. Check-then-act is many bytecodes, and a thread switch can land between any two.
**Why:** the GIL prevents corruption, not wrong answers. You still need the lock.

## How do you lock so unrelated keys run in parallel? {#lld05-two-level-lock}
Two levels. Level 1: a brief `table_lock` guards creating a key's lock. Level 2: a per-key lock guards the whole decision.
**Why:** one global lock is correct but serializes unrelated keys. Verified by 500 threads on one key with capacity 50: exactly 50 allowed.

## Why a shared `KeyedStrategy` base, and how would Template Method harden it? {#lld05-keyed-base}
State lives in each strategy because each has a different shape (`(tokens, last_refill)` vs a deque vs `(window_id, curr, prev)`). The base holds the per-key locks once.
**Why:** it kills five-way copy-paste. Next hardening: base `is_allowed` wraps the lock and calls an abstract `_decide`, so no strategy can forget it.

## Extension: different limits per action, or per-tenant keys. What changes? {#lld05-ext-v2}
Hold a map of `action → strategy`, and have the caller pass a `Request` with `get_key()` (api_key, then user_id, then ip, then "anonymous", or a custom `key_by`).
**Why:** the limiter core still never learns what a key means. A rule registry plus Factory is the next step for data-driven rules.

## Why not Singleton for the limiter, and how does the distributed version differ? {#lld05-singleton-distributed}
Singleton globalizes state and blocks multiple limiters (per-tenant, per-endpoint). Inject one instance.
**Also:** distributed: the counter moves to Redis, and the local lock becomes an atomic server-side `INCR` (increment) or a Lua script (several commands run as one step), or a distributed lock. You trade certainty for network latency and failure modes.

## Which algorithm would you pick, and why? {#lld05-pick}
Say the trade-off. Spike tolerable: fixed window. Exact, low volume: sliding log. Fair and cheap (default): sliding counter. Short bursts but capped sustained rate: token bucket. Perfectly smooth downstream: leaky bucket.
**Why:** the senior signal is "token bucket, because we tolerate bursts but bound the sustained rate", and knowing what you gave up.

## Give the 60-second pitch for the rate limiter. {#lld05-pitch}
A thread-safe single-machine limiter answering `allow(key) -> bool`. Strategy: five algorithms behind one interface. The hard part is concurrency: read-decide-write is one critical section per key, locked per key so unrelated keys run in parallel. Time is injected via `Clock` so tests need no `sleep`.
