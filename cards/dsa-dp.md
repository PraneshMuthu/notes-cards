---
topic: DSA · Dynamic Programming
group: DSA
---

## Staircase of n steps; each move climbs 1 or 2 steps. How many distinct move sequences reach the top? E.g. n=3 gives 3 (1+1+1, 1+2, 2+1). (Climbing Stairs) {#dsadp-climbing-stairs}
**Pattern:** 1D DP (dynamic programming: solve each smaller size once and reuse it); here it is Fibonacci.
**Insight:** ways(n) = ways(n−1) + ways(n−2), because the last move was either a 1 or a 2. Only the last two values are ever needed.
**Complexity:** O(n) time, O(1) space.
**Edge:** n = 0 → 1 (the empty sequence); n = 1 → 1.
Grade on pattern + insight; complexity is a check.

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

## Houses in a row each hold some cash; you may not take from two neighbouring houses. Maximum total? E.g. [2,7,9,3,1] gives 12 (2 + 9 + 1). (House Robber) {#dsadp-house-robber}
**Pattern:** 1D DP with a take-or-skip choice.
**Insight:** best(i) = max(best(i−1), best(i−2) + cash[i]): skip this house, or take it and add the best from two back. Two variables are enough.
**Complexity:** O(n) time, O(1) space.
**Edge:** empty → 0; one house → its cash. Greedy "take every other house" fails on [2,1,1,2] (best is 4).
Grade on pattern + insight; complexity is a check.

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

## Coin denominations (unlimited of each) and an amount: the fewest coins that make it exactly, or -1. E.g. coins [1,2,5], amount 11 gives 3 (5+5+1). (Coin Change) {#dsadp-coin-change}
**Pattern:** unbounded knapsack: bottom-up DP over every amount 0..target.
**Insight:** dp[a] = 1 + min(dp[a − c]) over coins c ≤ a, with dp[0] = 0 and "unreachable" as infinity. Greedy (largest coin first) fails: coins [1,3,4], amount 6 → greedy 4+1+1 = 3 coins, best 3+3 = 2.
**Complexity:** O(amount × n) time (n coin types), O(amount) space.
**Edge:** amount 0 → 0; an amount no combination reaches (coins [2], amount 3) → -1.
Grade on pattern + insight; complexity is a check.

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

## Integer array: length of the longest strictly increasing subsequence (elements in order, not necessarily adjacent). E.g. [10,9,2,5,3,7,101,18] gives 4 (2,3,7,101). (Longest Increasing Subsequence) {#dsadp-lis}
**Pattern:** 1D DP on "best ending at i"; the follow-up is binary search over tails.
**Insight:** dp[i] = 1 + max(dp[j]) over j < i with nums[j] < nums[i]; answer = max(dp). Follow-up: tails[L] = smallest last value of any increasing run of length L + 1. A smaller tail is easier to extend, so each x replaces the first tail ≥ x.
**Complexity:** O(n²) DP (say this first), O(n log n) with tails; O(n) space.
**Edge:** duplicates do not extend a strict run (bisect_left handles it); empty → 0. `tails` is not itself an answer; only its length is.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def lis_dp(nums):
    dp = [1] * len(nums)
    for i in range(len(nums)):
        for j in range(i):
            if nums[j] < nums[i]: dp[i] = max(dp[i], dp[j] + 1)
    return max(dp, default=0)

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

## Two strings: length of the longest sequence of characters that appears in both, in order but not necessarily adjacent. E.g. "abcde" and "ace" give 3 ("ace"). (Longest Common Subsequence) {#dsadp-lcs}
**Pattern:** 2D DP over prefixes (dp[i][j] = answer for the first i chars of a and first j of b).
**Insight:** if a[i−1] == b[j−1], dp[i][j] = dp[i−1][j−1] + 1; otherwise one of the two last characters is not used, so take max(dp[i−1][j], dp[i][j−1]).
**Complexity:** O(m × n) time, O(m × n) space (O(min(m, n)) keeping two rows).
**Edge:** either string empty → 0 (the extra zero row and column handle it).
Grade on pattern + insight; complexity is a check.

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

## A string and a dictionary of words (reusable): can the string be cut into a sequence of dictionary words? E.g. "leetcode" with ["leet","code"] gives true; "catsandog" with ["cats","dog","sand","and","cat"] gives false. (Word Break) {#dsadp-word-break}
**Pattern:** 1D DP over prefix length.
**Insight:** dp[i] is true if some j < i has dp[j] true and s[j:i] is a word: a good prefix followed by one word. dp[0] = true for the empty prefix.
**Complexity:** O(n²) dictionary checks; O(n³) counting the cost of slicing and hashing. Limiting j to the longest word's length helps. O(n) space.
**Edge:** greedy longest-match fails: "abcd" with ["a","abc","b","cd"] takes "abc", then "d" is stuck; a + b + cd works. Hence every split j is tried.
Grade on pattern + insight; complexity is a check.

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

## Integer array with negatives: the largest sum of any contiguous, non-empty stretch. E.g. [-2,1,-3,4,-1,2,1,-5,4] gives 6 ([4,-1,2,1]). (Maximum Subarray) {#dsadp-max-subarray}
**Pattern:** Kadane's algorithm: 1D DP on "best sum ending here".
**Insight:** the best stretch ending at x is either x alone or x added to the best stretch ending just before. If that running sum has gone negative, it only drags x down, so restart.
**Complexity:** O(n) time, O(1) space.
**Edge:** all negative ([-3,-1,-2]) → -1, the largest single element; starting best at 0 would wrongly return 0.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def max_subarray(a):
    cur = best = a[0]
    for x in a[1:]:
        cur = max(x, cur + x)
        best = max(best, cur)
    return best
```

</details>

## Positive integers: can they be split into two groups with equal sums (each number used exactly once)? E.g. [1,5,11,5] gives true (11 vs 1+5+5); [1,2,5] gives false. (Partition Equal Subset Sum) {#dsadp-partition-subset}
**Pattern:** 0/1 knapsack (each item used at most once): a boolean DP over reachable sums.
**Insight:** the question is "can some subset hit total / 2?". Keep can[s] = some subset sums to s; for each number x, update s from high to low so x is used at most once.
**Complexity:** O(n × S) time (S = total / 2), O(S) space.
**Edge:** odd total → false at once. Looping s upward would reuse x, turning it into the unbounded (coin-change) version.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def can_partition(nums):
    total = sum(nums)
    if total % 2: return False
    S = total // 2
    can = [True] + [False] * S
    for x in nums:
        for s in range(S, x - 1, -1):
            can[s] = can[s] or can[s - x]
    return can[S]
```

</details>

## Grid of non-negative costs: walk from the top-left to the bottom-right moving only right or down; minimum total cost of the cells visited? E.g. [[1,3,1],[1,5,1],[4,2,1]] gives 7 (1→3→1→1→1). (Minimum Path Sum) {#dsadp-min-path-sum}
**Pattern:** grid DP: each cell's answer from the cell above and the cell to the left.
**Insight:** you can only arrive from above or from the left, so best[r][c] = grid[r][c] + min(best above, best left). Fill row by row; one row of memory is enough.
**Complexity:** O(R × C) time, O(C) space.
**Edge:** first row and first column have only one way in; a 1 × 1 grid → its own cost. Greedy "take the cheaper next step" fails.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def min_path_sum(g):
    C = len(g[0])
    row = [float('inf')] * C
    row[0] = 0
    for r in g:
        row[0] += r[0]
        for c in range(1, C):
            row[c] = r[c] + min(row[c], row[c - 1])
    return row[-1]
```

</details>
