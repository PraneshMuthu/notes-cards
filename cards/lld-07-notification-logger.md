---
topic: LLD 07 · Notification / Logger
group: LLD
---

## Notification service: the Order service calls `bus.publish(Event("OrderPlaced", ...))` and users register with `bus.subscribe("OrderPlaced", x)`. Which flavour of notify-on-event is this, and what does the middleman buy? {#lld07-observer-vs-pubsub}
Pub/sub: subscribers register on a topic at a broker (`EventBus`), not on the publisher itself, so publisher and subscribers never reference each other.
**Why:** a new listener (analytics, loyalty points) is one `subscribe` call, and the Order service never changes or even knows it exists.
**Example:** a railway station announcement: the announcer speaks once to "Platform 3", whoever is standing there hears it.

## Notification service: add retry with exponential backoff to every channel without editing the SMS, Email or Push classes. How? {#lld07-retry-decorator}
A `RetryingChannel` that is-a `Channel` and has-a `Channel`: `send` calls `inner.send`, and on `DeliveryError` waits `base_delay × 2^(attempt−1)` and tries again, re-raising after the last attempt.
**Why:** it shares the interface it wraps, so layers stack at wiring time: `RetryingChannel(LoggingChannel(SMSChannel()))`, and no channel class knows about retries.
**Example:** base 0.1 s, 3 attempts: two waits, 0.1 × 2⁰ = 0.1 s, then 0.1 × 2¹ = 0.2 s.

## Notification service: the retry wrapper waits 0.1 s then 0.2 s. How do you test those waits without the test sleeping? {#lld07-retry-test}
Inject the sleep function: production passes `time.sleep`, the test passes `waits.append` and asserts `waits == [0.1, 0.2]`.
**Why:** the wrapper only calls whatever `sleep` it was given, so the test records the delays instead of spending them and runs in milliseconds.
**Example:** a stopwatch app's test doesn't wait a real minute; it checks that "60 s" was requested.

## Notification service: the SMS provider is down. What happens to the email for the same user? {#lld07-failure-isolation}
It is still sent. Retry gives up on SMS and re-raises `DeliveryError`; `NotificationService.notify` catches it per channel, records it in `failures`, and moves on to email.
**Why:** one failing channel must not abort the loop. In production failures go to a dead-letter queue (a parking queue for failed messages, replayed later).
**Example:** your bank's OTP SMS fails, but the same alert still lands in your email.

## Notification service: `publish` loops over a topic's subscribers while another thread unsubscribes. What breaks, and what is the fix? {#lld07-bus-race}
Removing from a Python list mid-loop silently skips the next subscriber (Java throws `ConcurrentModificationException`). Fix: copy-on-read: under the lock take `list(subscribers)`, release, then notify from the copy.
**Why:** the loop now walks a private copy nobody else can change, and the lock is held only for the copy.
**Example:** subscribers [A, B, C]: while notifying A, A is removed; the list becomes [B, C], the index moves to 1, and B is never notified.

## Notification service: why not hold the bus lock for the whole of `publish`? {#lld07-lock-outside}
Every `subscribe` would wait behind slow sends, and a subscriber that unsubscribes inside `on_event` would deadlock (a plain `Lock` blocks forever if the thread holding it asks again).
**Why:** snapshot-then-notify keeps the critical section (the code run while holding the lock) to one list copy.
**Trade-off:** someone who unsubscribes mid-publish may still get that one event.
**Example:** a shop that locks its door during every delivery: nobody can walk in until the van leaves.

## Notification service: `notify` needs a channel object for "sms", "email" or "push". How do you avoid an if/elif on the kind? {#lld07-factory}
A registry dict from `ChannelType` to class; `ChannelFactory.create(kind)` looks it up and raises `ValueError` for an unknown kind.
**Why:** adding WhatsApp is one new class plus one registry line, and `notify` never changes. One product family, so a simple factory beats Abstract Factory.
**Example:** a kirana shop's price list: a new item is one new line, not a new rule for the cashier.

## Notification service: marketing wants to notify "Mumbai-Premium", a group holding users and sub-groups. How, without changing `EventBus`? {#lld07-composite}
A `GroupSubscriber` that is itself a `Subscriber`, holds child subscribers (users or other groups) and forwards `on_event` to each (Composite).
**Why:** the bus treats a group exactly like one user, so it is a pure addition because `Subscriber` is already an interface.
**Example:** "Mumbai-Premium" contains "Andheri-Premium", which contains users; one event fans out down the tree.

## Notification service: `publish` blocks until every email is sent. How do you fix it without changing the `EventBus` API? {#lld07-async}
Producer-consumer: `publish` puts the event on a queue and returns; worker threads take events off and call the subscribers.
**Why:** callers still call `publish(event)`; only the bus's insides change, and slow sends now cost a worker, not the caller.
**Example:** a restaurant token counter: you order, get a token and sit down while the kitchen cooks.

## Logger: an ERROR must reach console, file and alerts, a DEBUG only the console. How are the handlers arranged? {#lld07-logger-chain}
A linked line of `LogHandler`s, each with a threshold and a `Sink`: `handle` writes if `level >= threshold`, then always passes to the next (Chain of Responsibility).
**Why:** each destination is one link, so adding or removing one never touches the others.
**Example:** console (DEBUG+) → file (INFO+) → alerts (ERROR): an INFO line lands in console and file only.
**Trap:** textbook GoF stops at the first handler that handles it; this is the pass-along variant.

## Logger: two threads log at the same moment to the same file. What stops their lines interleaving? {#lld07-logger-lock}
`Logger.log` takes one lock around `chain.handle`, so one message finishes every sink before the next message starts.
**Why:** each sink's write is safe alone, but a message spans several sinks, so the whole pass must be one step.
**Example:** two people dictating to one typist: without turns, you get half a sentence from each.

## Logger and notification service: where exactly does a global Singleton instance hurt? {#lld07-no-singleton}
In tests: each test wants its own `MemorySink` to assert on, but a Singleton logger shares one, so lines leak between tests and parallel tests break.
**Why:** inject the instance through the constructor, so each test builds a fresh one.
**Example:** two students sharing one answer sheet: you can't tell whose mistake is whose.

## Notification service: why are `EventBus` and `NotificationService` two classes, not one? {#lld07-notify}
They change for different reasons: the bus decides who hears an event (topics, later wildcards); the service decides how a user is told (template, preferred channels, later quiet hours).
**Why:** a subscriber need not be a user at all, so analytics can listen on the bus without going near templates or channels.
**Example:** the post office sorts mail by pincode; the postman decides whether to hand it over or leave it with the watchman.

## Logger: add "send ERROR logs to Slack" without editing `Logger`. How? {#lld07-logger-ext}
Append one link: `set_next(LogHandler(LogLevel.ERROR, SlackSink()))`.
**Why:** the chain is open for extension; a new destination is a new link, never an `if level == ERROR` inside `Logger`.
**Example:** adding a new CC to an email thread: nobody else's inbox rules change.

## Logger: why make `LogLevel` an `IntEnum` rather than a plain `Enum`? {#lld07-log-levels}
So `level >= threshold` is a plain integer comparison; a plain `Enum` has no ordering and `<` raises `TypeError`.
**Why:** both the handler thresholds and `Logger.min_level` filter by "this level or higher", which needs an order.
**Example:** this design uses its own values DEBUG 10, INFO 20, ERROR 30.
**Trap:** quoting those as standard. Python's `logging` uses DEBUG 10, INFO 20, WARNING 30, ERROR 40, CRITICAL 50.

## Give the notification service design as four beats. {#lld07-pitch}
1. Services publish events on an `EventBus`; a `UserSubscriber` asks `NotificationService` to render the template and send.
2. Channels share one interface and come from a factory registry.
3. Retry and logging are stacked wrappers; one channel's failure does not stop the others.
4. Race: publish versus unsubscribe, fixed by snapshot-then-notify.

Grade Got it only if you said all four beats.
