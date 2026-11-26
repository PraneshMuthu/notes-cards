// DOM wiring only: fetch the deck, run the feed, hand off to store/picker/scheduler.
import { parseCardFile } from './parse.js';
import { renderMarkdown } from './markdown.js';
import { createStore } from './store.js';
import { makeFsrs, replay } from './scheduler.js';
import { pickNext, counts } from './picker.js';
import { createEmptyCard } from '../vendor/ts-fsrs.mjs';

const $ = (id) => document.getElementById(id);
const UI_KEY = 'nc:v1:ui';
const fsrs = makeFsrs({ fuzz: true });
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

let cards = [];
let store, states;
let ui = { queue: 'all', offGroups: [], offTopics: [] };
const history = [];
const session = { endlessCount: 0 };
let pick = null;
let revealed = false;

function banner(id, text, dismissible) {
  let el = $(id);
  if (!text) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = id; el.className = 'banner'; $('banners').append(el); }
  el.textContent = text;
  if (dismissible) {
    const b = document.createElement('button');
    b.textContent = '✕'; b.setAttribute('aria-label', 'Dismiss');
    b.onclick = () => el.remove();
    el.append(b);
  }
}

function filter() {
  const f = { queue: ui.queue };
  if (ui.offGroups.length) f.groups = new Set(cards.map((c) => c.group).filter((g) => !ui.offGroups.includes(g)));
  if (ui.offTopics.length) f.topics = new Set(cards.map((c) => c.topic).filter((t) => !ui.offTopics.includes(t)));
  return f;
}

function updateCounts() {
  const c = counts(cards, states, store.reviews(), new Date(), store.settings().newPerDay);
  $('counts').textContent = `⏳ ${c.due} · ✗ ${c.forgot} · ✦ ${c.newLeft}`;
  banner('saveWarn', store.ok ? '' : "Progress isn't being saved on this browser — export a backup.");
}

function showNext() {
  pick = pickNext({
    cards, states, reviews: store.reviews(), history, now: new Date(), fsrs,
    filter: filter(), settings: store.settings(), session,
  });
  revealed = false;
  $('grades').hidden = true;
  $('stage').scrollTop = 0;
  const el = document.createElement('div');
  el.className = 'card';
  if (!pick) {
    $('chip').textContent = 'Notes Cards';
    el.innerHTML = '<div class="front"><p>No cards match this filter.</p></div>';
  } else {
    $('chip').textContent = pick.card.topic;
    el.innerHTML = '<div class="front"></div><div class="hint">tap to reveal</div>';
    el.firstChild.innerHTML = renderMarkdown(pick.card.front);
  }
  $('stage').replaceChildren(el);
  updateCounts();
}

function reveal() {
  if (!pick || revealed) return;
  revealed = true;
  const back = document.createElement('div');
  back.className = 'back';
  back.innerHTML = renderMarkdown(pick.card.back);
  const card = $('stage').firstChild;
  card.querySelector('.hint').replaceWith(back);
  $('grades').hidden = false;
}

function grade(g) {
  if (!pick || !revealed) return;
  revealed = false; // guards against double taps
  const { card, endless } = pick;
  const now = new Date();
  store.add({ c: card.id, g, t: now.getTime(), d: store.deviceId, ...(endless && { x: true }) });
  states.set(card.id, fsrs.next(states.get(card.id) ?? createEmptyCard(now), now, g).card);
  history.push({ id: card.id, at: now.getTime() });
  session.lastGroup = card.group;
  if (endless) session.endlessCount++;
  document.activeElement?.blur();
  showNext();
}

function saveUi() { safe(() => localStorage.setItem(UI_KEY, JSON.stringify(ui))); }
function loadUi() {
  const s = safe(() => JSON.parse(localStorage.getItem(UI_KEY)), null);
  if (!s || typeof s !== 'object') return;
  if (['all', 'due', 'forgot', 'new'].includes(s.queue)) ui.queue = s.queue;
  if (Array.isArray(s.offGroups)) ui.offGroups = s.offGroups.filter((x) => typeof x === 'string');
  if (Array.isArray(s.offTopics)) ui.offTopics = s.offTopics.filter((x) => typeof x === 'string');
}

function checkbox(label, checked, cls, onChange) {
  const l = document.createElement('label');
  if (cls) l.className = cls;
  const i = document.createElement('input');
  i.type = 'checkbox'; i.checked = checked; i.onchange = () => onChange(i.checked, i);
  l.append(i, document.createTextNode(label));
  return { l, i };
}

function buildMenu() {
  for (const r of document.querySelectorAll('input[name=queue]')) {
    r.checked = r.value === ui.queue;
    r.onchange = () => { ui.queue = r.value; saveUi(); showNext(); };
  }
  const tree = new Map();
  for (const c of cards) {
    if (!tree.has(c.group)) tree.set(c.group, new Set());
    tree.get(c.group).add(c.topic);
  }
  const toggle = (arr, v, on) => { const i = arr.indexOf(v); if (on && i >= 0) arr.splice(i, 1); if (!on && i < 0) arr.push(v); };
  $('topics').replaceChildren(...[...tree].sort().map(([group, topics]) => {
    const box = document.createElement('div');
    box.className = 'grp';
    const subs = [];
    const g = checkbox(group, !ui.offGroups.includes(group), '', (on) => {
      toggle(ui.offGroups, group, on);
      subs.forEach((s) => { s.disabled = !on; });
      saveUi(); showNext();
    });
    box.append(g.l);
    for (const t of [...topics].sort()) {
      const s = checkbox(t, !ui.offTopics.includes(t), 'sub', (on) => { toggle(ui.offTopics, t, on); saveUi(); showNext(); });
      s.i.disabled = ui.offGroups.includes(group);
      subs.push(s.i);
      box.append(s.l);
    }
    return box;
  }));
  const n = $('newPerDay');
  n.value = store.settings().newPerDay;
  n.onchange = () => {
    const v = Math.max(0, Math.min(200, Math.floor(Number(n.value)) || 0));
    n.value = v;
    store.saveSettings({ ...store.settings(), newPerDay: v });
    updateCounts();
  };
}

function wireMenu() {
  const open = (on) => { $('menu').hidden = !on; };
  $('menuBtn').onclick = () => open(true);
  $('menuClose').onclick = () => open(false);
  $('menu').onclick = (e) => { if (e.target === $('menu')) open(false); };
  const msg = (t) => { $('msg').textContent = t; };
  $('exportBtn').onclick = () => {
    const url = URL.createObjectURL(new Blob([store.exportJson()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `notes-cards-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    msg('Exported.');
  };
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { added } = store.importJson(await file.text());
      states = replay(store.reviews(), fsrs, new Set(cards.map((c) => c.id)));
      msg(`Imported ${added} new review${added === 1 ? '' : 's'}.`);
      showNext();
    } catch (err) { msg(err.message || 'Import failed.'); }
  };
}

async function loadDeck() {
  const files = await (await fetch('./cards/index.json')).json();
  const parsed = await Promise.all(files.map(async (f) => {
    try {
      const res = await fetch('./cards/' + encodeURIComponent(f));
      if (!res.ok) throw new Error(res.status);
      return parseCardFile(await res.text(), f);
    } catch (err) { console.warn(`Could not load cards/${f}`, err); return null; }
  }));
  const seen = new Set();
  for (const p of parsed.filter(Boolean)) {
    p.warnings.forEach((w) => console.warn(w));
    for (const c of p.cards) {
      if (seen.has(c.id)) { console.warn(`Duplicate card id ${c.id} in ${c.file}, ignored`); continue; }
      seen.add(c.id); cards.push(c);
    }
  }
}

document.addEventListener('keydown', (e) => {
  if (!$('menu').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('button, input, select, label, summary, a')) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); reveal(); }
  else if ('1234'.includes(e.key) && e.key) grade(Number(e.key));
});
$('stage').addEventListener('click', (e) => { if (!e.target.closest('summary, a')) reveal(); });
for (const b of document.querySelectorAll('#grades button')) b.onclick = () => grade(Number(b.dataset.g));

async function main() {
  store = createStore(safe(() => localStorage));
  if (store.recovered) banner('recovered', 'Your saved progress was damaged; a backup copy was kept in this browser.', true);
  loadUi();
  wireMenu();
  try { await loadDeck(); } catch (err) { console.warn('Could not load cards/index.json', err); }
  if (!cards.length) { banner('noDeck', 'Could not load any cards. Check your connection and reload.'); return; }
  states = replay(store.reviews(), fsrs, new Set(cards.map((c) => c.id)));
  buildMenu();
  showNext();
  if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('./sw.js').catch(() => {}); } catch { /* optional */ }
  }
}
main();
