---
topic: DSA · Arrays & Hashing
group: DSA
---

## Two Sum: find the two indices whose values add up to a target. E.g. [2,7,11,15], target 9 gives [0,1]. {#dsaah-two-sum}
**Pattern:** hash map of seen values (complement lookup).
**Insight:** for each number `x`, you only need to know if `target - x` was already seen. Store value to index as you scan.
**Complexity:** O(n) time, O(n) space.

<details>
<summary>Code</summary>

```python
def two_sum(nums, target):
    seen = {}
    for i, x in enumerate(nums):
        if target - x in seen:
            return [seen[target - x], i]
        seen[x] = i
```

</details>

## Contains Duplicate: return true if any value appears at least twice. E.g. [1,2,3,1] gives true. {#dsaah-contains-duplicate}
**Pattern:** hash set.
**Insight:** a set drops repeats, so if the set is smaller than the list, something repeated.
**Complexity:** O(n) time, O(n) space.

<details>
<summary>Code</summary>

```python
def contains_duplicate(nums):
    return len(set(nums)) != len(nums)
```

</details>

## Valid Anagram: do two strings use exactly the same letters with the same counts? E.g. "listen" and "silent" give true. {#dsaah-valid-anagram}
**Pattern:** frequency count.
**Insight:** two strings are anagrams exactly when their character counts match.
**Complexity:** O(n) time, O(1) space (fixed alphabet; O(k) for k distinct chars).

<details>
<summary>Code</summary>

```python
from collections import Counter
def is_anagram(s, t):
    return Counter(s) == Counter(t)
```

</details>

## Group Anagrams: group the words that are anagrams of each other. E.g. ["eat","tea","tan","ate","nat","bat"] gives [["eat","tea","ate"],["tan","nat"],["bat"]]. {#dsaah-group-anagrams}
**Pattern:** hash map keyed by a canonical form.
**Insight:** anagrams share the same sorted letters, so use the sorted word as the dict key.
**Complexity:** O(n · k log k) time (n words, length k), O(n · k) space.

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

## Top K Frequent Elements: return the k most frequent values. E.g. [1,1,1,2,2,3], k=2 gives [1,2]. {#dsaah-top-k-frequent}
**Pattern:** frequency count plus bucket sort.
**Insight:** a count is at most n, so make buckets indexed by count and read from the highest bucket down. No heap or sort needed.
**Complexity:** O(n) time, O(n) space.

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

## Product of Array Except Self: for each index, the product of all other elements, without using division. E.g. [1,2,3,4] gives [24,12,8,6]. {#dsaah-product-except-self}
**Pattern:** prefix and suffix products.
**Insight:** answer[i] = (product of everything left of i) x (product of everything right of i). Build left products in the output, then multiply right products in a second pass.
**Complexity:** O(n) time, O(1) extra space (output excluded).

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

## Longest Consecutive Sequence: length of the longest run of consecutive integers in an unsorted array. E.g. [100,4,200,1,3,2] gives 4 (1,2,3,4). {#dsaah-longest-consecutive}
**Pattern:** hash set, start only at run beginnings.
**Insight:** only count up from `x` when `x - 1` is not in the set. Each run is then walked once, so it stays linear.
**Complexity:** O(n) time, O(n) space.

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
