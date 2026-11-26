---
topic: HLD 06 · Typeahead
group: HLD
---

## What do you clarify before designing search autocomplete? {#hld06-scope}
Prefix-only matching, top 5 suggestions ranked by how often the full query was searched, same for everyone, English only, daily or weekly freshness is fine, under 100 ms end-to-end.
**Why:** "no personalisation, no spell-correction, no real-time trending" is what allows a precomputed, read-only structure.
**Example:** typing "din" suggests "dinner recipes" but not "sunday dinner" (no mid-word matching).

## How many requests per second does typeahead get, and why is it not just searches per second? {#hld06-qps}
Roughly 23K/s average and 50K/s at peak, because one search fires a request on almost every keystroke.
**Why:** 10M users × 10 searches = 100M searches/day × ~20 keystroke requests = 2B req/day ÷ 86,400 s ≈ 23K/s, × 2 for evening peak ≈ 50K/s. Only ~1.2K/s of searches are logged (100M ÷ 86,400), so reads outnumber writes about 20 : 1.
**Example:** typing "dinner recipes" = 14 characters, so ~14-20 requests.

## How big is the trie and what does that decide? {#hld06-trie-size}
About 10 GB, so it fits in one machine's RAM and every server holds a full copy (no sharding yet).
**Why:** 10M kept queries × 20 chars = 200M chars × ~0.5 (shared prefixes) ≈ 100M nodes × ~100 B per node ≈ 10 GB. A trie (prefix tree) has one character per edge, so every path from the root spells a prefix.
**Example:** all queries starting with "din" sit under the node reached by d → i → n.

## Why is plain SQL `LIKE 'din%' ORDER BY count DESC LIMIT 5` not enough? {#hld06-why-not-sql}
`LIKE` must find every matching row and sort by count, per keystroke. For the prefix "s" that is about 1M rows per request, impossible at 50K requests/s.
**Why:** the work grows with the number of matches, not with the prefix length. A precomputed answer per prefix makes it constant.

## How does a trie answer "top 5 for prefix s" fast? {#hld06-topk-per-node}
Store the top 5 queries of the whole subtree at every node. A request walks p characters then reads one list: O(p), not O(subtree).
**Why:** a plain trie would walk to "s" then visit every node below it (~10M for "s") and sort, per keystroke.
**Example:** node "din" stores [dinner recipes 48K, dino game 31K, dinner ideas 22K, dinosaur 19K, dining table 9K].

## How do you keep the per-node top-5 from bloating memory? {#hld06-id-trick}
Store each top-5 as 8-byte query IDs into one shared string table, and keep only queries seen at least N times.
**Why:** 5 × 8 B = 40 B per node vs 5 × 20 B = 100 B for copied strings. Over 100M nodes, IDs cost 4 GB and the trie stays ~10 GB instead of ~15 GB. The long tail (typos, one-offs) never gets suggested anyway.

## How is the top-5 for 100M nodes computed? {#hld06-bottom-up}
Bottom-up, once, in the offline builder. A leaf's top-5 is itself; a parent merges its own count with each child's top-5 and keeps the best 5.
**Why:** each node merges a few small lists, so the whole build is minutes on one machine and costs nothing at request time.
**Example:** also cap prefix depth at ~30 chars, because almost nobody needs suggestions that far in.

## Why rebuild the trie offline instead of updating counts on every search? {#hld06-offline-rebuild}
One count bump ripples to every ancestor's top-5 (up to ~14 nodes), needing locks while reads hit them. Nobody needs real-time anyway.
**Why:** 1,200 writes/s × ~14 ancestors ≈ 17K locked node writes/s on every replica, against 50K reads/s. Offline, the serving trie is read-only, so no locks.
**Trap:** do not propose live updates when the interviewer said daily or weekly freshness is fine.

## Describe the typeahead data pipeline from search to live trie. {#hld06-pipeline}
Search service emits `{query, ts}` to Kafka, batches go to S3 partitioned by date, a daily or weekly Spark job counts queries, then a builder drops the long tail and blocklisted terms, builds the trie and saves a versioned snapshot to S3. Servers load it and swap.
**Why:** logs are append-only and only batch-read, so cheap object storage beats a database. Date partitions let the job read just the last 7 days (70 GB).

## How do you stop last year's popular queries dominating forever? {#hld06-recency}
Weight counts by recency in the aggregator: count only the last ~4 weeks, with weight 1.0 this week, 0.5 last week, 0.25 the week before.
**Why:** a query nobody searches any more decays out within a few weeks.

## How do you swap in a new trie without downtime or a bad release? {#hld06-swap}
Each server has RAM for two tries (2 × 10 GB). Load the new snapshot into the spare slot, sanity-check it, then atomically swap one pointer. Roll out a few servers at a time; old versions stay in S3 for rollback.
**Why:** serving never pauses and a bad build is a one-command revert.
**Example:** validate node count within ±20% of the last build, and that known prefixes return results.

## When and how do you shard the trie, and why not one shard per letter? {#hld06-sharding}
Replicate while it fits in RAM; shard only at ~10× data (~100 GB). Split by measured traffic, not by alphabet, using a shard map in a config service.
**Why:** letter shards are skewed: "s" ≈ 10% of queries (5,000 req/s of 50K) vs "x" ≈ 0.1% (50 req/s), a 100× difference.
**Example:** "s" split into sa-sh, si-sm, sn-sz, while u-z share one shard.

## What is the alternative to range-sharding the trie? {#hld06-kv-alt}
Flatten it into a key-value store, `"din" → top 5`, and hash the keys across nodes (consistent hashing).
**Why:** hashing spreads load evenly with no shard map. The cost is a network hop per lookup and one stored key per prefix.

## How do you cut the ~20 requests per search on the client? {#hld06-client-caching}
Debounce (wait ~150 ms after the last keystroke), cache prefixes in the browser, and let the CDN cache short prefixes. GET with `Cache-Control: max-age=3600`.
**Why:** server load drops from ~50K to ~20K req/s. GET, not POST, because only GET responses are cacheable by browsers and CDNs.
**Example:** backspacing from "din" to "di" costs zero requests, as the browser already has "di".

## The trie builder fails this week, or builds a bad snapshot. What happens? {#hld06-failures}
Failed build: servers keep serving last week's trie, suggestions are a bit staler, alert and rerun. Bad snapshot: validate before swap, canary on a few servers, roll back to the previous S3 version.
**Why:** serving and building are decoupled, so the worst case is stale suggestions, never an outage.

## An offensive query becomes popular. How do you remove it? {#hld06-blocklist}
A blocklist filter in the trie builder drops it on the next build. For urgent cases, keep a small in-memory blocklist on the query servers that filters results immediately.
**Why:** waiting a week for a rebuild is too slow for harmful content.

## Give the 30-second pitch for typeahead. {#hld06-pitch}
Read-heavy: ~50K req/s peak vs ~1.2K logged searches/s. Query servers hold a ~10 GB in-RAM trie with the top 5 precomputed at every node, so a lookup is a short walk plus a list read. A Kafka → S3 → Spark pipeline rebuilds the trie daily or weekly and servers swap it atomically.
**Why:** offline keeps serving lock-free. Debounce and CDN caching cut client requests. Replicate now, shard by traffic later.
