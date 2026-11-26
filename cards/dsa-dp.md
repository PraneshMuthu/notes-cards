---
topic: DSA · Dynamic Programming
group: DSA
---

## Climbing Stairs: n steps, you climb 1 or 2 at a time. How many distinct ways to reach the top? E.g. n=3 gives 3 (1+1+1, 1+2, 2+1). {#dsadp-climbing-stairs}
**Pattern:** 1D DP (Fibonacci).
**Insight:** ways(n) = ways(n-1) + ways(n-2), since the last move was a 1 or a 2. Keep only the last two values.
**Complexity:** O(n) time, O(1) space.

<details>
<summary>Code</summary>

```python
def climb_stairs(n):
    a, b = 1, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

</details>

## House Robber: houses in a row hold money; you cannot rob two adjacent houses. Max total? E.g. [2,7,9,3,1] gives 12 (2+9+1). {#dsadp-house-robber}
**Pattern:** 1D DP with take-or-skip.
**Insight:** best(i) = max(best(i-1), best(i-2) + money[i]): skip this house, or rob it and use the best from two back. Two variables are enough.
**Complexity:** O(n) time, O(1) space.

<details>
<summary>Code</summary>

```python
def rob(nums):
    prev = cur = 0
    for x in nums:
        prev, cur = cur, max(cur, prev + x)
    return cur
```

</details>

## Coin Change: fewest coins (unlimited supply of each type) that sum to an amount, or -1. E.g. coins [1,2,5], amount 11 gives 3 (5+5+1). {#dsadp-coin-change}
**Pattern:** unbounded knapsack, bottom-up DP over amounts.
**Insight:** dp[a] = 1 + min(dp[a - c]) over coins c <= a, with dp[0] = 0 and unreachable as infinity. Greedy fails (e.g. coins [1,3,4], amount 6).
**Complexity:** O(amount x n) time, O(amount) space.

<details>
<summary>Code</summary>

```python
def coin_change(coins, amount):
    INF = float('inf')
    dp = [0] + [INF] * amount
    for a in range(1, amount + 1):
        for c in coins:
            if c <= a: dp[a] = min(dp[a], dp[a - c] + 1)
    return dp[amount] if dp[amount] != INF else -1
```

</details>

## Longest Increasing Subsequence: length of the longest strictly increasing subsequence (not necessarily contiguous). E.g. [10,9,2,5,3,7,101,18] gives 4 (2,3,7,101). {#dsadp-lis}
**Pattern:** patience sorting with binary search.
**Insight:** `tails[i]` is the smallest possible tail of an increasing subsequence of length i+1. For each x, replace the first tail >= x (bisect_left), or append if none. The list length is the answer.
**Complexity:** O(n log n) time, O(n) space. (Classic DP is O(n^2).)

<details>
<summary>Code</summary>

```python
from bisect import bisect_left
def lis(nums):
    tails = []
    for x in nums:
        i = bisect_left(tails, x)
        if i == len(tails): tails.append(x)
        else: tails[i] = x
    return len(tails)
```

</details>

## Longest Common Subsequence: length of the longest subsequence shared by two strings. E.g. "abcde" and "ace" gives 3 ("ace"). {#dsadp-lcs}
**Pattern:** 2D DP over prefixes.
**Insight:** dp[i][j] = dp[i-1][j-1] + 1 if the characters match, else max(dp[i-1][j], dp[i][j-1]).
**Complexity:** O(m x n) time, O(m x n) space (O(min(m,n)) with rolling rows).

<details>
<summary>Code</summary>

```python
def lcs(a, b):
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            if a[i-1] == b[j-1]: dp[i][j] = dp[i-1][j-1] + 1
            else: dp[i][j] = max(dp[i-1][j], dp[i][j-1])
    return dp[-1][-1]
```

</details>

## Word Break: can a string be split into a sequence of words from a dictionary (words reusable)? E.g. "leetcode" with ["leet","code"] gives true. {#dsadp-word-break}
**Pattern:** 1D DP over prefix length.
**Insight:** dp[i] is true if some j < i has dp[j] true and `s[j:i]` is a word. dp[0] = true for the empty prefix.
**Complexity:** O(n^2) substring checks, each up to O(n) to slice and hash, so O(n^3) worst case; O(n) space plus the dictionary.

<details>
<summary>Code</summary>

```python
def word_break(s, words):
    ws = set(words)
    dp = [True] + [False] * len(s)
    for i in range(1, len(s) + 1):
        dp[i] = any(dp[j] and s[j:i] in ws for j in range(i))
    return dp[len(s)]
```

</details>
