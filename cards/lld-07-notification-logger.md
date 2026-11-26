---
topic: LLD 07 · Notification / Logger
group: LLD
---

## What is in scope for the notification service? {#lld07-scope}
- Events, not direct calls: services publish, users subscribe to topics.
- Email, SMS and Push behind one interface.
- Per-user preferred channels.
- One `{placeholder}` template per topic.
- Retry with backoff.
- Thread-safe subscribe and publish.

## Which patterns does the notification service use, and for what? {#lld07-patterns}
- Observer (pub-sub): `EventBus` and `Subscriber`.
- Simple Factory: `ChannelFactory`.
- Decorator: `RetryingChannel`, `LoggingChannel`.
- Strategy: the `Channel` interface.
**Why:** each solves one named pain. Notify without knowing listeners, build by type, add retry once, swap delivery.

## Is a topic-based event bus Observer or pub/sub? {#lld07-observer-vs-pubsub}
Strictly pub/sub, the broker flavour of Observer. In Observer, subscribers register on the subject itself: `order.add_listener(x)`. In pub/sub they register on a topic at a middleman: `bus.subscribe("OrderPlaced", x)`.
**Example:** following one friend on Instagram versus subscribing to a newspaper section.

## How does `RetryingChannel` add retry, and how do you test it? {#lld07-retry-decorator}
It is-a `Channel` and has-a `Channel`. `send` calls `inner.send`. On `DeliveryError` it waits `base_delay × 2^(attempt-1)` and retries. With 3 attempts there are two waits (0.1 s, 0.2 s), then it re-raises.
**Why:** stack at wiring: `RetryingChannel(LoggingChannel(SMSChannel()))`. Inject `sleep` so tests pass `waits.append` and assert `[0.1, 0.2]` with no real waiting.

## The SMS provider is down. What happens to the other channels? {#lld07-failure-isolation}
`RetryingChannel` tries 3 times, then re-raises `DeliveryError`. `NotificationService` catches it per channel, records it in `failures`, and still sends email.
**Why:** one failing channel must not abort the loop. In production, failures go to a dead-letter queue (a parking queue for failed messages, replayed later).

## What is the race in `EventBus.publish`, and how is it fixed? {#lld07-bus-race}
`publish` iterates the subscriber list while `unsubscribe` removes from it. In Python this silently skips an element, and in Java it throws `ConcurrentModificationException`. Fix: copy-on-read. Under the lock take `list(subscribers)`, release, then notify.

## Why not hold the lock for the whole `publish`? {#lld07-lock-outside}
Sends are slow, so every `subscribe` would wait behind them. A subscriber that calls `subscribe` or `unsubscribe` inside `on_event` deadlocks on a non-reentrant lock (a thread that already holds it blocks forever if it asks again).
**Trade-off:** someone who unsubscribes mid-publish may still get that one event.

## Why a factory registry and not `if kind == "sms"` in `notify`? {#lld07-factory}
`ChannelFactory.create(kind)` looks up a registry dict, so `notify` never changes.
**Example:** adding WhatsApp means writing `WhatsAppChannel` and adding one registry line.
**Also:** Abstract Factory is rejected. There is one product family, so a Simple Factory is enough.

## Extension: notify a group that contains users and sub-groups. {#lld07-composite}
Composite. `GroupSubscriber(Subscriber)` holds a list of child `Subscriber`s (users or other groups) and forwards `on_event` to each.
**Why:** the bus treats a group exactly like one user. It is a pure addition because `Subscriber` is already an interface.

## Publishing is synchronous and slow. How do you fix it? {#lld07-async}
Producer-consumer: `publish` puts events on a queue, and worker threads take them off and call subscribers.
**Why:** the `EventBus` API stays the same and only its insides change.

## How does the logger use Chain of Responsibility? {#lld07-logger-chain}
Each `LogHandler` has a threshold and a `Sink`. `handle` writes if `level >= threshold`, then always passes to the next, so an ERROR reaches console, file and alerts.
**Why:** this is the pass-along variant. Textbook GoF stops at the first handler that handles it.
**Also:** `Logger.log` takes one lock around `chain.handle`, so threads cannot interleave writes to one file.

## Why not make `Logger` or `NotificationService` a Singleton? {#lld07-no-singleton}
Hidden global state. Tests cannot give each test its own `MemorySink`, lines leak between tests, and parallel tests break.
**Why:** inject the instance through the constructor instead.

## What does `NotificationService.notify` do? {#lld07-notify}
It renders the topic's template with `{name}` filled in automatically, then loops over the user's preferred channels and sends on each. It is the "how"; `EventBus` is the "who".
**Why:** they change for different reasons (quiet hours versus topic wildcards). A subscriber need not be a user either, so analytics can subscribe.

## Extension: add a Slack destination for ERROR logs, and what are the log levels? {#lld07-logger-ext}
One new link: `set_next(LogHandler(ERROR, SlackSink()))`. No `if level == ERROR` in the logger.
**Also:** `LogLevel` is an `IntEnum` (DEBUG=10, INFO=20, ERROR=30) so `>=` works. `Logger.min_level` is the global filter that drops lower levels early.

## Give the 60-second pitch for the notification service. {#lld07-pitch}
Services publish events on an `EventBus` (Observer). A `UserSubscriber` asks `NotificationService` to render the template and send on each preferred channel. Channels share one interface and come from a factory. Retry and logging are stacked Decorators. One failure does not stop the others. The race is publish versus unsubscribe, fixed by snapshot-then-notify.
