---
topic: DSA · Binary Search
group: DSA
---

## Search in Rotated Sorted Array: a sorted array of distinct values was rotated; find a target's index or -1. E.g. [4,5,6,7,0,1,2], target 0 gives 4. {#dsabs-search-rotated}
**Pattern:** binary search on the half that is sorted.
**Insight:** at any mid, at least one half is sorted. Check if the target lies inside the sorted half; if so go there, otherwise go to the other half.
**Complexity:** O(log n) time, O(1) space.

<details>
<summary>Code</summary>

```python
def search(a, t):
    l, r = 0, len(a) - 1
    while l <= r:
        m = (l + r) // 2
        if a[m] == t: return m
        if a[l] <= a[m]:
            if a[l] <= t < a[m]: r = m - 1
            else: l = m + 1
        else:
            if a[m] < t <= a[r]: l = m + 1
            else: r = m - 1
    return -1
```

</details>

## Find Minimum in Rotated Sorted Array: return the smallest value of a rotated sorted array of distinct values. E.g. [3,4,5,1,2] gives 1. {#dsabs-find-min-rotated}
**Pattern:** binary search comparing mid with the right end.
**Insight:** if `a[mid] > a[right]` the minimum is strictly right of mid; otherwise it is at mid or left. Keep `r = mid` (not mid-1) so the minimum is never skipped.
**Complexity:** O(log n) time, O(1) space.

<details>
<summary>Code</summary>

```python
def find_min(a):
    l, r = 0, len(a) - 1
    while l < r:
        m = (l + r) // 2
        if a[m] > a[r]: l = m + 1
        else: r = m
    return a[l]
```

</details>

## Koko Eating Bananas: piles of bananas, h hours; each hour she eats up to k from one pile. Find the minimum k that finishes in h hours. E.g. piles [3,6,7,11], h=8 gives 4. {#dsabs-koko-bananas}
**Pattern:** binary search on the answer.
**Insight:** hours needed is non-increasing as k grows, so search k in [1, max(piles)] for the smallest k where `sum(ceil(p/k)) <= h`.
**Complexity:** O(n log M) time (M = max pile), O(1) space.

<details>
<summary>Code</summary>

```python
def min_eating_speed(piles, h):
    l, r = 1, max(piles)
    while l < r:
        m = (l + r) // 2
        if sum(-(-p // m) for p in piles) <= h: r = m
        else: l = m + 1
    return l
```

</details>

## Search a 2D Matrix: each row is sorted and each row starts above the previous row's last value. Is the target present? E.g. [[1,3,5],[7,9,11]], target 9 gives true. {#dsabs-search-2d-matrix}
**Pattern:** binary search on a flattened index.
**Insight:** the matrix reads as one sorted array of R x C items. Index m maps to row `m // C`, column `m % C`.
**Complexity:** O(log(R x C)) time, O(1) space.

<details>
<summary>Code</summary>

```python
def search_matrix(mat, t):
    R, C = len(mat), len(mat[0])
    l, r = 0, R * C - 1
    while l <= r:
        m = (l + r) // 2
        v = mat[m // C][m % C]
        if v == t: return True
        if v < t: l = m + 1
        else: r = m - 1
    return False
```

</details>
