import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDeck } from '../scripts/check.mjs';

const card = (id, back = 'An answer.') => `## Q ${id}? {#${id}}\n${back}\n`;
function deck(files, list = Object.keys(files)) {
  const dir = mkdtempSync(join(tmpdir(), 'nc-'));
  for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t);
  writeFileSync(join(dir, 'index.json'), JSON.stringify(list));
  return dir;
}

test('clean deck has no errors', () => {
  const r = checkDeck(deck({ 'a.md': card('a1') + card('a2'), 'b.md': card('b1') }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.cards, 3);
});

test('unlisted .md file is an error', () => {
  const r = checkDeck(deck({ 'a.md': card('a1'), 'b.md': card('b1') }, ['a.md']));
  assert.ok(r.errors.some((e) => e.includes('b.md')));
});

test('listed file that is missing is an error', () => {
  const r = checkDeck(deck({ 'a.md': card('a1') }, ['a.md', 'gone.md']));
  assert.ok(r.errors.some((e) => e.includes('gone.md')));
});

test('duplicate id across files is an error', () => {
  const r = checkDeck(deck({ 'a.md': card('same'), 'b.md': card('same') }));
  assert.ok(r.errors.some((e) => e.includes('same')));
});

test('file with 0 cards is an error', () => {
  const r = checkDeck(deck({ 'a.md': card('a1'), 'b.md': 'no cards here\n' }));
  assert.ok(r.errors.some((e) => e.includes('b.md')));
});

test('back over 700 chars is a warning, not an error', () => {
  const r = checkDeck(deck({ 'a.md': card('a1', 'x'.repeat(701)) }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
});
