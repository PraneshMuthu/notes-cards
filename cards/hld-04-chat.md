---
topic: HLD 04 · Chat / WhatsApp
group: HLD
---

## Pitch a WhatsApp-style chat in 30 seconds: say the 4 beats. {#hld04-pitch}
(1) Each phone holds a WebSocket to one of ~2,000 chat servers; Redis maps user → server. (2) A send is stored in Cassandra plus an inbox row per recipient. (3) Only then ACK the sender (✓). (4) Forward if online; otherwise push, and the phone drains its inbox on reconnect.
**Why:** persist first, deliver second, so a crash delays a message but never loses it.
**Example:** the post office gives you a receipt once the letter is in its sack, before it reaches your neighbour.
**Trap:** grade Got it only if you said all 4 beats.

## Chat: why must the phone hold a WebSocket instead of polling over HTTP? {#hld04-websocket}
So the server can push a message the instant it arrives. A WebSocket is one long-lived two-way connection; plain HTTP only lets the server answer requests.
**Why:** polling ("any new messages?") from 200M phones every few seconds wastes battery and billions of empty requests, and still adds up to a poll-interval of delay.
**Example:** keeping a phone call open versus hanging up and redialling every 5 seconds to ask "anything new?".

## Chat: 500M DAU, 40% online at once, 100K sockets per server. How many chat servers? {#hld04-conn-math}
2,000 chat servers: 200M concurrent sockets ÷ 100K each.
**Why:** sockets, not messages, size this tier: each online phone holds one connection all day, even when silent.
**Example:** 500M × 0.4 = 200M; 200M ÷ 100,000 = 2,000.

## Chat: a server could hold 1M+ WebSockets. Why cap it at 100K? {#hld04-conn-cap}
Blast radius: when a box dies, all its users reconnect at once. 100K reconnects are easy to absorb; 1M is a storm.
**Why:** memory (100K × ~10 KB ≈ 1 GB) is not the limit. Each reconnect costs a TLS handshake (setting up encryption) and a session write, all in the same second.
**Example:** WhatsApp famously ran ~2M connections per box, so 100K is a choice, not a hardware limit.

## Chat: from 500M DAU × 40 messages/day, derive the peak send rate. {#hld04-rate-math}
~700K messages/s at peak: 20B/day ÷ 86,400 ≈ 230K/s average, × 3.
**Why:** this, not the 2,000 socket servers, sizes the message service and Cassandra write path.
**Example:** 500M × 40 = 20B/day; 20B ÷ 86,400 ≈ 231K/s; × 3 ≈ 700K/s.

## Chat: 10% of messages go to groups with ~19 other members on average. How does that change deliveries? {#hld04-group-deliveries}
Deliveries nearly triple: 18B one-to-one + 2B × 19 = 38B group = 56B/day, ~2M/s at peak.
**Why:** fanout (copying one message to each member) makes a group message cost ~19 deliveries, so 10% of sends become two-thirds of deliveries. That is why groups are capped at 256.
**Example:** one "happy birthday" in a 20-person family group is 19 deliveries.

## Chat: which partition key and clustering key for the messages table, and why? {#hld04-cassandra}
Partition key `conversation_id` (rows stored together on one node); clustering key `message_id` descending (sort order inside it).
**Why:** the read is always "one chat, newest first", so "last 50 messages" is one sequential read on one node. Cassandra suits ~700K writes/s and ~1.5 PB/year of raw data.
**Example:** a filing cabinet with one drawer per chat, papers sorted newest on top.

## Chat: B is connected to one of 2,000 chat servers. How does A's message find that server? {#hld04-session-map}
On connect, B's server writes `SET session:B chat-server-2 EX 120` in Redis. The sender's side looks it up and forwards over gRPC (server-to-server calls).
**Why:** broadcasting to all 2,000 servers wastes 1,999 of every 2,000 sends. `EX 120` is a TTL (expiry), so a crashed server's entries vanish within 2 min.
**Example:** a hotel reception desk's "guest → room number" register.

## Chat: what is the inbox table, and why write it before delivering? {#hld04-inbox}
One row per undelivered message per recipient (partition key `user_id`), written before delivery and deleted when the phone ACKs.
**Why:** crash, offline and reconnect all go through one "drain the inbox" path, so a message is never lost. The socket is a fast path; the inbox is the truth for "not yet delivered".
**Example:** a pigeonhole at the hotel desk: the note sits there until the guest collects it.

## Chat: why is an inbox row a pointer, not a copy of the message? {#hld04-inbox-pointer}
It holds only `(user_id, message_id, conversation_id)`; draining reads the inbox, then fetches bodies from `messages`.
**Why:** a copy would save one read but store a 256-member group message up to 255 times.
**Example:** a parcel-locker SMS tells you which locker; it doesn't contain the parcel.
**Trap:** the inbox is delete-heavy, so in Cassandra it leaves tombstones (delete markers reads must skip); fine while partitions stay tiny.

## Chat: B was offline for a week. How does the phone drain its inbox on reconnect? {#hld04-drain}
Page through inbox rows 100 at a time, oldest first; fetch bodies per conversation, push the batch, wait for the ACK, then delete those 100 rows.
**Why:** if the socket drops halfway, unACKed rows are still there, so the next connect resumes where it stopped.
**Example:** 300 missed messages = 3 pages; the connection drops after page 2, and page 3 is still waiting next time.

## Chat: why not order messages by the phone's timestamp? {#hld04-ordering}
Phone clocks are wrong, sometimes by minutes. The server assigns a Snowflake ID (time first, then machine, then counter), so sorting by ID roughly sorts by time.
**Why:** server clocks are kept close by NTP (network time sync) and each server mints IDs with no coordination. The ID is also the clustering key, so each chat stays sorted.
**Example:** a phone set 5 minutes fast would make its reply appear above the question it answers.
**Trap:** "roughly" means a few ms of skew; for strict order use a per-chat Redis counter, at the cost of a hot key in busy groups.

## Chat: Snowflake allows 1,024 machine IDs (10 bits), but there are 2,000 chat servers. What gives? {#hld04-snowflake-bits}
IDs are minted by the separate message-service tier (~200 boxes), which fits. If merged into chat servers, use 11 machine bits (2,048) + 11 sequence bits.
**Why:** two processes sharing a machine ID can mint the same ID in the same millisecond. 11 sequence bits still give 2,048 IDs/ms per box, far above ~1K messages/s.
**Example:** like 4-digit employee codes: 10,000 people max, so a bigger company needs a 5th digit.

## Chat: why run the message service as its own tier instead of inside the chat servers? {#hld04-message-service}
So chat servers stay dumb and rarely restart: a restart drops ~100K sockets into a reconnect wave, while business logic changes often.
**Why:** the tiers also scale on different axes: chat servers with connections (2,000), the message service with messages (700K/s ÷ ~5K per box ≈ 150–200). The cost is one ~1 ms extra hop.
**Example:** a bank keeps tellers at the counter and back-office staff separate; retraining the back office doesn't close the counters.

## Chat: why does the WebSocket tier sit behind an L4 load balancer, not L7? {#hld04-l4-lb}
Chat's twist: 200M sockets live for hours. L4 (TCP level) picks a server once at connect, then just passes bytes, so each idle socket costs it almost nothing.
**Why:** an L7 balancer (HTTP-aware, e.g. ALB, nginx) can carry WebSockets but decrypts and parses traffic, costing more CPU per connection for no benefit. REST endpoints still use L7.
**Example:** a telephone exchange connects the call once and stays out of the conversation.

## Chat: A sends, but the server's ✓ never reaches A. How do you avoid both losing and duplicating the message? {#hld04-at-least-once}
A's phone resends with the same `client_msg_id` (a UUID it made); the server drops repeats via `SET dedup:{id} NX EX 3600`. B's phone also ignores a `message_id` it already stored.
**Why:** a lost message and a lost ACK look identical to A, so A must retry; dedup at each hop turns at-least-once delivery into one visible message.
**Example:** you tap send in a lift with no signal; it resends outside, and B still sees it once.
**Trap:** keep the dedup TTL short: 1 h of IDs ≈ 50 GB of Redis, 24 h ≈ 1.2 TB.

## Chat: when exactly does the sender see ✓, ✓✓ and blue ✓✓? {#hld04-ticks}
✓ = the server stored it. ✓✓ = B's phone sent `ack`. Blue ✓✓ = B's phone sent `read`.
**Why:** ✓ is a durability promise, so it is sent only after the write succeeds; ACKing earlier would lie and lose messages on a crash.
**Example:** a courier: ✓ = collected from you, ✓✓ = on their doormat, blue = they opened it.

## Chat: how do you store read receipts without a row per message? {#hld04-cursors}
Two numbers per member per chat: `last_delivered_id` and `last_read_id`. Blue ✓✓ on message 940 means the other member's `last_read_id ≥ 940`.
**Why:** a cursor only moves forward, so reading 950, 960 and 980 leaves one value, 980. If A is offline, the history call returns the cursors and A redraws all ticks.
**Example:** a bookmark instead of a log of every page you turned.

## Chat: why store group membership in two Cassandra tables? {#hld04-two-tables}
`members_by_conversation` answers "who is in this chat?" (every send); `conversations_by_user` answers "which chats am I in?" (chat list).
**Why:** Cassandra looks up only by partition key, so each question needs its own table. Joining a group writes both.
**Example:** a school keeps a class register and each student's timetable: the same facts filed two ways.
**Trap:** don't make `last_message_id` the clustering key of the chat list; a clustering key can't be updated in place.

## Chat: how is a message to a 256-member group delivered? {#hld04-group-fanout}
Store the message once, then fan out on write: 255 inbox pointers, 255 session lookups and forwards.
**Why:** affordable only because of the 256 cap. A 100K-member channel would switch to fan-out on read (members pull), which is out of scope.
**Example:** a teacher posts one notice on the board and sends 40 "check the board" slips, not 40 photocopies.

## Chat: how do you know who is online without a write per heartbeat? {#hld04-presence}
Reuse the session key: `session:B` exists means B is online. A clean disconnect writes `last_seen`.
**Why:** writing presence on every 30 s heartbeat is 200M ÷ 30 ≈ 6.7M writes/s. Refreshing the session TTL every 60 s halves that and presence costs no extra key; it may be stale up to the 120 s TTL.
**Example:** a hotel knows you are in because your room key is active, not because you phone reception every half hour.

## Chat: who receives B's online/offline changes, and when? {#hld04-presence-subscribe}
Only people with B's chat open: subscribe on view, unsubscribe on close.
**Why:** broadcasting every status change to all of B's contacts multiplies presence traffic by contact count, mostly to screens nobody is looking at.
**Example:** you see the green dot only when you open that chat, not on the chat list.

## Chat: B's app is in the background. What does the push service do, and is the push the delivery? {#hld04-push}
It sends a small APNs/FCM (Apple/Google push) wake-up with B's device token, only when B has no session. It is a hint; the message itself waits in the inbox.
**Why:** the OS closes a backgrounded app's socket, so only Apple/Google can reach the phone, and they may drop or merge pushes.
**Example:** a doorbell: it wakes you, but the parcel is already inside.

## Chat: a chat server holding 100K users dies. What happens? {#hld04-server-dies}
Phones reconnect via the load balancer to other servers with jittered backoff (random wait); stale session keys expire or are overwritten. Undelivered messages wait in the inbox.
**Why:** persist-first means delivery is delayed, not lost. Jitter stops 100K phones reconnecting in the same instant.
**Example:** 100K reconnects spread over ~30 s is ~3K/s across 1,999 servers, under 2 per server per second.

## Chat: which single ordering rule do most chat-design bugs violate? {#hld04-traps}
Persist, then ACK, then forward.
**Why:** ACK before the write and a crash loses a message the sender saw ✓ for. Forward before persisting and an offline recipient has nothing to drain.
**Example:** a shop prints your UPI receipt only after the bank confirms, not when you tap Pay.

## Chat: walk through a send from A to B, both online. Say the 4 beats. {#hld04-send-path}
(1) The message service assigns a Snowflake `message_id`. (2) It writes `messages` plus B's inbox row. (3) It ACKs A (✓). (4) It looks up `session:B` and forwards; B ACKs, the inbox row is deleted, A gets ✓✓.
**Why:** if `session:B` is missing, B is offline: step 4 becomes a push, and the inbox row waits for B's reconnect.
**Example:** A sends "hi" at 10:00:00.000; ✓ ~20 ms later, ✓✓ when B's phone acknowledges.
**Trap:** grade Got it only if you said all 4 beats.

## Chat at 10× (7M messages/s): what becomes the real problem? {#hld04-10x}
Storage cost, ~44 PB/year with 3 copies. Every tier scales by adding boxes, so move history older than ~90 days to cheaper cold storage.
**Why:** compute grows with traffic, but stored messages pile up forever, so cost becomes the binding limit.
**Example:** 200B messages/day × 200 B = 40 TB/day × 365 × 3 ≈ 44 PB/year.

## Chat: how is a one-to-one conversation_id created without a lookup or a race? {#hld04-dm-id}
Compute it: `"dm:" + min(A,B) + ":" + max(A,B)`. Both phones get the same ID.
**Why:** it must exist before the first message, and if both users message at once a deterministic ID can't be created twice. Groups get an ID from `POST /groups`.
**Example:** users 42 and 7 → `dm:7:42`, whoever writes first.

## Chat: how do photos and videos travel without clogging the message path? {#hld04-media}
The phone gets a pre-signed upload URL, uploads the file straight to object storage (S3), then sends a normal small message containing the URL. Recipients download via a CDN.
**Why:** the chat path moves ~700K tiny (~200 B) messages/s; MB-sized files through chat servers and Cassandra would multiply bandwidth and storage there.
**Example:** you don't push a parcel through the letterbox; you leave a note saying which locker it's in.
