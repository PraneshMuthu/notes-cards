import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFsrs, replay, queueOf } from '../js/scheduler.js';
import { createStore } from '../js/store.js';

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const T0 = Date.parse('2026-11-26T10:00:00Z');
const MIN = 60000;
const ids = new Set(['a', 'b']);
const rv = (c, g, t) => ({ c, g, t, d: 'dev' });

test('replay Good then Again → relearning due +10m', () => {
  const f = makeFsrs({ fuzz: false });
  const t2 = T0 + 10 * MIN;
  const m = replay([rv('a', 3, T0), rv('a', 3, t2), rv('a', 1, t2 + 2 * 86400000)], f, ids);
  const c = m.get('a');
  assert.equal(c.state, 3);
  assert.equal(c.due.getTime(), t2 + 2 * 86400000 + 10 * MIN);
});

test('relearning Good → review due +1d', () => {
  const f = makeFsrs({ fuzz: false });
  const t3 = T0 + 10 * MIN + 2 * 86400000;
  const m = replay([rv('a', 3, T0), rv('a', 3, T0 + 10 * MIN), rv('a', 1, t3), rv('a', 3, t3 + 10 * MIN)], f, ids);
  const c = m.get('a');
  assert.equal(c.state, 2);
  assert.equal(c.due.getTime(), t3 + 10 * MIN + 86400000);
});

test('replay ignores unknown card ids', () => {
  const m = replay([rv('zzz', 3, T0), rv('a', 3, T0)], makeFsrs({ fuzz: false }), ids);
  assert.deepEqual([...m.keys()], ['a']);
});

test('queueOf undefined is new; due review is due; future review is later', () => {
  const f = makeFsrs({ fuzz: false });
  assert.equal(queueOf(undefined, new Date(T0)), 'new');
  const m = replay([rv('a', 3, T0), rv('a', 3, T0 + 10 * MIN)], f, ids);
  const c = m.get('a');
  assert.equal(queueOf(c, new Date(c.due.getTime() + 1)), 'due');
  assert.equal(queueOf(c, new Date(T0 + 11 * MIN)), 'later');
  const l = replay([rv('b', 3, T0)], f, ids).get('b');
  assert.equal(queueOf(l, new Date(T0)), 'learning');
});

test('store survives throwing storage', () => {
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  const s = createStore(bad);
  assert.equal(s.ok, false);
  s.add(rv('a', 3, T0));
  assert.equal(s.reviews().length, 1);
  assert.equal(createStore(null).ok, false);
});

test('store persists across instances', () => {
  const st = fakeStorage();
  const a = createStore(st);
  assert.equal(a.ok, true);
  a.add(rv('a', 3, T0));
  const b = createStore(st);
  assert.equal(b.reviews().length, 1);
  assert.equal(b.deviceId, a.deviceId);
  assert.deepEqual(b.settings(), { newPerDay: 10 });
  b.saveSettings({ newPerDay: 5 });
  assert.equal(createStore(st).settings().newPerDay, 5);
});

test('import rejects garbage, log unchanged', () => {
  const s = createStore(fakeStorage());
  s.add(rv('a', 3, T0));
  assert.throws(() => s.importJson('{"x":1}'), /Not a notes-cards export/);
  assert.throws(() => s.importJson('not json'), /Not a notes-cards export/);
  assert.throws(() => s.importJson('{"app":"notes-cards","version":1,"reviews":[{"c":1}]}'), /Not a notes-cards export/);
  assert.equal(s.reviews().length, 1);
});

test('import is idempotent', () => {
  const a = createStore(fakeStorage());
  a.add(rv('a', 3, T0));
  a.add(rv('b', 2, T0 + 1));
  const json = a.exportJson();
  const b = createStore(fakeStorage());
  assert.equal(b.importJson(json).added, 2);
  assert.equal(b.importJson(json).added, 0);
  assert.equal(b.reviews().length, 2);
});
