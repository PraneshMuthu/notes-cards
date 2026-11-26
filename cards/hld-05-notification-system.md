---
topic: HLD 05 · Notification System
group: HLD
---

## Give the 30-second pitch for a notification system (push, SMS, email). {#hld05-pitch}
Internal services call a Notification API (idempotency key, template, priority). It dedups in Redis, checks preferences and rate limit, logs QUEUED in Cassandra, publishes to a queue per channel and priority, and returns 202. Separate worker pools call APNs/FCM, an SMS gateway or SES.
**Why:** at 100M DAU that is ~500M/day, ~17K/s peak, and a 100M campaign is drained at the provider quota without delaying an OTP.
**Example:** a post office: counter, one bin per courier, each courier empties only its own bin.

## Why put a queue between the API and the providers? {#hld05-why-queue}
A queue (Kafka/SQS) is a durable to-do list. The API returns `202 Accepted` and never waits on the provider.
**Why:**
- the provider can be slow or down, so the caller (auth service) must not wait
- bursts: a 100M campaign is absorbed and drained at the provider's rate
- retries: a failed send is still in the queue

## Why one queue per channel AND per priority? {#hld05-queue-layout}
9 topics: push, SMS, email × high, normal, low, each with its own worker pool.
**Why:** one FIFO queue causes head-of-line blocking (the item at the front holds up everything behind it): an OTP would wait behind millions of promos. Different channels also fail independently, so an SMS outage must not block push.
**Example:** OTP SMS peak ~1,000/s ÷ 500 per worker = 2 workers, run 6 for headroom.

## What are the notification volume numbers and their derivation? {#hld05-volume-math}
100M DAU × 5/day = 500M/day ÷ 86,400 ≈ 5,800/s avg, × 3 ≈ 17K/s peak. Split: push 70% (12K/s peak), email 20% (3.5K/s), SMS 10% (1.7K/s, of which OTP ~1K/s).
**Why:** the numbers decide the design: a campaign (28K/s) is bigger than normal push peak (12K/s), so marketing must be throttled on its own lane.

## Why Cassandra for the notification log, and what is the partition key? {#hld05-log-store}
Partition key `notification_id` (time-sortable, like UUIDv7). ~250 GB/day, ~22.5 TB for 90 days, rows expire by TTL.
**Why:** every hot access is by that id (worker checks status, webhook updates it, status API reads it). Each notification's one row is written ~3× (QUEUED, SENT, DELIVERED): 17K × 3 ≈ 50K writes/s at peak. Append-heavy key lookups, no joins; Postgres would need manual sharding.

## Why store a status in the log at all? {#hld05-status-purpose}
Each status answers a real question:
- QUEUED (written before enqueue): a row stuck too long is re-queued, and a caller retry finds it
- SENT: a worker that gets a duplicate job skips it; the marketing cap is a count of SENT rows
- DELIVERED / FAILED: callers can fall back (push failed, try SMS) and support can debug
**Why:** without the log you cannot retry safely, dedup, or debug.

## Why at-least-once delivery and not at-most-once? {#hld05-at-least-once}
A worker calls FCM, FCM accepts, the worker crashes before committing its queue offset, so another worker resends. At-most-once (commit first, then send) would lose the OTP on a crash.
**Why:** losing an OTP breaks login, while a duplicate is recoverable. So accept at-least-once and add dedup.

## Where do you dedup notifications? {#hld05-dedup-layers}
Two layers:
1. API: `Idempotency-Key` (caller-chosen per real event, e.g. `order-8812-shipped`) via Redis `SET NX`, TTL 24 h. A retry gets the same `notification_id`.
2. Worker: read the log row first; if status is `SENT`, ack and skip.
**Why:** idempotent means doing it twice has the effect of once. APNs/FCM don't support provider-side idempotency keys, so don't rely on it.

## Why can't you get exactly-once to a provider? {#hld05-no-exactly-once}
You cannot make "provider call" and "DB write" one atomic step. A crash in the few ms between FCM accepting and the log saying SENT gives one duplicate.
**Why:** shrink the window and hide the leftover: set `apns-collapse-id` and the Android `tag` to `notification_id`, so the device shows one.
**Trap:** FCM `collapse_key` is weaker: it only collapses messages still waiting on FCM for an offline device.

## The API crashes after writing the Redis idempotency key but before publishing. What then? {#hld05-pending-state}
The caller's retry would be wrongly swallowed. Store the key as `PENDING`, set `QUEUED` only after the publish succeeds. A retry that sees `PENDING` older than ~30 s re-publishes.
**Why:** a transactional outbox is the heavier alternative, not needed at this depth.

## How do workers handle provider errors? {#hld05-retries}
Classify first. Retryable (timeout, 5xx, 429): exponential backoff 1, 2, 4, 8, 16 s plus jitter (random delay so workers don't retry in lockstep), via a retry topic. Permanent (invalid phone, uninstalled app): mark FAILED, delete the dead push token. After 5 retries: dead-letter queue (DLQ).
**Why:** 5 attempts ≈ 31 s keeps an OTP useful; infinite retry clogs queues.
**Trap:** retrying permanent errors never succeeds.

## Twilio is down for 20 minutes. What do you do? {#hld05-circuit-breaker}
A circuit breaker per provider: if error rate > 50% over 30 s it opens and workers stop calling it. SMS routes to a fallback provider (e.g. MSG91); after a cool-off a few test calls check recovery. Email can fail over SES ↔ SendGrid.
**Why:** retries don't help a 20-minute outage. Push has no fallback (APNs/FCM are the only path), so the app offers "send via SMS instead" for OTP.
**Example:** don't fail over on one 500: the backup is pricier and slower.

## How long does a 100M-user campaign take, and how do you pace it? {#hld05-campaign}
Provider quota sets the drain rate. At ~20K sends/s (after a FCM quota raise): 100M ÷ 20,000 = 5,000 s ≈ 83 min. Workers: 20,000 ÷ 500 = 40, autoscaled on queue lag.
**Why:** a Redis-shared token bucket (counter refilled at 20K/s, each send takes one) keeps you under quota; exceeding it brings 429s and risks SMS sender-ID blocks. The queue absorbs the 100 GB burst.
**Trap:** FCM HTTP v1 has no batching discount (multicast API shut down June 2024).

## Marketing wants the campaign at 6 pm sharp but it takes 83 minutes. {#hld05-campaign-timing}
Start earlier (5:15) with scheduled delivery, or accept the spread. Never exceed the quota.
**Why:** also apply quiet hours (promo SMS in India limited to 9 am-9 pm by TRAI rules) and check the per-user marketing cap at enqueue time.

## How many workers and API servers? {#hld05-worker-math}
One provider call ≈ 100 ms and a worker keeps ~50 in flight: 50 ÷ 0.1 s = 500 sends/s per worker (assumptions). Normal peak 17,000 ÷ 500 ≈ 34, campaign +56, so ~90-100 workers.
API: ~45K req/s peak ÷ ~2,500 per box ≈ 18, so ~20 servers behind an L7 LB across 3 AZs, minimum 3.
**Why:** the ceiling is the provider rate limit, not our CPU.

## The Redis idempotency store goes down. Fail open or closed? {#hld05-redis-down}
Fail open: send anyway. Worker-side dedup still catches redeliveries, and Redis runs with a replica and Sentinel.
**Why:** a rare duplicate beats a lost OTP.

## A user opts out while a campaign is in flight. {#hld05-optout}
Preferences are checked at enqueue, and the worker re-checks the cached preference just before sending. A window of ~1 min cache TTL is acceptable.
**Why:** for SMS the check is mandatory (TRAI DND registry), a legal requirement.

## What does "delivered" mean and how do you know? {#hld05-delivered}
SENT means the provider accepted it. DELIVERED comes from provider webhooks (SMS DLR, SES events) or, for push, the app pinging back when it displays it. Store both in the log.

## Common notification-system mistakes? {#hld05-traps}
- one queue for everything
- claiming exactly-once
- calling the provider synchronously from the API
- retrying permanent errors
- ignoring provider quotas in a campaign (compute the drain time)
- forgetting opt-out and quiet hours
**Why:** the bottleneck is the provider's rate limit, not your servers.
