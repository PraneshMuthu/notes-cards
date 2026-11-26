---
topic: DSA · Which pattern?
group: DSA
---

## Unsorted integers (values can repeat) and k: count index pairs i < j with a[i] + a[j] = k, in O(n) time. Which pattern, and what is the signal? {#dsawp-pair-count-unsorted}
**Pattern:** hash map counting the values seen so far; at each x, add count[k − x].
**Signal:** unsorted input + an exact-sum match + an O(n) limit.
**Why not two pointers:** they need sorted input, and sorting alone is O(n log n); counting runs of equal values from both ends is also fiddly.
**Example:** [1,5,7,-1,5], k=6 gives 3: (1,5), (1,5), (7,-1).

## Sorted array and a target t: find the pair whose sum is closest to t (it need not equal t), with O(1) extra space. Which pattern, and what is the signal? {#dsawp-closest-pair-sorted}
**Pattern:** two pointers from both ends; move left if the sum is below t, right if above, tracking the best gap.
**Signal:** sorted input + "closest", a comparison rather than an exact match.
**Why not a hash map:** a map answers "is exactly x present?", not "what is nearest to x?", and it costs O(n) space.
**Example:** [1,3,4,7,10], t=15 gives 4 + 10 = 14 (7 + 10 = 17 is further off).

## Array of positive integers and S: the length of the shortest contiguous stretch whose sum is at least S. Which pattern, and what is the signal? {#dsawp-shortest-sum-at-least}
**Pattern:** sliding window: grow right until sum ≥ S, then shrink left while it still holds, recording the length.
**Signal:** contiguous + all values positive, so growing always raises the sum and shrinking always lowers it.
**Why not prefix sum + hash map:** a map finds an *exact* earlier prefix, not "≥ S"; the window is O(n) with O(1) space.
**Example:** [2,3,1,2,4,3], S=7 gives 2 ([4,3]).

## Integer array with negative values and k: the length of the longest contiguous stretch whose sum is exactly k. Which pattern, and what is the signal? {#dsawp-longest-sum-k-negatives}
**Pattern:** prefix sums plus a hash map from each prefix sum to the *first* index where it appeared; length = j − first[pre − k].
**Signal:** contiguous + exact sum + negatives allowed.
**Why not a sliding window:** with negatives, shrinking from the left can *raise* the sum, so there is no rule for when to shrink.
**Example:** [1,-1,5,-2,3], k=3 gives 4 ([1,-1,5,-2]).

## Each wedding guest is present during [arrive, leave]. A photographer takes instant photos; what is the fewest photos so every guest is in at least one? Which pattern, and what is the signal? {#dsawp-fewest-photos}
**Pattern:** greedy, sort by **end**: shoot at the earliest leave time, skip every guest present then, repeat.
**Signal:** "fewest points that hit every interval" (or "most intervals with no overlap"): the earliest finisher decides.
**Why not sort by start and merge:** a chain of overlaps merges into one block that may need several photos.
**Example:** [1,3],[2,5],[4,6] merge into [1,6], but need 2 photos (at 3 and 6), since [1,3] and [4,6] never meet.

## CCTV cameras each recorded during [start, end] minutes of a day, overlapping freely. How many minutes were covered by at least one camera? Which pattern, and what is the signal? {#dsawp-cctv-coverage}
**Pattern:** sort by **start**, merge overlapping intervals, add up the merged lengths.
**Signal:** the union of intervals: overlapping pieces must be combined, so neighbours must be adjacent.
**Why not sort by end:** a long recording that started early comes late in end order, so one pass cannot tell what it overlaps.
**Example:** [1,4],[2,6],[8,9] gives 6: merged [1,6] is 5 minutes, [8,9] is 1.

## Grid maze of open cells and walls: the fewest up/down/left/right steps from the start cell to the exit. Which pattern, and what is the signal? {#dsawp-maze-fewest-steps}
**Pattern:** BFS (breadth-first search) from the start, counting levels.
**Signal:** "fewest steps" where every step costs the same; BFS reaches each cell first by a shortest route.
**Why not DFS:** depth-first finds *a* path, not the shortest; making it find the shortest means trying every path (exponential). Dijkstra works, but its heap is wasted when all costs are 1.
**Example:** a Metro map where every hop counts as one stop: BFS gives the fewest stops.

## People 0..n−1; friend requests are accepted one at a time, and after each acceptance you must report how many separate friend circles exist. Which pattern, and what is the signal? {#dsawp-friend-circles-online}
**Pattern:** union-find (disjoint set union): start at n circles; each acceptance joining two different roots subtracts one.
**Signal:** edges arrive one by one (online) and a connectivity answer is needed after each.
**Why not DFS or BFS:** they redo O(V + E) work per question, O(E · (V + E)) in total; union-find is near O(1) per edge with union by size and path compression.
**Example:** n=4: accept (0,1) → 3; (2,3) → 2; (1,0) again → still 2 (same root).

## A 4-wheel combination lock (digits 0–9, each wheel turns one step up or down, 9 wraps to 0) starts at 0000. Some codes jam the lock. Fewest turns to reach a target code? Which pattern, and what is the signal? {#dsawp-lock-min-turns}
**Pattern:** BFS over states: each code is a node with 8 neighbours (4 wheels × 2 directions); jam codes are walls.
**Signal:** "fewest moves", each move costs 1, and the graph is implicit (generated on the fly, not given as edges).
**Why not DP:** moves can go back and forth (cycles), so there is no order in which to fill a table; DFS does not give the shortest.
**Example:** target 0009 takes 1 turn (0 down to 9), not 9.

## Sensor readings arrive forever; at any moment, report the 10 largest readings so far. Which pattern, and what is the signal? {#dsawp-top10-stream}
**Pattern:** min-heap of size 10: if a new reading beats the heap's smallest, replace it.
**Signal:** a stream (you cannot hold or revisit all the data) + a small fixed k.
**Why not quickselect:** it needs the whole array in memory with random access, and it must redo the work for every query.
**Example:** after a million readings, memory is still 10 numbers, and each new reading costs O(log 10).

## An array of 10 million numbers is fully in memory; find its median once, in O(n) average time. Which pattern, and what is the signal? {#dsawp-median-once}
**Pattern:** quickselect: partition around a random pivot (as in quicksort), then recurse only into the side holding position n/2.
**Signal:** one kth-element question on a static, in-memory array, with k far from the ends.
**Why not a heap:** a size-k heap with k = n/2 costs O(n log n), no better than sorting. (Two heaps suit a *stream* of medians.)
**Example:** [7,2,9,4,5] gives 5. Trap: without a random pivot, already-sorted input makes it O(n²).

## Parcel weights in a fixed order must ship within D days; each day the truck loads the next parcels in order, up to its capacity. The smallest capacity that works? Which pattern, and what is the signal? {#dsawp-ship-capacity}
**Pattern:** binary search on the answer: try a capacity in [max weight, total weight], check it with a greedy day count.
**Signal:** "smallest value that works", and if capacity c works, every larger c works too (monotonic).
**Why not binary search on the array:** the weights are not sorted and their order is fixed; you search the space of capacities.
**Example:** [1,2,3,4,5,6,7,8,9,10], D=5 gives 15.

## Log lines with timestamps already sorted ascending; answer many queries "how many lines fall in [t1, t2]?". Which pattern, and what is the signal? {#dsawp-log-range-count}
**Pattern:** binary search on the array, twice: count = (first index > t2) − (first index ≥ t1), i.e. bisect_right − bisect_left.
**Signal:** the data itself is sorted, and each answer is a pair of positions in it.
**Why not binary search on the answer:** there is no value to guess and test; the boundaries give the answer directly. A scan is O(n) per query.
**Example:** [1,3,3,5,8,9], [3,8] gives 5 − 1 = 4 (3, 3, 5, 8).

## Count the ordered ways to write n as a sum of 1s, 3s and 4s, for n up to 100,000 (answer modulo 1,000,000,007). Which pattern, and what is the signal? {#dsawp-count-sums-134}
**Pattern:** 1D DP: ways[i] = ways[i−1] + ways[i−3] + ways[i−4], with ways[0] = 1.
**Signal:** "count" (not "list") + a huge answer (the modulo) + the same smaller sums needed over and over.
**Why not backtracking:** it builds every way one at a time, and the number of ways grows exponentially with n.
**Example:** n=4 gives 4: 1+1+1+1, 1+3, 3+1, 4.

## A string and a dictionary: return every way to cut the string into dictionary words, as full sentences. Which pattern, and what is the signal? {#dsawp-list-sentences}
**Pattern:** backtracking: at each position try every word that matches, recurse on the rest, undo; memoise by start index if suffixes repeat.
**Signal:** "list every", where the output itself can be exponentially large.
**Why not a plain DP table:** DP answers "is it possible?" or "how many?"; to *list*, you still have to walk each choice. Yes/no for the same input → DP.
**Example:** "catsanddog" with [cat, cats, and, sand, dog] gives "cats and dog" and "cat sand dog".

## Daily share prices: for each day, how many consecutive days ending today had a price ≤ today's? Which pattern, and what is the signal? {#dsawp-stock-span}
**Pattern:** monotonic stack (kept in decreasing price order) of (price, span); pop every entry ≤ today and add its span to today's.
**Signal:** for each element, the *nearest* earlier element that is bigger.
**Why not a heap:** a heap gives the global largest or smallest, not the nearest bigger one to the left, and cannot drop items by position cheaply.
**Example:** [100,80,60,70,60,75,85] gives [1,1,1,2,1,4,6].

## Ropes of given lengths; joining two ropes costs the sum of their lengths, and the joined rope goes back in the pile. Minimum total cost to end with one rope? Which pattern, and what is the signal? {#dsawp-connect-ropes}
**Pattern:** min-heap, greedy: always join the two shortest ropes and push the result back.
**Signal:** "repeatedly take the global smallest, and the result rejoins the pool".
**Why not sorting once or a monotonic stack:** each join creates a new length that must be re-ranked; a stack only knows arrival order.
**Example:** [4,3,2,6] gives 29: 2+3 = 5, 4+5 = 9, 6+9 = 15; 5 + 9 + 15 = 29.

## n oranges (n up to 2 billion). Each day eat 1; or, if n is divisible by 2, eat n/2; or, if divisible by 3, eat 2n/3. Fewest days to eat all? Which pattern, and what is the signal? {#dsawp-oranges-top-down}
**Pattern:** top-down DP (recursion + memo): f(n) = 1 + min(n % 2 + f(n // 2), n % 3 + f(n // 3)), f(0) = 0, f(1) = 1.
**Signal:** a huge n but only a few reachable states: dividing by 2 or 3 reaches about O(log² n) distinct values.
**Why not bottom-up:** a table from 0 to 2 billion fills states that are never visited and does not fit in memory.
**Example:** n=10 gives 4: 10 → 9 → 3 → 1 → 0.

## Staircase of up to 1,000,000 steps; stepping on step i costs cost[i]; climb 1 or 2 at a time, starting at step 0 or 1. Minimum cost to get past the top? Which pattern, and what is the signal? {#dsawp-stairs-bottom-up}
**Pattern:** bottom-up DP with two rolling variables: best[i] = cost[i] + min(best[i−1], best[i−2]).
**Signal:** every state is needed anyway, in a simple left-to-right order, and n is large.
**Why not top-down:** recursion 1,000,000 deep breaks Python's default limit (1,000), and the memo costs O(n) memory instead of O(1).
**Example:** cost [10,15,20] gives 15: start on step 1, jump 2 past the top.

## A list of words is sorted in an unknown alphabet's order; recover one valid ordering of its letters, or report that none exists. Which pattern, and what is the signal? {#dsawp-alien-order}
**Pattern:** topological sort: each adjacent word pair's first differing letters give an edge a → b; peel letters with no incoming edges (Kahn's); leftovers mean a cycle → invalid.
**Signal:** "an order consistent with before/after constraints", plus "or say it's impossible" (cycle detection).
**Why not an ordinary sort:** you only have some pairwise facts; unrelated letters have no comparison, so a comparator cannot be written.
**Example:** ["wrt","wrf","er","ett","rftt"] gives t<f, w<e, r<t, e<r → "wertf". Trap: ["abc","ab"] is invalid (a word before its own prefix).
