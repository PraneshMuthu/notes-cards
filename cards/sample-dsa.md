---
topic: DSA · Arrays & Hashing
group: DSA
---

## Two Sum: given an array and a target, return the indices of the two numbers that add up to it. {#dsa-two-sum}
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

## Container With Most Water: given bar heights, pick two bars that hold the most water. {#dsa-container-most-water}
**Pattern:** two pointers, moving inward from both ends.
**Insight:** area is limited by the shorter bar, so always move the shorter pointer. Moving the taller one can only shrink the width and never raise the limit.
**Complexity:** O(n) time, O(1) space.

<details>
<summary>Code</summary>

```python
def max_area(h):
    l, r, best = 0, len(h) - 1, 0
    while l < r:
        best = max(best, min(h[l], h[r]) * (r - l))
        if h[l] < h[r]: l += 1
        else: r -= 1
    return best
```

</details>
