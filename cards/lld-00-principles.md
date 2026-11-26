---
topic: LLD · Principles
group: LLD
---

## Parking spots, cinema seats, drivers, lockers, rate-limit counters: what is the one concurrency bug they all share? {#lld00-check-then-act}
Check-then-act race: two threads both check "is it free?", both see yes, and both take it. The check and the act must be one atomic step.
**Why:** between one thread's check and its act, another thread can run its own check, so both act on a stale answer.
**Example:** two people see the last samosa on the counter and both reach for it. Code: `if spot.free: spot.assign(car)` run by two gate threads at once.
**Trap:** a thread-safe dict does not help. Each read or write is safe alone; the read-decide-write sequence is not.

## The check and the act must be atomic. What are the two general ways to do it, and when do you pick each? {#lld00-atomic-fix}
A lock around check plus act (one process, in memory), or an atomic conditional write in the shared store (many servers: `UPDATE ... WHERE status='FREE'`, Redis `SET ... NX`).
**Why:** a lock only protects threads that share it. Once several app servers exist, only the database or Redis sees every request, so it must do the check.
**Example:** a single shop counter uses one cash box with a key (lock). A chain of shops uses the bank, which refuses a debit when the balance is short (conditional write).
**Trap:** checking with a SELECT, then UPDATE-ing in a second statement. That is check-then-act again.

## One lock for the whole system, or one per item? What do you trade? {#lld00-lock-granularity}
Lock the smallest unit an operation must see whole: one lock per show, per key or per locker. Coarser is simpler but serializes unrelated work; finer risks deadlock when one operation needs several locks.
**Why:** threads touching different items never conflict, so making them wait is pure lost throughput.
**Example:** a bank with one queue for every service versus a queue per counter. Code: `locks[key]` per rate-limit key instead of one `global_lock`.
**Trap:** per-seat locks for a multi-seat booking. You must take several locks in a fixed order or risk deadlock; one per-show lock avoids that.

## The system has exactly one parking lot (or vending machine, or limiter). Why not make it a Singleton? {#lld00-no-singleton}
A Singleton (a class that allows one global instance) is hidden global state: tests cannot swap it for a fake, and a second instance later is impossible. Create one object at startup and inject it (pass it in).
**Why:** "there is one" is a fact about deployment, not a rule the class must enforce. Injection keeps the dependency visible in constructors.
**Example:** a school has one principal, but the timetable is still handed to teachers, not fetched from a global noticeboard. Code: `RateLimiter(strategy, clock)` built in `main()` and passed to handlers.
**Trap:** confusing "one shared instance" with the pattern. Sharing one object is fine; forbidding a second is the cost.

## A method acquires a resource (spot, driver, lock, hold). How do you make sure it is always released? {#lld00-release-every-exit}
Release on every exit path: success, cancel, expiry and error. Put the release in one method every path calls, and use `try/finally` (or `with`) so exceptions release too.
**Why:** a missed release never fails loudly. Capacity just shrinks until the system says "full" while empty.
**Example:** a library book never checked back in: the shelf is empty but the system says lent out. Code: `lock.acquire(); try: work() finally: lock.release()`.
**Trap:** testing only the happy path. Test that capacity returns to full after cancel and after an exception too.

## An object has modes (states). When is an enum enough, and when do you write one class per state? {#lld00-enum-vs-state}
Enum plus a transition check when states only change which moves are legal. One class per state (State pattern) when the same input does different work in each state.
**Why:** classes pay off by removing an `if state ==` ladder from every method. With nothing to remove, they are ceremony.
**Example:** a train ticket WAITLISTED → CONFIRMED → CANCELLED is just a label (enum). A vending machine's "select" rejects, dispenses or is ignored depending on mode (classes).
**Trap:** reaching for the pattern because there is a lifecycle. Ask "does behaviour differ per state?" first.

## A rule depends on the current time ("hold expires in 5 minutes"). How do you make it testable without `sleep()`? {#lld00-inject-clock}
Hide time behind a tiny `Clock` interface (`now()`) and inject it: `RealClock` in production, `FakeClock` in tests that you advance by hand.
**Why:** anything from outside that makes output non-deterministic (time, random ids, network calls) goes behind an injected interface. Pure logic you create inline.
**Example:** a cricket umpire's stopwatch you can pause and fast-forward. Code: `clock = FakeClock(0); show.hold(seats); clock.advance(301); assert show.is_free("A1")`.
**Trap:** calling `time.time()` deep inside the logic. Every TTL test then needs a real wait and is flaky.

## Strategy and State have the same class diagram (context holds an interface, several implementations). What actually differs? {#lld00-strategy-vs-state}
Who swaps the object and why. In Strategy the client picks the algorithm from outside, by configuration. In State the state objects switch the context themselves as events arrive.
**Why:** if behaviour changes because of what just happened, it is State. If it changes because someone chose a policy, it is Strategy.
**Example:** choosing UPI or card at checkout is Strategy. A traffic light turning itself green → amber → red is State. Code: `lot.pricing = FlatPricing()` vs `machine.set_state(machine.has_money)` inside `IdleState.insert_money`.

## "Add retry and logging around any sender" vs "pass a log line through console, file and Slack handlers by level": which pattern for each? {#lld00-decorator-vs-chain}
Wrapping is Decorator: same interface, always calls the inner object, adds behaviour around it. Passing along handlers that may act, skip or stop is Chain of Responsibility.
**Why:** a decorator never decides whether the core call happens. A chain link decides whether to handle and whether to pass on.
**Example:** Decorator is gift-wrapping a box in layers. Chain is a complaint escalated clerk → manager → director. Code: `Retry(Logging(SmsSender()))` vs `console.set_next(file).set_next(slack)`.

## Notifying listeners in-process vs publishing to a message queue (Kafka, SQS): what is the real difference? {#lld00-observer-vs-pubsub}
Observer: the subject holds its listeners and calls them directly, same process, usually synchronously. Pub/sub: a broker sits between, so publisher and subscribers never know each other and can run later or elsewhere.
**Why:** the broker buys decoupling in time and space (durable, retryable), at the cost of a network hop and eventual delivery.
**Example:** a teacher announcing in class (Observer) vs posting on the school WhatsApp group read whenever (pub/sub). Code: `for l in self.listeners: l.on_event(e)` vs `producer.send("trip-events", e)`.
**Trap:** saying "Observer" in an LLD round and then drawing Kafka. Use Observer in memory; name pub/sub only for the distributed version.

## Creating objects: when do you use a Factory, and when a Builder? {#lld00-factory-vs-builder}
Factory picks which class to create from an input (`"EQUAL"` → `EqualSplit()`). Builder assembles one complex object step by step from many optional parts.
**Why:** a factory hides the choice of type; a builder hides a long, error-prone constructor.
**Example:** a tea stall asked for "masala" hands you that kind of tea (Factory). A Subway sandwich built bread, then cheese, then veggies (Builder). Code: `SplitFactory.create("EQUAL")` vs `Notification.builder().to(u).channel(SMS).retry(3).build()`.

## Add "electric" behaviour to a vehicle: subclass it, or give it a part? When do you prefer which? {#lld00-composition-vs-inheritance}
Prefer composition (has-a: hold an object and delegate) when behaviour varies along several axes or changes at runtime. Use inheritance (is-a) only for a true, stable subtype.
**Why:** subclasses multiply per combination (ElectricCar, ElectricTruck, HybridCar…) and are fixed at creation; parts can be mixed and swapped.
**Example:** a phone with a replaceable cover vs buying a new phone for each colour. Code: `Car(engine=ElectricEngine())` instead of `class ElectricCar(Car)`.
**Trap:** inheriting just to reuse a few methods. If "X is a Y" sounds wrong out loud, compose.

## A 45-minute LLD round: what are the stages, in order? {#lld00-round-flow}
1. Clarify entities, operations and constraints (about 5 min).
2. Classes, relationships and the public API (about 10 min).
3. Code one key flow, with patterns at the points of change (about 15 min).
4. Concurrency and failure paths, then extensions (about 10 min).
Grade Got it only if you said all four beats in order.
**Why:** skipping step 1 builds the wrong thing; skipping step 4 loses the usual differentiator (bookings, limiters, ride matching).
**Example:** a doctor's visit: history, examination, treatment, follow-up.
