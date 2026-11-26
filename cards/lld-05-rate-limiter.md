---
topic: LLD 05 · Rate Limiter
group: LLD
---

## LLD rate limiter (single process, many threads, in memory): what is the public API? {#lld05-scope-api}
One method, `allow(key) -> bool`. The key is an opaque string (user id, IP or API key), and per-key state is created lazily on first sight.
**Why:** the limiter never needs to know what a key means, so any caller can use it. The first upgrade is `Decision(allowed, remaining, retry_after)` for a proper HTTP 429 with `Retry-After`.
**Example:** a club bouncer who only asks "is this wristband over its limit?", not who you are. Code: `if not limiter.allow(api_key): return 429`.

## LLD rate limiter round: counting requests is easy. Which two things carry the marks? {#lld05-two-marks}
Choosing and swapping the algorithm, and concurrency on the per-key counter.
**Why:** algorithms differ on burst behaviour and memory per key, and every request reads and writes the same counter, often many at once for one key.
**Example:** a toll booth: the counting is trivial; the questions are "which rule?" and "what if two cars reach the same lane at once?".

## Rate limiter must support five algorithms and let you swap them without touching the caller. What is the class structure? {#lld05-strategy}
Strategy: a `RateLimiter` front door reads `now` from a `Clock` and delegates to `RateLimiterStrategy.is_allowed(key, now) -> bool`, with one class per algorithm.
**Why:** a new algorithm is a new class; `RateLimiter.allow` never changes.
**Example:** a phone with several camera modes behind one shutter button. Code: `RateLimiter(TokenBucket(cap=10, rate=1), clock)`.

## Fixed-window limiter, 100 requests per minute. What is the worst burst a client can push, and why? {#lld05-algo-table}
200 requests in about 0.2 s: 100 at 12:00:59.9 and 100 at 12:01:00.1. The counter resets at the window edge, so two full windows meet.
**Why:** a fixed window counts per calendar minute, not per any 60-second span.
**Example:** a monthly data pack that resets on the 1st: use it all on the 31st and again on the 1st.

## Which rate-limit algorithm needs O(N) memory per key, and why do production systems avoid it? {#lld05-algo-memory}
Sliding log: it stores one timestamp per request in the window, so a key doing 10,000 requests a minute holds 10,000 entries.
**Why:** it is exact, but memory grows with traffic. The sliding counter gets close to the same fairness with two counters, O(1).
**Example:** a guard who writes every visitor's entry time in a register vs one who keeps two tally counts.

## Sliding window counter, limit 100/min: 90 requests last minute, 20 so far this minute, 30 s in. What is the estimate, and the formula? {#lld05-sliding-counter}
65: `estimate = current + previous × (fraction of the previous window still inside the last 60 s)` = 20 + 90 × 0.5. Allowed, since 65 < 100.
**Why:** it assumes last minute's requests were spread evenly, which gives most of the sliding log's fairness with two counters. That is why it is the common default.
**Example:** 45 s in, only 25% of last minute overlaps: 20 + 90 × 0.25 = 42.5.

## Token bucket vs leaky bucket: what does each do to a burst? {#lld05-token-vs-leaky}
Token bucket lets a burst through up to its capacity, then caps the sustained rate. Leaky bucket smooths output to a steady stream.
**Why:** tokens pile up while idle and can be spent at once; a leaky bucket drains at a fixed rate no matter how fast requests arrive.
**Example:** capacity 10, 1 token/s: after idling, 10 requests pass at once, the 11th is rejected, then about 1 per second.
**Trap:** as a synchronous `allow() -> bool` limiter, leaky bucket behaves like token bucket; real smoothing needs a queue and a worker.

## Clients may burst briefly but must not exceed 10 requests/s sustained. Which algorithm, and why? {#lld05-pick}
Token bucket with capacity = the burst size and refill 10 tokens/s: bursts pass up to capacity, and the long-run rate is capped at 10/s.
**Why:** it is the only one of the five that explicitly separates "burst allowed" from "sustained rate". Naming what you give up (exact per-window counts) is the senior signal.
**Example:** an overhead water tank filling at a fixed rate: you can draw the full tank at once, then only as fast as it refills.

## Token bucket: why compute the refill on each request instead of running a timer that adds tokens? {#lld05-lazy-refill}
On each `allow`, add `elapsed × rate` tokens (capped at capacity) since the last refill; it is O(1) and needs no thread.
**Why:** a timer per key does not scale to millions of keys and adds a whole concurrency surface.
**Example:** a prepaid metro card balance computed when you tap, not updated every second. Code: `tokens = min(cap, tokens + (now - last) * rate)`.

## Rate limiter: token refill reads `time.monotonic()` directly. Which tests become slow or flaky, and what is the fix? {#lld05-clock}
Every refill and window-reset test needs a real `sleep()`. Inject a `Clock` and use a `FakeClock` the test advances by hand.
**Why:** time is outside input that changes the answer, so it belongs behind an injected interface.
**Example:** `clock.advance(1.0); assert limiter.allow("k")` checks one refilled token instantly.

## Rate limiter at 99/100: two threads hit the same key at once. What goes wrong without a lock? {#lld05-check-then-act}
Both read 99, both decide "allowed", both write 100: two requests pass where one was allowed. Read, decide and write must be one critical section (code only one thread may run at a time).
**Why:** lock the decision, not the data structure.
**Example:** two people booking the last cab seat from two phones.
**Trap:** a thread-safe dict does not help; each step is safe alone, but not the sequence.

## Python rate limiter: "the GIL makes my counter safe". What is wrong with that? {#lld05-gil}
The GIL (Global Interpreter Lock) makes single bytecodes atomic, but read-decide-write is many bytecodes, and a thread switch can land between any two. You still need a lock.
**Why:** the GIL prevents memory corruption, not wrong answers.
**Example:** a cinema usher who lets one person through the door at a time still cannot stop two people being sold the same seat at the counter.
**Also:** CPython 3.13+ has an optional free-threaded build with no GIL at all.

## Rate limiter: how do you lock so that unrelated keys run in parallel? {#lld05-two-level-lock}
Two levels: a brief `table_lock` guards creating a key's lock; then a per-key lock guards the whole decision for that key.
**Why:** one global lock is correct but makes unrelated keys wait. The table lock is held only for a dict lookup or insert.
**Example:** 500 threads on one key with capacity 50 gives exactly 50 allowed, while other keys proceed. Code: `with table_lock: lk = locks.setdefault(key, Lock())`, then `with lk: decide()`.

## Rate limiter: five strategies each keep per-key state of a different shape. What do they share, and where does it go? {#lld05-keyed-base}
The per-key locks and the lazy creation of per-key state, in one `KeyedStrategy` base class; each subclass keeps only its own state shape.
**Why:** the shapes differ (`(tokens, last_refill)` vs a deque vs `(window_id, curr, prev)`), but the locking does not, so it should exist once.
**Example:** every shop in a mall has its own stock, but the mall runs one security desk.

## Rate limiter: how do you make it impossible for a new algorithm class to forget the per-key lock? {#lld05-keyed-template}
The base class's `is_allowed` is concrete: it takes the key's lock and calls an abstract `_decide(state, now)`. Subclasses write only `_decide` (Template Method).
**Why:** the rule (always lock) lives in one place no subclass can skip.
**Example:** a bank where every teller transaction goes through the same audited counter software; tellers only fill in the amount.

## Rate limiter extension: different limits per action, and keys per tenant. What changes? {#lld05-ext-v2}
Hold a map `action → strategy`, and have the caller pass a `Request` whose `get_key()` picks the key (API key, else user id, else IP).
**Why:** the limiter core still never learns what a key means; a rule registry plus a factory is the next step for config-driven rules.
**Example:** a gym with different limits for pool and sauna, keyed by membership card if you have one, else by phone number.

## Rate limiter: why not a Singleton, given the service needs one? {#lld05-no-singleton}
The service often needs several limiters (per endpoint, per tenant), and tests need a fresh one with a fake clock. Build instances at startup and inject them.
**Why:** a Singleton allows only one instance and hides it as global state.
**Example:** `login_limiter = RateLimiter(TokenBucket(5, 0.1), clock)` and `search_limiter = RateLimiter(SlidingCounter(100), clock)` side by side.

## Rate limiter across many app servers: what replaces the in-process per-key lock? {#lld05-singleton-distributed}
The counter moves to Redis, and read-decide-write becomes one atomic server-side step: `INCR` (atomic increment) or a Lua script (several commands run as one step).
**Why:** a local lock only covers one process; Redis sees every server's requests. The cost is a network hop and a new failure mode (Redis down).
**Example:** `INCR rl:user42:1201` returns 101 against a limit of 100, so reject.
**Trap:** `INCR` then a separate `EXPIRE` is two steps; a crash between them leaves a key that never resets. Do both in one Lua script.

## Give the rate limiter design as four beats. {#lld05-pitch}
1. A thread-safe single-process limiter: `allow(key) -> bool`.
2. Five algorithms behind one strategy interface, chosen at construction.
3. Read-decide-write is one critical section per key, locked per key so unrelated keys run in parallel.
4. Time comes from an injected `Clock`, so tests need no `sleep`.
Grade Got it only if you said all four beats.
