---
topic: DSA · Two Pointers
group: DSA
---

## Bar heights in a row: pick two bars that, with the ground between them, hold the most water. E.g. [1,8,6,2,5,4,8,3,7] gives 49 (bars 8 and 7, width 7). (Container With Most Water) {#dsatp-container-most-water}
**Pattern:** two pointers, one at each end, moving inward.
**Insight:** water is capped by the shorter bar, so move the shorter pointer. Moving the taller one only shrinks the width while the cap stays the same or drops, so it can never beat the current pair.
**Complexity:** O(n) time, O(1) space.
**Edge:** fewer than two bars → 0; equal heights: moving either side is safe.
Grade on pattern + insight; complexity is a check.

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

## Array sorted ascending and a target: return the 1-based positions of the two numbers that sum to it, using O(1) extra space. E.g. [1,3,4,6], target 10 gives [3,4]. (Two Sum II) {#dsatp-two-sum-sorted}
**Pattern:** two pointers from both ends, using the sorted order.
**Insight:** if the sum is too big, the right number is too big for every remaining left partner, so drop it; if too small, drop the left. Each step discards one candidate for good.
**Complexity:** O(n) time, O(1) space. (A hash map also works but costs O(n) space.)
**Edge:** duplicates ([2,2,5], target 4 → [1,2]) are fine because l < r.
Grade on pattern + insight; complexity is a check.

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

## String: ignoring case and anything that is not a letter or digit, does it read the same both ways? Use O(1) extra space. E.g. "A man, a plan, a canal: Panama" gives true. (Valid Palindrome) {#dsatp-valid-palindrome}
**Pattern:** two pointers closing in from both ends.
**Insight:** skip characters that are not letters or digits on each side, then compare the lowercase forms; any mismatch ends it.
**Complexity:** O(n) time, O(1) space. (Building a cleaned, reversed copy is O(n) space.)
**Edge:** an empty string or one with only punctuation (",.") → true.
Grade on pattern + insight; complexity is a check.

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

## Integer array: list every distinct triple of values that sums to zero (no repeated triples). E.g. [-1,0,1,2,-1,-4] gives [[-1,-1,2],[-1,0,1]]. (3Sum) {#dsatp-three-sum}
**Pattern:** sort, fix one number, then two pointers on the rest.
**Insight:** after sorting, fix a[i] and find pairs summing to −a[i] in the suffix with two pointers. Equal values sit next to each other after sorting, so skipping a value equal to the previous one removes duplicate triples.
**Complexity:** O(n²) time, O(1) extra space (ignoring the sort and the output).
**Edge:** [0,0,0,0] → one triple [0,0,0]; fewer than 3 numbers → [].
Grade on pattern + insight; complexity is a check.

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

## Bar heights in a row: after rain, how many units of water stay trapped between the bars? O(1) extra space. E.g. [0,1,0,2,1,0,1,3,2,1,2,1] gives 6. (Trapping Rain Water) {#dsatp-trapping-rain-water}
**Pattern:** two pointers, each tracking the tallest bar seen on its side.
**Insight:** water over a bar = min(tallest on left, tallest on right) − its height. Process the side whose current bar is shorter: the other side already has something at least as tall, so this side's running max is the true limit.
**Complexity:** O(n) time, O(1) space. (Prefix-max and suffix-max arrays give O(n) space.)
**Edge:** strictly rising or falling bars → 0; fewer than 3 bars → 0.
Grade on pattern + insight; complexity is a check.

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

## String: return its longest substring that reads the same forwards and backwards. E.g. "babad" gives "bab" (or "aba"); "cbbd" gives "bb". (Longest Palindromic Substring) {#dsadp-longest-palindrome}
**Pattern:** expand around centre: two pointers moving outward.
**Insight:** every palindrome mirrors around a centre, either a character (odd length) or the gap between two (even). Try all 2n − 1 centres and grow outward while both ends match.
**Complexity:** O(n²) time, O(1) space. (A DP table of "is s[i..j] a palindrome" is also O(n²) time but O(n²) space.)
**Edge:** even-length answers ("cbbd" → "bb") need the gap centres; a single character is always a palindrome.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def longest_palindrome(s):
    best = ""
    for c in range(len(s)):
        for l, r in ((c, c), (c, c + 1)):
            while l >= 0 and r < len(s) and s[l] == s[r]:
                l -= 1; r += 1
            if r - l - 1 > len(best): best = s[l + 1:r]
    return best
```

</details>
