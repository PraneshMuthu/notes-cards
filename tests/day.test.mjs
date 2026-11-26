import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey } from '../js/day.js';

test('dayKey rolls over at 04:00 local time', () => {
  assert.equal(dayKey(new Date(2026,10,26,3,59)), '2026-11-25');
  assert.equal(dayKey(new Date(2026,10,26,4,0)),  '2026-11-26');
  assert.equal(dayKey(new Date(2026,10,26,23,30)),'2026-11-26');
  assert.equal(dayKey(new Date(2026,11,1,2,0)),   '2026-11-30'); // month rollover
});
