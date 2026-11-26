export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function parseFrontMatter(lines) {
  const meta = {};
  if (lines[0] === undefined || lines[0].trim() !== '---') return { meta, start: 0 };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return { meta, start: i + 1 };
    const m = /^(\w+)\s*:\s*(.*)$/.exec(lines[i]);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { meta: {}, start: 0 }; // unterminated: treat as no front matter
}

export function parseCardFile(text, fileName) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const { meta, start } = parseFrontMatter(lines);
  const base = fileName.replace(/\.md$/i, '');
  const topic = meta.topic || base;
  const group = meta.group || base.split('-')[0].toUpperCase();

  const raw = [];
  let cur = null;
  let inFence = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence && line.startsWith('## ')) {
      cur = { heading: line.slice(3).trim(), body: [] };
      raw.push(cur);
      continue;
    }
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    if (cur) cur.body.push(line);
  }

  const cards = [];
  const warnings = [];
  const seen = new Set();
  for (const { heading, body } of raw) {
    let front = heading;
    let id = null;
    const m = /^(.*?)\s*\{#([^}]+)\}\s*$/.exec(heading);
    if (m) { front = m[1]; id = m[2].trim(); }
    if (!id) id = (slugify(topic) + '--' + slugify(front)).slice(0, 80);
    const back = body.join('\n').trim();
    if (!back) { warnings.push(`${fileName}: card "${front}" skipped, empty back`); continue; }
    if (seen.has(id)) { warnings.push(`${fileName}: duplicate id ${id}`); continue; }
    seen.add(id);
    cards.push({ id, topic, group, front, back, file: fileName });
  }
  return { topic, group, cards, warnings };
}
