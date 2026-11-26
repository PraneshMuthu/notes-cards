---
topic: DSA · Sliding Window
group: DSA
---

## Best Time to Buy and Sell Stock: one buy then one later sell; maximise profit. E.g. prices [7,1,5,3,6,4] gives 5. {#dsasw-best-time-stock}
**Pattern:** single pass tracking the minimum so far.
**Insight:** the best sell on day i pairs with the cheapest price before it. Keep a running min and the best difference.
**Complexity:** O(n) time, O(1) space.

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

## Longest Substring Without Repeating Characters: length of the longest substring with all distinct characters. E.g. "abcabcbb" gives 3 ("abc"). {#dsasw-longest-no-repeat}
**Pattern:** sliding window with last-seen index map.
**Insight:** on a repeat inside the window, jump the left edge to just past that character's previous index. Window always stays duplicate-free.
**Complexity:** O(n) time, O(k) space (k = alphabet size).

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

## Longest Repeating Character Replacement: you may change at most k characters; find the longest run of one repeated letter. E.g. "AABABBA", k=1 gives 4. {#dsasw-char-replacement}
**Pattern:** sliding window with max-frequency count.
**Insight:** a window is valid if `window size - count of its most common letter <= k`. Shrink by one when invalid. The max count never needs to decrease, since only a larger one can improve the answer.
**Complexity:** O(n) time, O(26) = O(1) space.

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

## Minimum Window Substring: smallest substring of s containing every character of t (with multiplicity). E.g. s="ADOBECODEBANC", t="ABC" gives "BANC". {#dsasw-min-window-substring}
**Pattern:** expand right, then shrink left while still valid.
**Insight:** keep `need[c]` counts and a `missing` counter. Once missing is 0, advance left while the left char is surplus, record the window, then drop one needed char and continue.
**Complexity:** O(n + m) time, O(k) space (k = distinct chars).

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
