// Sync between devices through a private GitHub repo. No DOM.
// Each device writes only its own file, logs/<deviceId>.json, holding its whole (union) review log.
// Syncing = read every file that changed since last time, union it in, then write our file if it grew.
// The log only ever grows and entries are keyed by (card, time, device), so devices never conflict.
const API = 'https://api.github.com';
export const SYNC_KEY = 'nc:v1:sync';

/** "owner/repo" or a github.com URL → { owner, repo }, else null. */
export function parseRepo(s) {
  const m = String(s ?? '').trim()
    .replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '').replace(/\.git$/i, '')
    .match(/^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export class SyncError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; } // kind: auth | repo | net | conflict | other
}

const b64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * @param fetch     fetch implementation
 * @param store     the progress store (reviews(), mergeIn(), deviceId)
 * @param load/save read and write the sync config object
 *                  { repo, token, shas: {path: sha}, pushedCount, lastSyncAt }
 */
export function createSync({ fetch, store, load, save }) {
  const cfg = () => {
    const c = load();
    return c && typeof c === 'object' ? c : {};
  };

  async function api(c, path, { method = 'GET', body, raw = false, keepalive = false } = {}) {
    const { owner, repo } = parseRepo(c.repo);
    let res;
    try {
      res = await fetch(`${API}/repos/${owner}/${repo}/contents/${path}`, {
        method,
        cache: 'no-store', // GitHub sends max-age=60; a stale listing would hide the other device's writes
        keepalive,
        headers: {
          Authorization: `Bearer ${c.token}`,
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body && { 'Content-Type': 'application/json' }),
        },
        ...(body && { body: JSON.stringify(body) }),
      });
    } catch {
      throw new SyncError('net', 'Offline — will sync when you are back online.');
    }
    if (res.status === 401) throw new SyncError('auth', 'GitHub rejected the token (expired or revoked?).');
    if (res.status === 403) throw new SyncError('auth', "The token isn't allowed to write this repo (needs Contents: read and write).");
    return res;
  }

  /** Our file, logs/<deviceId>.json: create or replace it with the whole log. */
  async function push(c, path, sha, keepalive) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const reviews = store.reviews(); // rebuilt each attempt: a retry first merges the other tab's entries
      const text = JSON.stringify({ app: 'notes-cards', version: 1, device: store.deviceId, reviews });
      const res = await api(c, path, {
        method: 'PUT',
        keepalive: keepalive && text.length < 45000, // browsers cap keepalive bodies at 64 KB
        body: { message: `sync ${store.deviceId.slice(0, 8)}: ${reviews.length} reviews`, content: b64(text), ...(sha && { sha }) },
      });
      if (res.ok) {
        const out = await res.json();
        return { sha: out.content.sha, count: reviews.length };
      }
      // 409/422: our sha is stale (another tab on this device wrote first). Fetch the current one, retry once.
      if ((res.status === 409 || res.status === 422) && attempt === 0) {
        const cur = await api(c, path);
        sha = cur.ok ? (await cur.json()).sha : undefined;
        if (cur.ok) {
          const theirs = await api(c, path, { raw: true });
          if (theirs.ok) store.mergeIn(JSON.parse(await theirs.text())?.reviews);
        }
        continue;
      }
      if (res.status === 404) throw new SyncError('repo', "Repo not found, or the token can't see it.");
      throw new SyncError('other', `GitHub error ${res.status} while saving.`);
    }
    throw new SyncError('conflict', 'Another tab was syncing at the same time; will retry.');
  }

  return {
    configured() { const c = cfg(); return !!(c.token && parseRepo(c.repo)); },
    lastSyncAt() { return cfg().lastSyncAt ?? null; },

    /** Pull changed device files, merge, push ours if it grew. Returns { added, pushed }. */
    async sync({ keepalive = false } = {}) {
      const c = cfg();
      if (!c.token || !parseRepo(c.repo)) return { skipped: true, added: 0, pushed: false };
      const shas = { ...(c.shas ?? {}) };
      const own = `logs/${store.deviceId}.json`;

      const listRes = await api(c, 'logs');
      let files = [];
      if (listRes.ok) files = (await listRes.json()).filter((f) => f.type === 'file' && f.name.endsWith('.json'));
      else if (listRes.status === 404) {
        // No logs/ yet (first sync), or no repo: tell them apart by asking for the repo root.
        const root = await api(c, '');
        if (root.status === 404) throw new SyncError('repo', "Repo not found, or the token can't see it.");
      } else throw new SyncError('other', `GitHub error ${listRes.status} while listing.`);

      let added = 0;
      for (const f of files) {
        if (shas[f.path] === f.sha) continue; // unchanged since we last read (or wrote) it
        const res = await api(c, f.path, { raw: true });
        if (!res.ok) continue;
        let data = null;
        try { data = JSON.parse(await res.text()); } catch { /* skip a damaged file */ }
        added += store.mergeIn(data?.reviews);
        shas[f.path] = f.sha;
      }

      const ownFile = files.find((f) => f.path === own);
      let pushed = false;
      if (!ownFile || store.reviews().length !== c.pushedCount || shas[own] !== ownFile.sha) {
        const r = await push(c, own, ownFile?.sha, keepalive);
        shas[own] = r.sha;
        c.pushedCount = r.count;
        pushed = true;
      }
      save({ ...cfg(), shas, pushedCount: c.pushedCount, lastSyncAt: Date.now() });
      return { added, pushed };
    },
  };
}
