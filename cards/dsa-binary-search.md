---
topic: DSA · Binary Search
group: DSA
---

## A sorted array of distinct values was rotated at an unknown point; return a target's index or -1, in O(log n). E.g. [4,5,6,7,0,1,2], target 0 gives 4. (Search in Rotated Sorted Array) {#dsabs-search-rotated}
**Pattern:** binary search, deciding by whichever half is sorted.
**Insight:** at any mid, at least one half is in order (compare a[l] with a[mid]). If the target lies within that sorted half's range, go there; otherwise go to the other half.
**Complexity:** O(log n) time, O(1) space.
**Edge:** not rotated at all works unchanged; `a[l] <= a[m]` needs the `=` for when l == m.
Grade on pattern + insight; complexity is a check.

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

## A sorted array of distinct values was rotated at an unknown point; return its smallest value in O(log n). E.g. [3,4,5,1,2] gives 1. (Find Minimum in Rotated Sorted Array) {#dsabs-find-min-rotated}
**Pattern:** binary search comparing mid with the right end.
**Insight:** if a[mid] > a[right], the drop (and so the minimum) is strictly right of mid; otherwise mid could be the minimum. So set r = mid, not mid − 1, and the minimum is never skipped.
**Complexity:** O(log n) time, O(1) space.
**Edge:** not rotated → a[0]; with duplicates allowed, a[mid] == a[right] forces r −= 1 and the worst case becomes O(n).
Grade on pattern + insight; complexity is a check.

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

## Piles of bananas and h hours; each hour you eat up to k bananas from one pile (leftover time that hour is wasted). Smallest k that finishes within h hours? E.g. piles [3,6,7,11], h=8 gives 4. (Koko Eating Bananas) {#dsabs-koko-bananas}
**Pattern:** binary search on the answer (search the range of possible k, not the array).
**Insight:** hours needed only goes down as k goes up (monotonic), so the "finishes in time" test flips from false to true once. Find the first k in [1, max(piles)] where sum(ceil(p / k)) ≤ h.
**Complexity:** O(n log M) time (M = largest pile), O(1) space.
**Edge:** h equal to the number of piles → max(piles); the upper bound max(piles) always passes.
Grade on pattern + insight; complexity is a check.

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

## Matrix where each row is sorted and each row's first value exceeds the previous row's last; is a target present, in O(log(R·C))? E.g. [[1,3,5],[7,9,11]], target 9 gives true. (Search a 2D Matrix) {#dsabs-search-2d-matrix}
**Pattern:** binary search over a flattened index.
**Insight:** read row by row, the matrix is one sorted list of R × C values, so search 0..R·C − 1 and map index m to row m // C, column m % C.
**Complexity:** O(log(R × C)) time, O(1) space.
**Edge:** empty matrix or empty rows → false before touching mat[0]; a 1 × 1 matrix works.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def search_matrix(mat, t):
    if not mat or not mat[0]: return False
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

## Sorted array that may contain repeats, and a target: return the first and last index of the target, or [-1,-1], in O(log n). E.g. [5,7,7,8,8,10], target 8 gives [3,4]. (Find First and Last Position) {#dsabs-first-last-position}
**Pattern:** boundary binary search (lower bound: the first index where a[i] ≥ x).
**Insight:** don't stop when you hit the target; keep shrinking toward the boundary. First = lower_bound(t); last = lower_bound(t + 1) − 1 (for integers). One template, run twice, with `lo < hi` and `hi = mid`.
**Complexity:** O(log n) time, O(1) space. (Finding one match then scanning outward is O(n) when all values equal.)
**Edge:** target absent → lower_bound lands on a different value or past the end; check before returning.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def search_range(a, t):
    def lower(x):                    # first i with a[i] >= x
        lo, hi = 0, len(a)
        while lo < hi:
            mid = (lo + hi) // 2
            if a[mid] < x: lo = mid + 1
            else: hi = mid
        return lo
    i = lower(t)
    if i == len(a) or a[i] != t: return [-1, -1]
    return [i, lower(t + 1) - 1]
```

</details>
