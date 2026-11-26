---
topic: HLD 05 · Notification System
group: HLD
---

## Pitch a notification system (push, SMS, email) in 30 seconds: say the 4 beats. {#hld05-pitch}
(1) Services call a Notification API with an idempotency key; it dedups in Redis and checks preferences. (2) It logs QUEUED, publishes to a queue per channel and priority, returns 202. (3) Separate worker pools call APNs/FCM, an SMS gateway or SES (email). (4) Campaigns drain at the provider quota, so an OTP never waits.
**Why:** the bottleneck is the providers' rate limits, so the design is queues plus pacing, not more servers.
**Example:** a post office: one counter, one bin per courier, each courier empties only its own bin.
**Trap:** grade Got it only if you said all 4 beats.

## Notifications: why put a queue between the API and the providers? {#hld05-why-queue}
So the API can return `202 Accepted` at once and never wait on a slow or down provider.
**Why:** the queue (a durable to-do list) also absorbs a 100M-user campaign burst and drains it at the provider's rate, and a failed send is still in the queue to retry.
**Example:** a restaurant takes your order slip and gives you a token; you don't stand in the kitchen while it cooks.

## Notifications: an OTP SMS must never wait behind a 100M promo blast. How do you lay out the queues? {#hld05-queue-layout}
One queue per channel × priority: push, SMS, email × high, normal, low = 9 topics, each with its own worker pool.
**Why:** a single FIFO queue causes head-of-line blocking (the front item holds up everything behind it). Separate channels also fail independently: an SMS outage doesn't stall push.
**Example:** a hospital with one queue would make a heart attack wait behind 200 check-ups; the emergency door is a separate line.

## Notifications: from 100M DAU × 5 notifications/day, derive the peak send rate. {#hld05-volume-math}
~17K/s at peak: 500M/day ÷ 86,400 ≈ 5,800/s average, × 3.
**Why:** this normal peak is smaller than one unthrottled campaign, which is why marketing needs its own throttled lane.
**Example:** 500M ÷ ~10⁵ s ≈ 5,000/s; × 3 ≈ 15–17K/s. Push takes ~70% of it (~12K/s).

## Notifications: which store for the notification log, and what partition key? {#hld05-log-store}
Cassandra, partition key `notification_id` (time-sortable, like UUIDv7). Rows expire by TTL after 90 days.
**Why:** every hot access is by that ID (worker status check, webhook update, status API), with no joins. Each row is written ~3 times (QUEUED, SENT, DELIVERED), ~50K writes/s at peak; Postgres would need hand-sharding.
**Example:** ~250 GB/day × 90 days ≈ 22.5 TB, spread across nodes by ID.

## Notifications: why does each log row carry a status (QUEUED → SENT → DELIVERED/FAILED)? {#hld05-status-purpose}
Each status is the fact a recovery path checks: a row stuck in QUEUED is re-queued; a job whose row is already SENT is skipped; FAILED triggers a fallback channel.
**Why:** without a recorded state you cannot retry safely, dedup, or debug a "never got my OTP" ticket.
**Example:** a courier's tracking page: "booked → dispatched → delivered" tells support exactly where a parcel stopped.

## Notifications: a worker crashes after FCM accepted the push but before recording it. Why accept the duplicate? {#hld05-at-least-once}
Because the alternative, at-most-once (mark done first, then send), would lose the OTP on that crash. Losing an OTP breaks login; a duplicate is recoverable.
**Why:** the worker hadn't committed its Kafka offset (its "read up to here" bookmark), so another worker resends. Dedup and collapse IDs then hide most duplicates.
**Example:** two "your order shipped" pings is mildly annoying; no OTP means you can't log in.

## Notifications: where do you dedup, given APNs/FCM accept no idempotency key? {#hld05-dedup-layers}
Two layers: the API stores the caller's `Idempotency-Key` (Redis `SET NX`, 24 h) and returns the same ID on retry; the worker skips if the log row says SENT.
**Why:** the providers can't dedup for you, so duplicates must die before the provider call. Layer 1 catches caller retries; layer 2 catches queue redeliveries.
**Example:** order service retries `order-8812-shipped` after a timeout; the API returns the original ID and sends nothing new.

## Notifications: why can't you get exactly-once delivery to a provider? {#hld05-no-exactly-once}
The provider call and your DB write can't be one atomic step. A crash in the few ms between "FCM accepted" and "log says SENT" yields one duplicate.
**Why:** so shrink the window and hide the leftover: set `apns-collapse-id` and the Android notification `tag` to `notification_id`, so the phone shows one.
**Example:** two identical pushes with the same tag replace each other in the tray instead of stacking.
**Trap:** FCM `collapse_key` only merges messages still waiting on FCM for an offline phone.

## Notifications: the API crashes after saving the Redis idempotency key but before publishing. What then? {#hld05-pending-state}
The caller's retry is wrongly swallowed. Fix: store the key as PENDING, flip to QUEUED after the publish; a retry finding PENDING older than ~30 s re-publishes.
**Why:** "key exists" must mean "work done", not "work started". A transactional outbox is the heavier alternative.
**Example:** a shop marks your token "paid" only after the card machine prints the slip, not when you hand over the card.

## Notifications: a provider call fails. What do you decide before retrying? {#hld05-retries}
Whether the error is retryable. Timeouts, 5xx and 429 are retried; permanent errors (invalid number, app uninstalled) are marked FAILED and the dead token deleted.
**Why:** retrying a permanent error never succeeds and burns quota and queue capacity.
**Example:** a wrong phone number stays wrong on the 5th try; a busy server may be fine in 2 s.

## Notifications: what retry schedule keeps an OTP useful, and where does a send go when retries run out? {#hld05-backoff}
5 retries with exponential backoff (1, 2, 4, 8, 16 s plus jitter), ~31 s of waiting in all; then the dead-letter queue (DLQ, a parking lot for failed sends).
**Why:** jitter (random extra delay) stops workers retrying in lockstep; a retry topic (side queue with a "not before" time) keeps the main queue flowing. ~31 s is still inside an OTP's useful life; infinite retry clogs queues.
**Example:** 1 + 2 + 4 + 8 + 16 = 31 s of backoff across 6 attempts (1 original + 5 retries).

## Notifications: Twilio is down for 20 minutes. What do you do? {#hld05-circuit-breaker}
A per-provider circuit breaker opens (error rate > 50% over 30 s) and SMS routes to a fallback provider such as MSG91.
**Why:** retries can't outlast a 20-minute outage, and every call to a dead provider wastes a worker's time.
**Example:** UPI apps switch you to another bank's server when one bank is down, instead of retrying the dead one.
**Trap:** push has no fallback provider (APNs/FCM are the only path), so offer "send via SMS instead" for OTP.

## Notifications: how long does a 100M-user campaign take at a 20K/s provider quota? {#hld05-campaign}
~83 minutes: 100M ÷ 20,000/s = 5,000 s. Adding workers can't make it faster.
**Why:** the provider quota, not your fleet, sets the drain rate. 40 workers (20K ÷ 500 sends/s each) is enough; more just hit 429s.
**Example:** a 5,000-seat stadium with one gate letting in 1 person/s takes 83 minutes to fill, however many ushers you hire.

## Notifications: how do you keep a campaign under the provider quota across 40 workers? {#hld05-campaign-pace}
A token bucket shared in Redis: a counter refilled at 20K/s, and each send takes one token before calling the provider.
**Why:** each worker can't see the others' rate, so the limit must be one shared counter. Exceeding it brings 429s and, for SMS, can get your sender ID blocked.
**Example:** a petrol pump with a token dispenser: 20 tokens a minute, whichever attendant serves next takes one.

## Notifications: marketing wants a 100M-user campaign delivered at 6 pm sharp, but it takes 83 minutes. What do you offer? {#hld05-campaign-timing}
Start early (about 5:15) with scheduled delivery, or accept a 6:00–7:20 spread. Never exceed the quota to go faster.
**Why:** the drain time is fixed by quota; only the start time is yours to move.
**Example:** a wedding caterer starts cooking at 4 pm for a 7 pm dinner rather than hiring 10 kitchens.
**Trap:** promotional SMS in India is limited to 9 am–9 pm (TRAI rules), so a late start may push sends outside the window.

## Notifications: with ~100M DAU, how many send workers do you run? {#hld05-worker-math}
~75–90: ~35 for normal peak plus ~40 for a throttled campaign.
**Why:** a worker keeps ~50 calls in flight at ~100 ms each, so 500 sends/s each. 17K ÷ 500 ≈ 34; a campaign at 20K/s adds 40. The ceiling is the provider's rate, not your CPU.
**Example:** a call centre with 50 lines per agent and 100 ms calls handles 500 calls/s per agent.

## Notifications: the Redis idempotency store goes down. Send anyway or refuse? {#hld05-redis-down}
Send anyway (fail open), because here a wrong "allow" costs only a possible duplicate, while refusing loses OTPs. Worker-side SENT checks still catch queue redeliveries.
**Why:** choose by the cost of a wrong allow. A rate limiter facing abuse may decide differently; here the downside is one extra ping. Run Redis with a replica and Sentinel (auto-failover) so this is brief.
**Example:** if the bouncer's guest-list tablet dies at a wedding, you let guests in rather than lock out the bride's family.

## Notifications: a user opts out while a campaign is in flight. How fast must it take effect? {#hld05-optout}
Within about a minute: preferences are checked at enqueue, and the worker re-checks its cached copy (~1 min TTL) just before sending.
**Why:** a campaign takes over an hour, so an enqueue-time check alone would keep sending for up to 83 minutes after the opt-out.
**Example:** you tap "stop promos" at 6:10; with only the enqueue check you'd still get promos queued at 6:00.
**Trap:** for SMS the DND (Do Not Disturb) registry check is a legal requirement in India, not a nicety.

## Notifications: what is the difference between SENT and DELIVERED, and how do you learn DELIVERED? {#hld05-delivered}
SENT = the provider accepted it. DELIVERED arrives later via the provider's webhook (a callback to your API), or for push, the app pinging back on display.
**Why:** acceptance is not arrival: a phone can be off for days. Webhooks carry SMS DLRs (delivery reports) and SES (Amazon email) events. Callers need DELIVERED/FAILED to decide fallbacks.
**Example:** a courier's "dispatched" is not "delivered"; only the doorstep scan tells you it arrived.

## Notifications: what is the real bottleneck, and how does it shape the design? {#hld05-traps}
The providers' rate limits (FCM/APNs quotas, SMS gateway throughput), not your servers' CPU.
**Why:** that's why you queue (absorb bursts), isolate priorities (OTP never behind promos), pace campaigns with a shared token bucket, and quote drain time = users ÷ quota.
**Example:** a 100M campaign at 20K/s takes ~83 min, however many workers you add.

## Notifications: a Kafka broker dies. Why is no OTP lost? {#hld05-kafka-dies}
Each message is on 3 brokers, and with `acks=all` and `min.insync.replicas=2` a publish succeeds only once at least 2 in-sync copies (replicas fully caught up) have it.
**Why:** if the leader dies, a follower holding every acknowledged message takes over and producers retry against it. SQS does the same across data centres for you.
**Example:** a bank confirms your deposit only after two branches have recorded it, so one fire loses nothing.

## Notifications: how do you enforce "at most 3 marketing messages per user per day"? {#hld05-marketing-cap}
At enqueue: `INCR rl:{user}:marketing:{date}` in Redis; if the result is over 3, skip. That counter enforces the cap; SENT rows in the log are only the audit trail.
**Why:** checking before the queue means capped users never cost a provider send. One counter avoids two sources of truth disagreeing.
**Example:** the 4th promo of the day for user 123 sees INCR return 4 and is dropped before it is queued.
**Trap:** the counter counts enqueued, not delivered, messages, so a later skip (opt-out) still uses up a slot; acceptable for a cap.

## Notifications at 10× (1B DAU, ~170K/s peak): what breaks first? {#hld05-10x}
Provider quotas and SMS cost, not your infrastructure: Kafka partitions and workers scale by adding more.
**Why:** quotas are negotiated, not bought by the box. Levers: raise quotas, shift traffic from SMS to push, and use FCM topic messaging for identical broadcasts (one request, fanned out by Google).
**Example:** SMS at 10% of 5B/day is 500M paid texts a day; the same message as a push costs nothing per send.
