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

const seeded = (log) => { const st = fakeStorage(); st.setItem('nc:v1:log', log); return st; };
const backupKeys = (st) => [...st._m.keys()].filter((k) => k.startsWith('nc:v1:log:corrupt-'));
const spyStorage = (initial = {}) => {
  const m = new Map(Object.entries(initial));
  return { _m: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('corrupt log is backed up before being replaced', () => {
  const st = spyStorage({ 'nc:v1:log': '{bad' });
  const s = createStore(st);
  assert.equal(s.recovered, true);
  assert.equal(s.ok, true);
  s.add(rv('a', 3, T0));
  const keys = backupKeys(st);
  assert.equal(keys.length, 1);
  assert.equal(st._m.get(keys[0]), '{bad');
  assert.equal(s.reviews().length, 1);
});

test('mixed valid/invalid entries: keep valid, back up raw, replay does not throw', () => {
  const raw = JSON.stringify([rv('a', 3, T0), null, { g: 3 }, rv('b', 9, T0)]);
  const st = spyStorage({ 'nc:v1:log': raw });
  const s = createStore(st);
  assert.equal(s.recovered, true);
  assert.equal(s.reviews().length, 1);
  assert.equal(st._m.get(backupKeys(st)[0]), raw);
  assert.doesNotThrow(() => replay(s.reviews(), makeFsrs({ fuzz: false }), ids));
});

test('getItem throws but setItem works: never writes the LOG key', () => {
  const writes = [];
  const st = { getItem() { throw new Error('x'); }, setItem: (k, v) => writes.push(k) };
  const s = createStore(st);
  assert.equal(s.ok, false);
  s.add(rv('a', 3, T0));
  assert.equal(s.reviews().length, 1);
  assert.ok(!writes.includes('nc:v1:log'));
});

test('backup write failure blocks LOG writes', () => {
  const writes = [];
  const st = { getItem: (k) => (k === 'nc:v1:log' ? '{bad' : null), setItem(k) { if (k.includes('corrupt')) throw new Error('q'); writes.push(k); } };
  const s = createStore(st);
  assert.equal(s.ok, false);
  s.add(rv('a', 3, T0));
  assert.ok(!writes.includes('nc:v1:log'));
});

test('settings stored as string or array fall back to defaults; add validates', () => {
  for (const v of ['"hi"', '[1,2]']) {
    const st = spyStorage({ 'nc:v1:settings': v });
    assert.deepEqual(createStore(st).settings(), { newPerDay: 10 });
  }
  assert.throws(() => createStore(null).add({ c: 'a' }), /Invalid review/);
});
