---
topic: LLD 07 · Notification / Logger
group: LLD
---

## What triggers a notification, and what is the scope? {#lld07-scope}
Events, not direct calls: services publish events and users subscribe to topics. Channels are Email, SMS and Push (WhatsApp later). Users pick preferred channels, with one `{placeholder}` template per topic, retry with backoff, and thread-safe subscribe and publish. Real providers and queues are out.

## Which patterns does the notification service use, and for what? {#lld07-patterns}
- Observer (pub-sub): `EventBus` and `Subscriber`.
- Simple Factory: `ChannelFactory`.
- Decorator: `RetryingChannel`, `LoggingChannel`.
- Strategy: the `Channel` interface.
**Why:** each solves one named pain. Notify without knowing listeners, build by type, add retry once, swap delivery.

## Is a topic-based event bus Observer or pub/sub? {#lld07-observer-vs-pubsub}
Strictly pub/sub, the broker flavour of Observer. In Observer, subscribers register on the subject itself: `order.add_listener(x)`. In pub/sub they register on a topic at a middleman: `bus.subscribe("OrderPlaced", x)`.
**Example:** following one friend on Instagram versus subscribing to a newspaper section.

## Why split `EventBus` from `NotificationService`? {#lld07-bus-vs-service}
The bus knows who to tell. The service knows how: render the template, loop over the user's preferred channels. They change for different reasons (topic wildcards versus quiet hours).
**Why:** a subscriber need not be a user. An analytics listener can subscribe too.

## How does `RetryingChannel` add retry without touching any channel? {#lld07-retry-decorator}
It is-a `Channel` and has-a `Channel`. `send` calls `inner.send`, and on `DeliveryError` waits `base_delay × 2^(attempt-1)` (0.1, 0.2, 0.4 s) and retries. After the last attempt it re-raises.
**Why:** stack at wiring time: `RetryingChannel(LoggingChannel(SMSChannel()))`. Subclassing would explode into `RetryingLoggingSMSChannel` and so on.

## How do you test retry backoff without waiting? {#lld07-inject-sleep}
Inject `sleep` into the retrying channel. Tests pass `waits.append` and assert the delays were `[0.1, 0.2]` with no real waiting.
**Trap:** real `time.sleep` in tests makes them slow.

## The SMS provider is down. What happens to the other channels? {#lld07-failure-isolation}
`RetryingChannel` tries 3 times, then re-raises `DeliveryError`. `NotificationService` catches it per channel, records it in `failures`, and still sends email.
**Why:** one failing channel must not abort the loop. In production, failures go to a dead-letter queue for later replay.

## What is the race in `EventBus.publish`, and how is it fixed? {#lld07-bus-race}
`publish` iterates the subscriber list while `unsubscribe` removes from it. In Python this silently skips an element, and in Java it throws `ConcurrentModificationException`. Fix: copy-on-read. Under the lock take `list(subscribers)`, release, then notify.

## Why not hold the lock for the whole `publish`? {#lld07-lock-outside}
Sends are slow, so every `subscribe` would wait behind them. A subscriber that calls `subscribe` or `unsubscribe` inside `on_event` would deadlock on a non-reentrant lock.
**Trade-off:** someone who unsubscribes mid-publish may still get that one event.

## Why a factory registry and not `if kind == "sms"` in `notify`? {#lld07-factory}
`ChannelFactory.create(kind)` looks up a registry dict, so `notify` never changes.
**Example:** adding WhatsApp means writing `WhatsAppChannel` and adding one registry line.
**Also:** Abstract Factory is rejected. There is one product family, so a Simple Factory is enough.

## Extension: notify a group that contains users and sub-groups. {#lld07-composite}
Composite. `GroupSubscriber(Subscriber)` holds a list of child `Subscriber`s (users or other groups) and forwards `on_event` to each.
**Why:** the bus treats a group exactly like one user. It is a pure addition because `Subscriber` is already an interface.

## Publishing is synchronous and slow. How do you fix it? {#lld07-async}
Put events on a queue and have worker threads call subscribers (producer-consumer). The `EventBus` API stays the same and only its insides change.

## How does the logger use Chain of Responsibility? {#lld07-logger-chain}
Each `LogHandler` has a threshold and a `Sink`. `handle` writes if `level >= threshold`, then always passes to the next. An ERROR reaches console, file and alerts.
**Why:** this is the pass-along variant. Textbook GoF stops at the first handler that handles it.
**Example:** console DEBUG+, file INFO+, alerts ERROR only.

## Why is `LogLevel` an `IntEnum`, and what is `min_level`? {#lld07-loglevel}
DEBUG=10, INFO=20, ERROR=30, so `<` and `>=` work directly. `Logger.log` returns early if `level < min_level`, the global filter (for example, drop DEBUG in prod). Then it calls the head handler.

## Why not make `Logger` or `NotificationService` a Singleton? {#lld07-no-singleton}
Hidden global state. Tests cannot give each test its own `MemorySink`, lines leak between tests, and parallel tests break.
**Why:** inject the instance through the constructor instead.

## How is concurrent logging kept safe? {#lld07-logger-lock}
Two threads can interleave writes to the same file. `Logger.log` takes one lock around `chain.handle`, so each message goes through the whole chain in one piece.
