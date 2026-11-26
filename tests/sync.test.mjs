import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { createSync, parseRepo } from '../js/sync.js';

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

// In-memory stand-in for the GitHub contents API of one private repo.
function fakeGitHub({ owner = 'me', repo = 'progress', token = 'tok' } = {}) {
  const files = new Map(); // path -> { text, sha }
  let n = 0;
  const calls = [];
  const gh = {
    files, calls,
    fetch: async (url, opts = {}) => {
      const method = opts.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (gh.offline) throw new TypeError('Failed to fetch');
      const reply = (status, body) => ({
        ok: status >= 200 && status < 300, status,
        json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      });
      if (opts.headers?.Authorization !== `Bearer ${token}`) return reply(401, {});
      const m = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)(?:\/contents\/(.*))?$/);
      if (!m || m[1] !== owner || m[2] !== repo) return reply(404, {});
      const path = m[3];
      if (path === undefined) return reply(200, { full_name: `${owner}/${repo}` }); // the repo itself
      if (method === 'GET') {
        if (path === '') return reply(404, { message: 'This repository is empty.' }); // like a repo with no commits
        if (files.has(path)) {
          const f = files.get(path);
          return opts.headers.Accept.includes('raw') ? reply(200, f.text) : reply(200, { path, sha: f.sha });
        }
        const inDir = [...files].filter(([p]) => p.startsWith(path + '/'));
        if (!inDir.length) return reply(404, {});
        return reply(200, inDir.map(([p, f]) => ({ type: 'file', name: p.split('/').pop(), path: p, sha: f.sha })));
      }
      if (method === 'PUT') {
        const body = JSON.parse(opts.body);
        const cur = files.get(path);
        if (cur && body.sha !== cur.sha) return reply(409, {});
        if (!cur && body.sha) return reply(422, {});
        const sha = `sha${++n}`;
        files.set(path, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha });
        return reply(cur ? 200 : 201, { content: { path, sha } });
      }
      return reply(405, {});
    },
  };
  return gh;
}

function device(gh, { repo = 'me/progress', token = 'tok' } = {}) {
  const storage = fakeStorage();
  const store = createStore(storage);
  let conf = { repo, token };
  const sync = createSync({ fetch: gh.fetch, store, load: () => conf, save: (c) => { conf = c; } });
  return { store, sync, conf: () => conf, set: (c) => { conf = c; } };
}

const rv = (dev, c, t) => ({ c, g: 3, t, d: dev.store.deviceId });

test('parseRepo accepts owner/repo and github URLs, rejects junk', () => {
  assert.deepEqual(parseRepo('PraneshMuthu/notes-cards-progress'), { owner: 'PraneshMuthu', repo: 'notes-cards-progress' });
  assert.deepEqual(parseRepo(' https://github.com/a-b/c.d.git/ '), { owner: 'a-b', repo: 'c.d' });
  assert.equal(parseRepo('just-a-name'), null);
  assert.equal(parseRepo('a/b/c'), null);
  assert.equal(parseRepo(''), null);
});

test('not configured: no network calls', async () => {
  const gh = fakeGitHub();
  const d = device(gh, { token: '' });
  assert.equal(d.sync.configured(), false);
  assert.deepEqual(await d.sync.sync(), { skipped: true, added: 0, pushed: false });
  assert.equal(gh.calls.length, 0);
});

test('first sync into an empty repo writes this device\'s file', async () => {
  const gh = fakeGitHub();
  const a = device(gh);
  a.store.add(rv(a, 'x', 1000));
  const r = await a.sync.sync();
  assert.deepEqual(r, { added: 0, pushed: true });
  const f = gh.files.get(`logs/${a.store.deviceId}.json`);
  assert.equal(JSON.parse(f.text).reviews.length, 1);
  assert.ok(a.conf().lastSyncAt);
});

test('two devices end up with the union, and each writes only its own file', async () => {
  const gh = fakeGitHub();
  const a = device(gh), b = device(gh);
  a.store.add(rv(a, 'x', 1000));
  b.store.add(rv(b, 'y', 2000));
  await a.sync.sync();
  assert.deepEqual(await b.sync.sync(), { added: 1, pushed: true });
  assert.equal(b.store.reviews().length, 2);
  assert.deepEqual(await a.sync.sync(), { added: 1, pushed: true });
  assert.deepEqual(a.store.reviews().map((r) => r.c), ['x', 'y']);
  assert.equal(gh.files.size, 2);
});

test('nothing changed: one listing call, no downloads, no write', async () => {
  const gh = fakeGitHub();
  const a = device(gh), b = device(gh);
  a.store.add(rv(a, 'x', 1000));
  await a.sync.sync(); await b.sync.sync(); await a.sync.sync();
  gh.calls.length = 0;
  assert.deepEqual(await a.sync.sync(), { added: 0, pushed: false });
  assert.deepEqual(gh.calls, ['GET https://api.github.com/repos/me/progress/contents/logs']);
});

test('a new local review is pushed on the next sync', async () => {
  const gh = fakeGitHub();
  const a = device(gh);
  await a.sync.sync();
  a.store.add(rv(a, 'x', 1000));
  assert.equal((await a.sync.sync()).pushed, true);
  assert.equal(JSON.parse(gh.files.get(`logs/${a.store.deviceId}.json`).text).reviews.length, 1);
});

test('stale sha (another tab wrote our file): merge theirs, retry, keep both', async () => {
  const gh = fakeGitHub();
  const a = device(gh);
  a.store.add(rv(a, 'x', 1000));
  await a.sync.sync();
  const path = `logs/${a.store.deviceId}.json`;
  const cached = gh.files.get(path).sha;
  // Another tab on this device pushed a review we don't have yet.
  gh.files.set(path, { text: JSON.stringify({ reviews: [rv(a, 'x', 1000), rv(a, 'z', 3000)] }), sha: 'shaOther' });
  a.store.add(rv(a, 'y', 2000));
  // The listing still shows the old sha (it raced the other tab), so we skip the download and PUT a stale sha.
  const real = gh.fetch;
  let once = true;
  const fetch = async (url, opts) => {
    if (once && url.endsWith('/contents/logs')) {
      once = false;
      return { ok: true, status: 200, json: async () => [{ type: 'file', name: path.slice(5), path, sha: cached }] };
    }
    return real(url, opts);
  };
  const s = createSync({ fetch, store: a.store, load: a.conf, save: a.set });
  assert.equal((await s.sync()).pushed, true);
  assert.deepEqual(JSON.parse(gh.files.get(path).text).reviews.map((r) => r.c), ['x', 'y', 'z']);
  assert.deepEqual(a.store.reviews().map((r) => r.c), ['x', 'y', 'z']);
});

test('bad token → auth error; unknown repo → repo error; offline → net error', async () => {
  const gh = fakeGitHub();
  await assert.rejects(device(gh, { token: 'wrong' }).sync.sync(), (e) => e.kind === 'auth');
  await assert.rejects(device(gh, { repo: 'me/nope' }).sync.sync(), (e) => e.kind === 'repo');
  gh.offline = true;
  await assert.rejects(device(gh).sync.sync(), (e) => e.kind === 'net');
});

test('a damaged device file is skipped, the rest still syncs', async () => {
  const gh = fakeGitHub();
  gh.files.set('logs/broken.json', { text: '{not json', sha: 'b1' });
  const a = device(gh), b = device(gh);
  b.store.add(rv(b, 'y', 2000));
  await b.sync.sync();
  assert.equal((await a.sync.sync()).added, 1);
});

test('mergeIn skips invalid entries and duplicates', () => {
  const s = createStore(fakeStorage());
  const good = { c: 'a', g: 3, t: 5, d: 'p' };
  assert.equal(s.mergeIn([good, good, { c: 1 }, null]), 1);
  assert.equal(s.mergeIn([good]), 0);
  assert.equal(s.mergeIn('nope'), 0);
});
