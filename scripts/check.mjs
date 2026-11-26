// Validates cards/ before pushing: node scripts/check.mjs [dir]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCardFile } from '../js/parse.js';

export function checkDeck(dir) {
  const errors = [];
  const warnings = [];
  let cards = 0;
  let list = [];
  try {
    list = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
    if (!Array.isArray(list) || !list.every((f) => typeof f === 'string')) throw new Error('not an array of strings');
  } catch (e) {
    errors.push(`index.json: ${e.message}`);
    list = [];
  }
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.md') && !list.includes(f)) errors.push(`${f}: not listed in index.json`);
  }
  const owner = new Map();
  for (const f of list) {
    if (!existsSync(join(dir, f))) { errors.push(`${f}: listed in index.json but missing`); continue; }
    const parsed = parseCardFile(readFileSync(join(dir, f), 'utf8'), f);
    warnings.push(...parsed.warnings);
    if (!parsed.cards.length) errors.push(`${f}: has 0 cards`);
    for (const c of parsed.cards) {
      cards++;
      if (owner.has(c.id)) errors.push(`${f}: duplicate id "${c.id}" (also in ${owner.get(c.id)})`);
      else owner.set(c.id, f);
      if (c.back.length > 700) warnings.push(`${f}: "${c.front}" back is ${c.back.length} chars (over 700)`);
    }
  }
  return { cards, errors, warnings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || fileURLToPath(new URL('../cards', import.meta.url));
  const r = checkDeck(dir);
  r.warnings.forEach((w) => console.log(`warning: ${w}`));
  r.errors.forEach((e) => console.log(`error: ${e}`));
  console.log(`${r.cards} cards, ${r.errors.length} errors, ${r.warnings.length} warnings`);
  process.exit(r.errors.length ? 1 : 0);
}
