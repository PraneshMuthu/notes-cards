---
topic: HLD 04 · Chat / WhatsApp
group: HLD
---

## Give the 30-second pitch for a WhatsApp-style chat. {#hld04-pitch}
Each phone keeps a WebSocket (one long-lived, two-way connection) to one of ~2,000 chat servers. Redis maps user to server. A send is stored in Cassandra plus one inbox row per recipient, then ACKed (single tick), then forwarded.
**Why:** persist first, deliver second, so a crash never loses a message. Offline users get a push and drain their inbox on reconnect.
**Example:** posting a letter at the post office: you get a receipt (✓) once they hold it, before it reaches the neighbour.

## Why WebSocket instead of plain HTTP polling for chat? {#hld04-websocket}
A WebSocket is one long-lived two-way TCP connection, so the server can push a message the moment it arrives.
**Why:** with HTTP the server can only answer requests, so the phone would poll ("any new messages?"). With 200M users that wastes battery and request overhead, and adds delay.
**Example:** a phone call you keep open versus hanging up and re-dialling every few seconds to ask "anything new?".

## How many chat servers do we need, and why 100K connections each? {#hld04-conn-math}
200M concurrent sockets (40% of 500M DAU) ÷ 100K per server = 2,000 chat servers.
**Why:** memory (100K × ~10 KB ≈ 1 GB) and CPU are not the limit; the real limit is blast radius. A dead box makes all its users reconnect at once (TLS handshake + session write each), and 100K is easy to absorb while 1M is a storm.
**Example:** WhatsApp ran ~2M connections per box, so 100K is a cap we choose, not a hardware limit.

## What is the peak message rate, and how does group fanout change it? {#hld04-rate-math}
500M × 40 msg/day = 20B/day ÷ 86,400 ≈ 230K/s avg, × 3 peak ≈ 700K msg/s. Deliveries: 90% 1:1 (18B) + 10% group × 19 recipients (38B) = 56B/day ≈ 650K/s avg, ~2M/s peak.
**Why:** fanout (copying one message to each group member) multiplies work about 20×, which is why groups are capped at 256 and fan out on write.

## Why Cassandra for messages, and what are the partition key and clustering key? {#hld04-cassandra}
Partition key `conversation_id` (rows stored together on one node), clustering key `message_id` DESC (sorts rows inside the partition).
**Why:** 700K writes/s and ~4.4 PB/year of append-only rows, always read as "one chat, newest first". "Last 50 messages" is one read on one node, and you add capacity by adding nodes. Sharded MySQL could work but you build resharding yourself.
**Example:** a filing cabinet with one drawer per chat, papers sorted by date.

## Is one Cassandra partition per conversation too big? {#hld04-partition-size}
No. A very busy group: 1,000 msg/day × 200 B × 365 ≈ 73 MB/year, which is fine.
**Why:** groups are capped at 256 members, so write rate has a human limit. For safety margin, bucket by month: partition key `(conversation_id, yyyymm)`.

## How does a message find the recipient's chat server among 2,000? {#hld04-session-map}
Each chat server writes `SET session:B chat-server-2 EX 120` to Redis on connect. The sender's server looks it up and forwards over gRPC.
**Why:** broadcasting to all 2,000 servers means ~4B internal msgs/s with 1,999 of 2,000 wasted; a lookup is ~2M Redis GETs/s at peak. `EX` is a TTL (time-to-live), so a crashed server's keys expire within 120 s.
**Trap:** the TTL refreshes (200M ÷ 60 s ≈ 3.3M EXPIRE/s) count as Redis ops, so size ~50 shards, not 20.

## What is the inbox table and why write it before delivering? {#hld04-inbox}
`inbox` has PK `user_id`, CK `message_id`: one row per undelivered message per recipient. It is written before delivery and deleted when the phone ACKs.
**Why:** crash, offline and reconnect all go through the same "drain inbox" path, so a message is never lost. The socket is a fast path; the inbox is the source of truth for "not yet delivered".
**Example:** a pigeonhole for each person at a hotel desk: the note sits there until they collect it.

## Why is the inbox row a pointer, not a copy of the message? {#hld04-inbox-pointer}
The inbox holds only `(user_id, message_id, conversation_id)`. To drain, the server reads the inbox, then fetches bodies from `messages`.
**Why:** copying the body would skip the second read but store a 256-member group message up to 255 times.
**Trap:** an inbox is delete-heavy, which in Cassandra leaves tombstones (deleted markers reads must skip). It is fine here since a user's partition is usually empty or tiny; mitigate with a TTL, and name DynamoDB as the switch. Redis is not suitable because a node failure could lose messages.

## How do you drain a long-offline user's inbox on reconnect? {#hld04-drain}
Page through inbox rows 100 at a time, oldest first. Group the rows by conversation, fetch bodies with one query per conversation, push them as a batch, wait for the ACK, then delete those 100 rows.
**Why:** if the socket drops halfway, unACKed rows are still there, so the next connect resumes where it stopped.
**Example:** 300 missed messages means 300 rows, so 3 pages.

## Why not just use the phone's timestamp to order messages? {#hld04-ordering}
Phone clocks are wrong, sometimes by minutes. The server assigns a Snowflake id (64-bit: 41 bits timestamp, 10 bits machine id, 12 bits sequence), so sorting by id roughly sorts by time.
**Why:** it needs no coordination between machines, and as the clustering key it keeps each chat sorted. Capacity ≈ 1,024 machines × 4,096 ids/ms, far above the 700K/s needed.
**Trap:** "roughly" means a few ms of clock skew. If strict order is needed, use a per-conversation `INCR seq:{conversation_id}` in Redis, at the cost of a hot key in busy groups.

## Snowflake has a 10-bit machine id (1,024 max) but we have 2,000 chat servers. What gives? {#hld04-snowflake-bits}
Ids are minted by a separate message-service tier of ~200 boxes, which fits in 1,024. If merged into chat servers, change the split to 11 machine bits (2,048) + 11 sequence bits.
**Why:** two processes must never share a machine id or they can mint the same id in the same millisecond. Each process claims its id at startup (ZooKeeper/etcd or the Kubernetes pod number).
**Trap:** if the clock goes backwards (NTP correction), wait until it catches up before issuing ids.

## Why is the message service its own tier, separate from chat servers? {#hld04-message-service}
Chat servers only hold sockets and pass frames over gRPC. The stateless message service assigns ids, persists, finds recipients and routes.
**Why:**
- deploys: restarting a chat server drops ~100K sockets (reconnect wave), and business logic changes often
- scaling: chat servers scale with connections (2,000), the message service with messages (700K/s ÷ ~5K per box ≈ 150-200)
- Snowflake machine ids fit
**Example:** the cost is one extra ~1 ms hop. "Same process first, split later" is also a fine answer.

## Why an L4 load balancer for chat, not L7? {#hld04-l4-lb}
L4 works at the TCP level: it picks a server when the connection opens, then passes bytes through without reading them, so each of 200M long-lived sockets costs it very little.
**Why:** it is a cost-per-connection choice. An L7 balancer (AWS ALB, nginx) also supports WebSockets but spends more CPU per connection because it decrypts and parses HTTP. Use L7 for the REST endpoints.

## How does at-least-once delivery work, and why not exactly-once? {#hld04-at-least-once}
Each hop retries until ACKed, and both ends dedup. A → server: `client_msg_id` (phone-made UUID) via `SET dedup:{id} NX EX 3600`. Server → B: phone stores by `message_id` in local SQLite, so a repeat insert is a no-op.
**Why:** on a flaky network you can't tell "message lost" from "ACK lost". Losing messages is unacceptable, so retry and dedup.
**Trap:** keep the dedup TTL short: 1 h ≈ 830M keys ≈ 50 GB, 24 h ≈ 1.2 TB of RAM.

## When exactly does the sender see ✓, ✓✓ and blue ✓✓? {#hld04-ticks}
✓ = server stored it (ACK sent only after the write succeeds). ✓✓ = recipient's phone sent `ack`. Blue ✓✓ = recipient's phone sent `read`.
**Why:** the ✓ is a durability promise, so ACKing before persisting is a lie that loses messages on crash. The sender only hears about ✓✓ via `receipt` frames.
**Example:** a courier: ✓ = picked up, ✓✓ = delivered to the door, blue = signed for.

## How are read receipts stored, and what if the sender is offline? {#hld04-cursors}
As two cursors per member per chat in `members_by_conversation`: `last_delivered_id` and `last_read_id`. Blue ✓✓ on message 940 means the other member's `last_read_id ≥ 940`.
**Why:** one number per member, not one row per message. Reads of 950, 960, 980 just leave it at 980. If A is offline only the live frame is skipped; the history call returns the cursors so A redraws all ticks.
**Example:** a bookmark instead of a log of every page turned.

## Why store conversation members in two Cassandra tables? {#hld04-two-tables}
`members_by_conversation` answers "who is in this chat?" (every send); `conversations_by_user` answers "which chats am I in?" (chat list).
**Why:** Cassandra only looks up by partition key, so each question needs its own table. Joining a group writes to both. SQL would hit the same issue once ~50B membership rows force sharding.
**Trap:** do not make `last_message_id` the clustering key to sort the chat list; a clustering key can't be updated in place (delete + insert, more tombstones). Sort the ~200 rows on the phone.

## How is a 1:1 conversation_id created without a lookup or race? {#hld04-dm-id}
Deterministically: `"dm:" + min(A,B) + ":" + max(A,B)`. Both phones compute the same id.
**Why:** it must exist before the first message, and a deterministic id avoids creating it twice. Groups get an id from `POST /groups`.

## How does a 256-member group message get delivered? {#hld04-group-fanout}
Store the message once in `messages` (partition = group id), then fan out on write: 255 inbox rows, 255 Redis lookups and forwards.
**Why:** fine because of the cap (avg group 19 recipients, behind the ~2M/s). For 100K-member channels switch to fan-out on read (members pull), which is out of scope.
**Trap:** storing the body once per member. Store it once; only the lightweight inbox pointers fan out.

## How do you do presence for 200M online users? {#hld04-presence}
No separate write: the `session:B` key is the presence key (exists = online), and clean disconnect writes `last_seen`. Subscribe-on-view: A gets B's presence only while A has B's chat open.
**Why:** a write per heartbeat is 200M ÷ 30 s ≈ 6.7M writes/s. Batched TTL refresh every 60 s is ~3.3M/s, and presence may be stale up to the 120 s TTL.
**Example:** a green dot only checked when you open that chat.

## What does the push service do, and is push the delivery? {#hld04-push}
It is a stateless service between the message service and APNs (Apple) / FCM (Google). It looks up B's device token and sends a small payload with a collapse key = conversation id, only when B has no session.
**Why:** a backgrounded app's socket is closed by the OS, so only Apple/Google can reach it. Push is a wake-up hint that can be dropped; the real message waits in the inbox.
**Example:** a doorbell: it wakes you, but the parcel is already inside.

## A chat server with 100K users dies. What happens? {#hld04-server-dies}
Phones reconnect via the LB to other servers with jittered backoff. Session keys expire (120 s) or get overwritten. Messages meanwhile are safe in the inbox.
**Why:** persist-first means delivery is delayed, not lost. Jitter stops all 100K reconnecting in the same instant.

## Common chat design mistakes to avoid? {#hld04-traps}
- ACKing the sender before persisting
- ordering by phone timestamp
- promising exactly-once instead of at-least-once + dedup
- forgetting chat servers are stateful (needs the session map)
- writing presence on every heartbeat
**Why:** each one fails the first follow-up question, e.g. "what if the server crashes right after the ✓?"
