---
topic: DSA · Two Pointers
group: DSA
---

## Container With Most Water: given bar heights, pick two bars that hold the most water. E.g. [1,8,6,2,5,4,8,3,7] gives 49. {#dsatp-container-most-water}
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

## Two Sum II: in a sorted array, find the 1-based positions of two numbers adding to a target. E.g. [2,7,11,15], target 9 gives [1,2]. {#dsatp-two-sum-sorted}
**Pattern:** two pointers on sorted input.
**Insight:** if the sum is too big, the right end must shrink; if too small, the left end must grow. Sortedness lets each step discard one candidate.
**Complexity:** O(n) time, O(1) space.

<details>
<summary>Code</summary>

```python
def two_sum_sorted(a, target):
    l, r = 0, len(a) - 1
    while l < r:
        s = a[l] + a[r]
        if s == target: return [l + 1, r + 1]
        if s < target: l += 1
        else: r -= 1
```

</details>

## Valid Palindrome: ignoring case and non-alphanumeric characters, is the string a palindrome? E.g. "A man, a plan, a canal: Panama" gives true. {#dsatp-valid-palindrome}
**Pattern:** two pointers from both ends.
**Insight:** skip characters that are not letters or digits, then compare lowercase versions as the pointers close in.
**Complexity:** O(n) time, O(1) space.

<details>
<summary>Code</summary>

```python
def is_palindrome(s):
    l, r = 0, len(s) - 1
    while l < r:
        while l < r and not s[l].isalnum(): l += 1
        while l < r and not s[r].isalnum(): r -= 1
        if s[l].lower() != s[r].lower(): return False
        l += 1; r -= 1
    return True
```

</details>

## 3Sum: list all unique triplets that sum to zero. E.g. [-1,0,1,2,-1,-4] gives [[-1,-1,2],[-1,0,1]]. {#dsatp-three-sum}
**Pattern:** sort, fix one number, two pointers for the rest.
**Insight:** after sorting, fix `a[i]` and run the sorted two-sum on the suffix. Skip repeated values of `a[i]` and of the left pointer to avoid duplicate triplets.
**Complexity:** O(n^2) time, O(1) extra space (ignoring sort and output).

<details>
<summary>Code</summary>

```python
def three_sum(a):
    a.sort(); res = []
    for i in range(len(a) - 2):
        if i and a[i] == a[i - 1]: continue
        l, r = i + 1, len(a) - 1
        while l < r:
            s = a[i] + a[l] + a[r]
            if s < 0: l += 1
            elif s > 0: r -= 1
            else:
                res.append([a[i], a[l], a[r]]); l += 1
                while l < r and a[l] == a[l - 1]: l += 1
    return res
```

</details>

## Trapping Rain Water: given bar heights, how much water stays trapped between them after rain? E.g. [0,1,0,2,1,0,1,3,2,1,2,1] gives 6. {#dsatp-trapping-rain-water}
**Pattern:** two pointers tracking left max and right max.
**Insight:** water above a bar = min(left max, right max) minus its height. Process the side with the smaller bar: its limit is that side's running max, because the other side already has something at least as tall.
**Complexity:** O(n) time, O(1) space.

<details>
<summary>Code</summary>

```python
def trap(h):
    l, r, lm, rm, water = 0, len(h) - 1, 0, 0, 0
    while l < r:
        if h[l] < h[r]:
            lm = max(lm, h[l]); water += lm - h[l]; l += 1
        else:
            rm = max(rm, h[r]); water += rm - h[r]; r -= 1
    return water
```

</details>
