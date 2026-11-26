---
topic: HLD 06 · Typeahead
group: HLD
---

## Typeahead: which scope answers from the interviewer let you precompute suggestions offline? {#hld06-scope}
No personalisation (everyone gets the same top 5) and daily-or-weekly freshness. Together they make the answer for each prefix a fixed fact you can compute ahead of time.
**Why:** with per-user ranking or real-time trends you'd have to compute at request time; without them, a read-only precomputed structure serves every request.
**Example:** a printed train timetable works because everyone sees the same trains and it changes only monthly.
**Trap:** also pin prefix-only matching and the < 100 ms p99 (slowest 1% of requests) target; the user types the next letter otherwise.

## Typeahead: 10M users × 10 searches/day, ~20 requests per search. Derive peak requests/s. {#hld06-qps}
~50K/s at peak: 2B requests/day ÷ 86,400 ≈ 23K/s average, × ~2 for the evening peak.
**Why:** one search fires a request on almost every keystroke, so request rate is ~20× the search rate. Only ~1.2K searches/s are logged, so reads outnumber writes ~20:1.
**Example:** typing "dinner recipes" (14 characters) sends ~14–20 requests for one search.

## Typeahead: 10M kept queries, ~20 chars each, ~100 B per node. How big is the trie, and what does that decide? {#hld06-trie-size}
~10 GB: it fits in one machine's RAM, so every server holds a full copy and nothing is sharded yet.
**Why:** a trie (prefix tree, one character per edge) shares common prefixes, so 200M characters become ~100M nodes. 100M × 100 B (child pointers plus a top-5 list) ≈ 10 GB.
**Example:** "dinner" and "dino" share the nodes d → i → n.

## Typeahead: why is SQL `LIKE 'din%' ORDER BY count DESC LIMIT 5` not enough? {#hld06-why-not-sql}
It must find and sort every matching row on every keystroke: about 1M rows for the prefix "s", impossible at 50K requests/s.
**Why:** the work grows with the number of matches, not the prefix length. A precomputed answer per prefix makes each lookup constant work.
**Example:** asking a librarian to pull every book starting with "S" and rank them, each time you add a letter.

## Typeahead: how does the trie answer "top 5 for prefix s" without scanning its subtree? {#hld06-topk-per-node}
Store the top 5 queries of the whole subtree at every node. A request walks p characters, then reads one list: O(p), not O(subtree).
**Why:** a plain trie would walk to "s", visit every node below it (~10M), and sort, per keystroke.
**Example:** node "din" stores [dinner recipes 48K, dino game 31K, dinner ideas 22K, dinosaur 19K, dining table 9K].

## Typeahead: how do you keep the per-node top-5 lists from bloating memory? {#hld06-id-trick}
Store each top 5 as 8-byte query IDs into one shared string table, and keep only queries seen at least N times.
**Why:** 5 × 8 B = 40 B per node vs ~100 B for copied strings; over 100M nodes the trie stays ~10 GB instead of ~15 GB. The long tail (typos, one-offs) would never be suggested anyway.
**Example:** a restaurant menu lists dish numbers on the specials board; the full recipe lives once in the kitchen book.

## Typeahead: how is the top 5 for all 100M nodes computed? {#hld06-bottom-up}
Bottom-up, once, in the offline builder: a leaf's top 5 is itself; a parent merges its own count with each child's top 5 and keeps the best 5.
**Why:** each node merges a few short lists, so the build takes minutes on one machine and costs nothing at request time.
**Example:** a school picks its top 5 runners from each class's top 5, not by re-timing every student.
**Trap:** cap depth at ~30 characters, or long queries explode the node count.

## Typeahead: why rebuild the trie offline instead of updating counts on every search? {#hld06-offline-rebuild}
A count bump changes the top 5 of every ancestor (up to ~14 nodes), which needs locks while 50K reads/s hit them. Nobody needs real-time anyway.
**Why:** 1,200 searches/s × ~14 ancestors ≈ 17K locked writes/s on every replica. Offline, the serving trie is read-only, so no locks.
**Example:** a newspaper prints once a day instead of reprinting the front page every time a story changes.

## Typeahead: walk the data pipeline from a search to a live trie. Say the 4 beats. {#hld06-pipeline}
(1) Search service logs `{query, ts}` to Kafka. (2) Batches land in S3 (cheap object storage) by date. (3) A daily or weekly Spark job (batch compute) cleans and counts queries. (4) A builder drops the long tail and blocklisted terms, builds the trie, saves a versioned snapshot that servers load.
**Why:** logs are append-only and only batch-read, so object storage beats a database; date folders let the job read just the last 7 days.
**Example:** like a shop's daily sales slips, filed by date and totalled once a week.
**Trap:** grade Got it only if you said all 4 beats.

## Typeahead: how do you stop last year's popular queries dominating forever? {#hld06-recency}
Weight counts by recency: count only the last ~4 weeks, with weight 1.0 this week, 0.5 last week, 0.25 the week before.
**Why:** a query nobody searches any more decays out within a few weeks instead of riding its old total.
**Example:** "world cup final" with 1M searches last year but none this month drops out; this week's 50K "ipl auction" outranks it.

## Typeahead: how do you swap in a new trie without downtime or a risky release? {#hld06-swap}
Load the new snapshot into a spare RAM slot (each server holds 2 × 10 GB), sanity-check it, then atomically swap one pointer. Roll out a few servers at a time.
**Why:** serving never pauses, and old versions stay in S3, so a bad build is a one-command rollback.
**Example:** check that node count is within ±20% of the last build and known prefixes return results.

## Typeahead: when do you start sharding the trie, and how do you split it? {#hld06-sharding}
Only when it no longer fits in RAM (~10× data, ~100 GB); until then, replicate. Then split by measured traffic, with a shard map in a config service.
**Why:** replicas of a full copy are simpler and every server can answer anything. Sharding adds routing, rebalancing and a map to keep in sync.
**Example:** a library photocopies its single catalogue for every branch until it no longer fits on one shelf.

## Typeahead: why not give each first letter its own shard? {#hld06-shard-letter}
Letters are wildly skewed: "s" gets ~10% of queries (5,000 req/s of 50K) and "x" ~0.1% (50 req/s), a 100× difference.
**Why:** split by measured traffic instead, so hot ranges get small slices and cold ones share a shard.
**Example:** "s" split into sa–sh, si–sm, sn–sz, while u–z share one shard.

## Typeahead: you flatten the trie to `"din" → top 5` and hash keys across nodes. What does hashing fix, and what doesn't it? {#hld06-kv-alt}
Typeahead's twist: hashing spreads keys evenly, but not traffic. The key "s" alone gets ~5,000 req/s and still lands on one node.
**Why:** consistent hashing balances how many keys each node owns; a hot key is one key. Fix the hot short prefixes with extra replicas or CDN caching. The cost of the flat layout is a network hop per lookup.
**Example:** splitting a city's houses evenly among postmen doesn't help the one who gets the stadium.

## Typeahead: how does debounce cut the ~20 requests per search? {#hld06-debounce}
Wait ~150 ms after the last keystroke before sending; a fast typist then sends one request per pause, not per letter. That roughly halves requests.
**Why:** the user only reads suggestions when they pause, so requests for letters typed mid-burst are wasted.
**Example:** typing "dinner" quickly sends one request for "dinner", not six for d, di, din…

## Typeahead: when does backspacing cost zero requests? {#hld06-client-caching}
When the shorter prefix was already fetched: the browser caches each prefix response (`Cache-Control: max-age=3600`), so it answers from local cache.
**Why:** a prefix's top 5 changes only at the daily or weekly rebuild, so an hour-old copy is correct.
**Example:** you type "di", pause (request sent), type "n", then backspace to "di": served from the browser. Type "din" fast and backspace, and "di" was never fetched, so it costs one request.

## Typeahead: why serve suggestions with GET, and which prefixes does the CDN cache? {#hld06-cdn}
GET, because in practice browsers and CDNs (edge caches near users) cache only GET responses. The CDN holds the 1–2 character prefixes, only ~730 keys.
**Why:** those short prefixes are the hottest, and with debounce plus caching server load falls from ~50K to ~20K req/s.
**Example:** "i" during an iPhone launch is answered by the CDN node in Mumbai, never reaching a trie server.

## Typeahead: the trie builder fails this week, or builds a bad snapshot. What happens? {#hld06-failures}
Users get slightly stale suggestions, never an outage: a failed build leaves last week's trie serving; a bad one is caught before or during rollout.
**Why:** serving and building are decoupled. Validate before swap, canary (deploy to a few servers first and watch), and roll back to the previous S3 version.
**Example:** a printer fails, so the shop keeps last week's price list on the wall until the new one arrives.

## Typeahead: an offensive query becomes popular. How do you remove it within minutes? {#hld06-blocklist}
A small in-memory blocklist on the query servers filters results immediately; the builder's blocklist drops it permanently on the next build.
**Why:** waiting days for a rebuild is too slow for harmful content, and patching the trie live would break the read-only design.
**Example:** a shop covers a recalled product's shelf tag today; the new printed catalogue drops it next week.

## Typeahead: the interviewer now wants trending queries within minutes. What do you add? {#hld06-trending}
A small streaming job (Kafka → Flink) counts queries in 5-minute windows and keeps a tiny trending top list per short prefix. Query servers merge it with the offline trie's top 5.
**Why:** add a fast lane for the few things that need freshness instead of making the whole 10 GB structure mutable and locked.
**Example:** a newspaper prints daily but runs a live ticker for breaking news.

## Pitch typeahead in 30 seconds: say the 4 beats. {#hld06-pitch}
(1) Read-heavy: ~50K requests/s vs ~1.2K logged searches/s. (2) Query servers hold a ~10 GB in-RAM trie with the top 5 precomputed at every node. (3) A Kafka → S3 → Spark pipeline rebuilds it daily or weekly and servers swap atomically. (4) Debounce and CDN caching cut client requests.
**Why:** offline building keeps serving lock-free; replicate now, shard by traffic later.
**Example:** typing "din" walks d → i → n and returns that node's stored list in ~10 ms.
**Trap:** grade Got it only if you said all 4 beats.
