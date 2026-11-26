import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../js/markdown.js';

test('escapes html', () => {
  const out = renderMarkdown('<script>x</script>');
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(!out.includes('<script>'));
});
test('escapes quotes and ampersands', () => {
  assert.ok(renderMarkdown(`a & "b" 'c'`).includes('a &amp; &quot;b&quot; &#39;c&#39;'));
});
test('bold, italic, inline code', () => {
  assert.equal(renderMarkdown('**b**'), '<p><strong>b</strong></p>');
  assert.equal(renderMarkdown('*i*'), '<p><em>i</em></p>');
  assert.equal(renderMarkdown('`c`'), '<p><code>c</code></p>');
});
test('no formatting inside inline code', () => {
  assert.equal(renderMarkdown('`**x** *y*`'), '<p><code>**x** *y*</code></p>');
});
test('single newlines become br', () => {
  assert.equal(renderMarkdown('A.\n**Why:** r.\n**Example:** e.'),
    '<p>A.<br><strong>Why:</strong> r.<br><strong>Example:</strong> e.</p>');
});
test('code fence escapes and skips inline formatting', () => {
  const out = renderMarkdown('```python\nif a < b: **x**\n## not heading\n```');
  assert.equal(out, '<pre><code>if a &lt; b: **x**\n## not heading</code></pre>');
});
test('list of 2 items', () => {
  assert.equal(renderMarkdown('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(renderMarkdown('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
});
test('pipe table', () => {
  const out = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
  assert.equal(out, '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>');
});
test('details passthrough', () => {
  const out = renderMarkdown('<details>\n<summary>Code</summary>\n\n**hi**\n\n</details>');
  assert.equal(out, '<details><summary>Code</summary><p><strong>hi</strong></p></details>');
});
test('summary text is escaped; other html is not passed through', () => {
  const out = renderMarkdown('<summary><b>x</b></summary>\n<div onclick=1>');
  assert.ok(out.includes('<summary>&lt;b&gt;x&lt;/b&gt;</summary>'));
  assert.ok(!out.includes('<div'));
});
test('empty input', () => assert.equal(renderMarkdown(''), ''));
