import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCardFile, slugify } from '../js/parse.js';

test('parses front matter and two cards', () => {
  const t = `---\ntopic: HLD 08\ngroup: HLD\n---\n\n## Why `+'`hold_id`'+` a UUID? {#bms-hold-id}\n\n  Because.  \n\n## Second {#two}\nBack two\n`;
  const r = parseCardFile(t, 'hld-08.md');
  assert.equal(r.topic, 'HLD 08');
  assert.equal(r.group, 'HLD');
  assert.equal(r.cards.length, 2);
  assert.equal(r.cards[0].id, 'bms-hold-id');
  assert.equal(r.cards[0].front, 'Why `hold_id` a UUID?');
  assert.equal(r.cards[0].back, 'Because.');
  assert.equal(r.cards[0].file, 'hld-08.md');
  assert.equal(r.cards[1].back, 'Back two');
  assert.deepEqual(r.warnings, []);
});

test('defaults topic/group from filename', () => {
  const r = parseCardFile('## Q {#q}\nA\n', 'dsa-two-pointers.md');
  assert.equal(r.group, 'DSA');
  assert.equal(r.topic, 'dsa-two-pointers');
});

test('## inside code fence stays in back', () => {
  const r = parseCardFile('## Q {#q}\n```\n## not a card\n```\n', 'a-b.md');
  assert.equal(r.cards.length, 1);
  assert.ok(r.cards[0].back.includes('## not a card'));
});

test('slug id when no explicit id', () => {
  const r = parseCardFile('---\ntopic: HLD 08 · BookMyShow\n---\n## Why UUID?\nA\n', 'x.md');
  assert.equal(r.cards[0].id, 'hld-08-bookmyshow--why-uuid');
  assert.equal(slugify('  Hello, World! '), 'hello-world');
});

test('duplicate id warns and keeps first', () => {
  const r = parseCardFile('## A {#d}\none\n## B {#d}\ntwo\n', 'f.md');
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].back, 'one');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /f\.md: duplicate id d/);
});

test('empty back skipped with warning', () => {
  const r = parseCardFile('## A {#a}\n\n## B {#b}\nok\n', 'f.md');
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].id, 'b');
  assert.match(r.warnings[0], /f\.md: .*A.*empty back/);
});
