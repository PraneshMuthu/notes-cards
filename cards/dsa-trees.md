---
topic: DSA · Trees
group: DSA
---

## Maximum Depth of Binary Tree: the number of nodes on the longest root-to-leaf path. E.g. [3,9,20,null,null,15,7] gives 3. {#dsatr-max-depth}
**Pattern:** recursive DFS.
**Insight:** depth of a node = 1 + max(depth of left, depth of right); an empty tree has depth 0.
**Complexity:** O(n) time, O(h) space (h = height, recursion stack).

<details>
<summary>Code</summary>

```python
def max_depth(root):
    if not root: return 0
    return 1 + max(max_depth(root.left), max_depth(root.right))
```

</details>

## Invert Binary Tree: mirror a binary tree by swapping left and right children everywhere. E.g. [4,2,7,1,3,6,9] gives [4,7,2,9,6,3,1]. {#dsatr-invert-tree}
**Pattern:** recursive DFS.
**Insight:** at each node swap its two children, after inverting each subtree (or before; the order does not matter).
**Complexity:** O(n) time, O(h) space.

<details>
<summary>Code</summary>

```python
def invert(root):
    if root:
        root.left, root.right = invert(root.right), invert(root.left)
    return root
```

</details>

## Level Order Traversal: return node values level by level, left to right. E.g. [3,9,20,null,null,15,7] gives [[3],[9,20],[15,7]]. {#dsatr-level-order}
**Pattern:** BFS with a queue, one level per loop.
**Insight:** at the start of each round, the queue holds exactly one level. Take `len(queue)` nodes, collecting values and enqueueing children.
**Complexity:** O(n) time, O(w) space (w = max width, up to n/2).

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

## Validate Binary Search Tree: is the tree a valid BST (every left-subtree value smaller, every right-subtree value larger, at all depths)? E.g. [5,1,4,null,null,3,6] gives false. {#dsatr-validate-bst}
**Pattern:** DFS carrying (low, high) bounds.
**Insight:** comparing only to the parent is wrong (3 sits under 4 but must still exceed 5). Pass down the allowed open interval and tighten it at each child.
**Complexity:** O(n) time, O(h) space.

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

## Diameter of Binary Tree: length (in edges) of the longest path between any two nodes. E.g. [1,2,3,4,5] gives 3. {#dsatr-diameter}
**Pattern:** DFS returning height while updating a global best.
**Insight:** the longest path through a node is left height + right height. The path need not pass through the root, so check every node.
**Complexity:** O(n) time, O(h) space.

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

## Lowest Common Ancestor of a Binary Tree: find the deepest node that has both given nodes p and q as descendants (a node counts as its own descendant). E.g. in [3,5,1,6,2,0,8], p=5, q=1 gives 3. {#dsatr-lca}
**Pattern:** post-order DFS.
**Insight:** return the node if it is p or q. If both left and right recursions return non-null, the current node is the split point and the LCA; otherwise pass up whichever side is non-null.
**Complexity:** O(n) time, O(h) space.

<details>
<summary>Code</summary>

```python
def lca(root, p, q):
    if not root or root is p or root is q: return root
    L, R = lca(root.left, p, q), lca(root.right, p, q)
    return root if L and R else (L or R)
```

</details>
