---
topic: DSA · Trees
group: DSA
---

## Binary tree: how many nodes are on its longest root-to-leaf path? E.g. [3,9,20,null,null,15,7] gives 3. (Maximum Depth of Binary Tree) {#dsatr-max-depth}
**Pattern:** recursive DFS (depth-first search: finish a whole subtree before the next).
**Insight:** a node's depth = 1 + the deeper of its two subtrees; an empty tree has depth 0. Each node asks its children and combines.
**Complexity:** O(n) time, O(h) space (h = height, the recursion stack).
**Edge:** empty tree → 0; a fully skewed tree makes h = n (deep recursion).
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def max_depth(root):
    if not root: return 0
    return 1 + max(max_depth(root.left), max_depth(root.right))
```

</details>

## Binary tree: turn it into its mirror image, with left and right swapped at every node. E.g. [4,2,7,1,3,6,9] gives [4,7,2,9,6,3,1]. (Invert Binary Tree) {#dsatr-invert-tree}
**Pattern:** recursive DFS.
**Insight:** at every node, swap its two children; the subtrees get mirrored by the same rule. Whether you swap before or after recursing does not matter, as long as every node is visited once.
**Complexity:** O(n) time, O(h) space.
**Edge:** empty tree → None; a single node is its own mirror.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def invert(root):
    if root:
        root.left, root.right = invert(root.right), invert(root.left)
    return root
```

</details>

## Binary tree: return node values grouped by depth, left to right within each depth. E.g. [3,9,20,null,null,15,7] gives [[3],[9,20],[15,7]]. (Binary Tree Level Order Traversal) {#dsatr-level-order}
**Pattern:** BFS (breadth-first search: visit nearer nodes first) with a queue, one level per round.
**Insight:** at the start of each round, the queue holds exactly one level. Pop len(queue) nodes, collect their values, and enqueue their children for the next round.
**Complexity:** O(n) time, O(w) space (w = widest level, up to about n/2).
**Edge:** empty tree → [] (do not enqueue None).
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
from collections import deque
def level_order(root):
    res, q = [], deque([root] if root else [])
    while q:
        level = []
        for _ in range(len(q)):
            n = q.popleft(); level.append(n.val)
            if n.left: q.append(n.left)
            if n.right: q.append(n.right)
        res.append(level)
    return res
```

</details>

## Binary tree: is every value in each node's left subtree smaller than it, and every value in its right subtree larger, at all depths? E.g. [5,4,6,null,null,3,7] gives false. (Validate Binary Search Tree) {#dsatr-validate-bst}
**Pattern:** DFS carrying an allowed (low, high) range down the tree.
**Insight:** comparing each node only with its parent is wrong: 3 is a fine left child of 6 but sits in 5's right subtree, so it must exceed 5. Pass the open range down and tighten it at each child.
**Complexity:** O(n) time, O(h) space. (An in-order walk that must be strictly increasing also works.)
**Edge:** equal values are invalid with strict < ; empty tree → true.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def is_valid_bst(root, lo=float('-inf'), hi=float('inf')):
    if not root: return True
    if not (lo < root.val < hi): return False
    return (is_valid_bst(root.left, lo, root.val) and
            is_valid_bst(root.right, root.val, hi))
```

</details>

## Binary tree: the length, in edges, of the longest path between any two nodes. E.g. [1,2,3,4,5] gives 3 (4→2→1→3). (Diameter of Binary Tree) {#dsatr-diameter}
**Pattern:** DFS that returns height while updating a global best.
**Insight:** the longest path that bends at a node = left height + right height. The best path need not pass through the root, so check this at every node while returning 1 + max(left, right) upward.
**Complexity:** O(n) time, O(h) space.
**Edge:** single node → 0; a tall left subtree can hold the whole diameter without touching the root.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def diameter(root):
    best = 0
    def height(n):
        nonlocal best
        if not n: return 0
        l, r = height(n.left), height(n.right)
        best = max(best, l + r)
        return 1 + max(l, r)
    height(root)
    return best
```

</details>

## Binary tree (not a search tree) and two of its nodes p and q: the deepest node that has both below it (a node counts as below itself). E.g. in [3,5,1,6,2,0,8], p=5, q=1 gives 3. (Lowest Common Ancestor of a Binary Tree) {#dsatr-lca}
**Pattern:** post-order DFS (children first, then decide at the node).
**Insight:** return the node if it is p or q, else what the children found. If both left and right return something, p and q split here, so this node is the answer; otherwise pass up the non-empty side.
**Complexity:** O(n) time, O(h) space.
**Edge:** p is an ancestor of q → p, because the search stops at p and returns it.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def lca(root, p, q):
    if not root or root is p or root is q: return root
    L, R = lca(root.left, p, q), lca(root.right, p, q)
    return root if L and R else (L or R)
```

</details>

## Binary tree: the values you see standing on its right side, top to bottom. E.g. [1,2,3,null,5,null,4] gives [1,3,4]. (Binary Tree Right Side View) {#dsatr-right-side-view}
**Pattern:** level-order BFS, keeping the last node of each level.
**Insight:** the visible node at each depth is that level's rightmost node, which is not always on the right branch. Same loop as level order, but record only the last value per level.
**Complexity:** O(n) time, O(w) space (w = widest level).
**Edge:** a longer left branch shows through: [1,2,3,4] gives [1,3,4], where 4 is a left-side node.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
from collections import deque
def right_side_view(root):
    res, q = [], deque([root] if root else [])
    while q:
        res.append(q[-1].val)
        for _ in range(len(q)):
            n = q.popleft()
            if n.left: q.append(n.left)
            if n.right: q.append(n.right)
    return res
```

</details>

## Binary search tree (left < node < right) and k: return the kth smallest value. E.g. [3,1,4,null,2], k=1 gives 1. (Kth Smallest Element in a BST) {#dsatr-kth-smallest-bst}
**Pattern:** in-order traversal (left, node, right), stopped early.
**Insight:** in-order visits a search tree's values in sorted order, so the kth node visited is the answer. Use an explicit stack and stop at k instead of collecting all n values.
**Complexity:** O(h + k) time, O(h) space.
**Edge:** k = 1 → the leftmost node; if asked repeatedly on a changing tree, store subtree sizes per node.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def kth_smallest(root, k):
    st, n = [], root
    while st or n:
        while n: st.append(n); n = n.left
        n = st.pop(); k -= 1
        if k == 0: return n.val
        n = n.right
```

</details>

## Design a word store with insert(word), search(word) for an exact match and starts_with(prefix), each in O(length of the input). E.g. insert "apple": search "app" → false, starts_with "app" → true. {#dsatr-trie}
**Pattern:** trie (prefix tree): each node maps a character to a child node, plus an end-of-word flag.
**Insight:** words sharing a prefix share the same path, so walking the input one character at a time answers both questions. Exact search additionally needs the end flag at the last node.
**Complexity:** O(L) per operation (L = input length), O(total characters) space. A set of words cannot do starts_with without scanning all words.
**Edge:** "app" inserted after "apple" just sets the flag on an existing node.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
class Trie:
    def __init__(self): self.root = {}
    def insert(self, w):
        n = self.root
        for c in w: n = n.setdefault(c, {})
        n['$'] = True                  # end-of-word flag
    def _walk(self, s):
        n = self.root
        for c in s:
            if c not in n: return None
            n = n[c]
        return n
    def search(self, w):
        n = self._walk(w); return n is not None and '$' in n
    def starts_with(self, p): return self._walk(p) is not None
```

</details>
