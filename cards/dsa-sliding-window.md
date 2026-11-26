---
topic: DSA · Sliding Window
group: DSA
---

## String: length of the longest contiguous stretch in which no character repeats. E.g. "abcabcbb" gives 3 ("abc"); "pwwkew" gives 3 ("wke"). (Longest Substring Without Repeating Characters) {#dsasw-longest-no-repeat}
**Pattern:** sliding window (a contiguous range [l, r] that grows on the right and shrinks on the left) plus a map of each character's last index.
**Insight:** when s[r] already appears inside the window, jump l to just past that earlier position. The window is then duplicate-free again, and l never moves backwards.
**Complexity:** O(n) time, O(k) space (k = alphabet size).
**Edge:** a repeat seen *before* l ("abba" at the last a) must not move l back; hence the `last[c] >= l` check. Empty string → 0.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def length_of_longest(s):
    last, l, best = {}, 0, 0
    for r, c in enumerate(s):
        if c in last and last[c] >= l:
            l = last[c] + 1
        last[c] = r
        best = max(best, r - l + 1)
    return best
```

</details>

## Uppercase string and k: you may change up to k characters; length of the longest stretch that can be made all one letter. E.g. "AABABBA", k=1 gives 4 ("AABA" → "AAAA"). (Longest Repeating Character Replacement) {#dsasw-char-replacement}
**Pattern:** sliding window plus counts of each letter inside it.
**Insight:** a window is fixable when its size − (count of its most common letter) ≤ k. When it is not, slide (move l by one), never shrink below the best size. The stale max count can only keep the window at a size already achieved, so the answer grows only when some letter's count truly beats the old max.
**Complexity:** O(n) time, O(26) = O(1) space.
**Edge:** k ≥ length → the whole string.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def character_replacement(s, k):
    cnt, l, mx, best = {}, 0, 0, 0
    for r, c in enumerate(s):
        cnt[c] = cnt.get(c, 0) + 1
        mx = max(mx, cnt[c])
        if (r - l + 1) - mx > k:
            cnt[s[l]] -= 1; l += 1
        best = max(best, r - l + 1)
    return best
```

</details>

## Strings s and t: the shortest stretch of s that contains every character of t, with repeats counted. E.g. s="ADOBECODEBANC", t="ABC" gives "BANC". (Minimum Window Substring) {#dsasw-min-window-substring}
**Pattern:** sliding window: expand right until valid, then shrink left while still valid.
**Insight:** keep need[c] (how many more of c the window still needs; negative means surplus) and a `missing` total. Once missing hits 0, drop surplus characters from the left, record the window, then give up one needed character and keep expanding.
**Complexity:** O(n + m) time (n = len s, m = len t), O(k) space (k distinct characters).
**Edge:** t longer than s, or a character of t absent from s → "". Repeats in t ("AA") must all be covered.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
from collections import Counter
def min_window(s, t):
    need, missing = Counter(t), len(t)
    l, bl, best = 0, float('inf'), (0, 0)
    for r, c in enumerate(s):
        if need[c] > 0: missing -= 1
        need[c] -= 1
        if missing == 0:
            while need[s[l]] < 0:
                need[s[l]] += 1; l += 1
            if r - l + 1 < bl: bl, best = r - l + 1, (l, r + 1)
            need[s[l]] += 1; missing += 1; l += 1
    return s[best[0]:best[1]]
```

</details>

## Integer array and window size k: the maximum of every length-k window, in O(n) total. E.g. [1,3,-1,-3,5,3,6,7], k=3 gives [3,3,5,5,6,7]. (Sliding Window Maximum) {#dsasw-window-max}
**Pattern:** monotonic deque: a double-ended queue of indices whose values only decrease from front to back.
**Insight:** a new value x makes every smaller value behind it useless (x is newer and bigger), so pop them off the back. The front is then the window's max; pop it from the front once it slides out of range.
**Complexity:** O(n) time (each index enters and leaves once), O(k) space. A heap gives O(n log n).
**Edge:** k = 1 → the array itself; equal values: pop only strictly smaller ones or use ≤, both are correct.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
from collections import deque
def max_sliding_window(a, k):
    dq, out = deque(), []
    for i, x in enumerate(a):
        while dq and a[dq[-1]] <= x: dq.pop()
        dq.append(i)
        if dq[0] <= i - k: dq.popleft()
        if i >= k - 1: out.append(a[dq[0]])
    return out
```

</details>
