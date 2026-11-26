---
topic: DSA · Arrays & Hashing
group: DSA
---

## Unsorted integer array and a target: return the indices of the two numbers that add up to it (exactly one answer). E.g. [3,2,4], target 6 gives [1,2]. (Two Sum) {#dsaah-two-sum}
**Pattern:** hash map of value → index seen so far (complement lookup).
**Insight:** at each x, the only partner that works is target − x; a map tells you in O(1) whether it has appeared. Check before storing x, so x never pairs with itself.
**Complexity:** O(n) time, O(n) space.
**Edge:** duplicates ([3,3], 6) work because you check before storing; no pair → return None.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def two_sum(nums, target):
    seen = {}
    for i, x in enumerate(nums):
        if target - x in seen:
            return [seen[target - x], i]
        seen[x] = i
    return None
```

</details>

## Integer array: return true if any value appears at least twice. E.g. [1,2,3,1] gives true. (Contains Duplicate) {#dsaah-contains-duplicate}
**Pattern:** hash set.
**Insight:** a set keeps one copy of each value, so if the set is smaller than the list, something repeated.
**Complexity:** O(n) time, O(n) space. (Sort and compare neighbours: O(n log n) time, O(1) extra.)
**Edge:** empty or single-element array → false.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def contains_duplicate(nums):
    return len(set(nums)) != len(nums)
```

</details>

## Two strings: do they use exactly the same letters, each the same number of times? E.g. "listen" and "silent" give true; "rat" and "car" give false. (Valid Anagram) {#dsaah-valid-anagram}
**Pattern:** frequency count (a map from character to how many times it occurs).
**Insight:** two strings are rearrangements of each other exactly when their character counts match.
**Complexity:** O(n) time, O(1) space for a fixed alphabet (O(k) for k distinct characters).
**Edge:** different lengths → false immediately.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
from collections import Counter
def is_anagram(s, t):
    return len(s) == len(t) and Counter(s) == Counter(t)
```

</details>

## List of words: group together the words that are rearrangements of each other. E.g. ["eat","tea","tan","ate","nat","bat"] gives [["eat","tea","ate"],["tan","nat"],["bat"]]. (Group Anagrams) {#dsaah-group-anagrams}
**Pattern:** hash map keyed by a canonical form (one spelling every member of the group shares).
**Insight:** rearrangements share the same sorted letters, so the sorted word is the dict key; each word lands in its group in one pass.
**Complexity:** O(n · k log k) time (n words, length k), O(n · k) space. A 26-count tuple as the key makes it O(n · k).
**Edge:** the empty string "" is a valid word and forms its own group.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
from collections import defaultdict
def group_anagrams(words):
    groups = defaultdict(list)
    for w in words:
        groups[tuple(sorted(w))].append(w)
    return list(groups.values())
```

</details>

## Integer array and k: return the k values that occur most often, in O(n) time. E.g. [1,1,1,2,2,3], k=2 gives [1,2]. (Top K Frequent Elements) {#dsaah-top-k-frequent}
**Pattern:** frequency count plus bucket sort (an array indexed by count).
**Insight:** a count can never exceed n, so make buckets 0..n indexed by count and read from the highest bucket down. No heap or comparison sort needed.
**Complexity:** O(n) time, O(n) space. (A size-k min-heap is O(n log k).)
**Edge:** ties at the k-th place: any of the tied values is acceptable.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
from collections import Counter
def top_k_frequent(nums, k):
    buckets = [[] for _ in range(len(nums) + 1)]
    for x, c in Counter(nums).items():
        buckets[c].append(x)
    out = []
    for b in reversed(buckets):
        out += b
        if len(out) >= k:
            return out[:k]
```

</details>

## Integer array: for each index, the product of all the other elements, without using division. E.g. [1,2,3,4] gives [24,12,8,6]. (Product of Array Except Self) {#dsaah-product-except-self}
**Pattern:** prefix and suffix products.
**Insight:** answer[i] = (product of everything left of i) × (product of everything right of i). Fill left products into the output, then multiply in right products on a backwards pass.
**Complexity:** O(n) time, O(1) extra space (the output array is not counted).
**Edge:** zeros: one zero leaves only its own slot non-zero; two zeros make every slot 0. Division would break on both.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def product_except_self(a):
    n = len(a)
    res = [1] * n
    p = 1
    for i in range(n):
        res[i] = p; p *= a[i]
    s = 1
    for i in range(n - 1, -1, -1):
        res[i] *= s; s *= a[i]
    return res
```

</details>

## Unsorted integer array: length of the longest run of consecutive integers (values in any positions), in O(n). E.g. [100,4,200,1,3,2] gives 4 (1,2,3,4). (Longest Consecutive Sequence) {#dsaah-longest-consecutive}
**Pattern:** hash set, counting only from the start of each run.
**Insight:** count upward from x only when x − 1 is not in the set, i.e. x starts a run. Each run is then walked once, so the total stays linear.
**Complexity:** O(n) time, O(n) space. (Sorting also works but is O(n log n).)
**Edge:** duplicates ([1,2,2,3] → 3) collapse in the set; empty array → 0.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def longest_consecutive(nums):
    s, best = set(nums), 0
    for x in s:
        if x - 1 not in s:
            y = x
            while y + 1 in s:
                y += 1
            best = max(best, y - x + 1)
    return best
```

</details>

## Daily share prices: buy on one day and sell on a later day; maximum profit, or 0 if no profit is possible. E.g. [7,1,5,3,6,4] gives 5 (buy at 1, sell at 6). (Best Time to Buy and Sell Stock) {#dsasw-best-time-stock}
**Pattern:** one pass with a running minimum ("cheapest so far").
**Insight:** the best sale on day i pairs with the cheapest price before i. Track that minimum and the best difference. It is not a real sliding window: nothing is ever shrunk from the left.
**Complexity:** O(n) time, O(1) space.
**Edge:** prices only falling ([5,4,3]) → 0, never negative.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def max_profit(prices):
    lo, best = float('inf'), 0
    for p in prices:
        lo = min(lo, p)
        best = max(best, p - lo)
    return best
```

</details>

## Integer array (values may be negative) and k: count the contiguous subarrays whose sum is exactly k. E.g. [1,1,1], k=2 gives 2; [1,-1,0], k=0 gives 3. (Subarray Sum Equals K) {#dsaah-subarray-sum-k}
**Pattern:** prefix sum (running total up to each index) plus a hash map counting how often each prefix sum has appeared.
**Insight:** sum(i..j) = pre[j] − pre[i−1], so at each j count the earlier prefixes equal to pre[j] − k. Seed {0: 1} so subarrays starting at index 0 count.
**Complexity:** O(n) time, O(n) space.
**Edge:** negatives are why a sliding window fails here: adding an element can lower the sum, so "shrink when too big" has no valid rule.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def subarray_sum(nums, k):
    count, pre, seen = 0, 0, {0: 1}
    for x in nums:
        pre += x
        count += seen.get(pre - k, 0)
        seen[pre] = seen.get(pre, 0) + 1
    return count
```

</details>
