#!/usr/bin/env node
// Rebuilds docs/feed.xml from the church's sermon sheet + website.
// Usage: node build.js [--strict] [--offline]
//   --strict   fail if config still has placeholders (used by the weekly job)
//   --offline  use test-sheet.csv / test-sermons.html instead of the internet (for testing)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fromSheet, fromPage, merge } from './sources.js';
import { buildFeed } from './feed.js';
import { probe } from './mp3.js';

const args = new Set(process.argv.slice(2));
const readJson = async (p, fallback) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : fallback);
const today = new Date().toISOString().slice(0, 10);
const daysSince = (iso) => (Date.now() - Date.parse(iso)) / 864e5;

const cfg = await readJson('config.json');
const overrides = await readJson('overrides.json', {});
const cache = await readJson('data/audio.json', {});
const state = await readJson('data/state.json', {});

const unfilled = ['ownerEmail', 'image', 'feedUrl'].filter((k) => /CHANGE-ME/i.test(cfg[k]));
if (unfilled.length) {
  if (args.has('--strict')) { console.error(`Fill in config.json first: ${unfilled.join(', ')}`); process.exit(1); }
  console.warn(`Not ready to submit yet. Fill in config.json: ${unfilled.join(', ')}`);
}

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'ccos-podcast/1.0 (+church sermon feed)' } });
      if (r.ok) return await r.text();
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (i === 2) throw new Error(`Could not load ${url}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
    }
  }
}

const [csv, html] = args.has('--offline')
  ? [await readFile('test-sheet.csv', 'utf8'), await readFile('test-sermons.html', 'utf8')]
  : await Promise.all([get(cfg.sheetCsvUrl), get(cfg.sermonsPageUrl)]);

const sheet = fromSheet(csv);
const page = fromPage(html, new URL(cfg.audioBase).host);
if (sheet.length < 100 && !args.has('--offline')) throw new Error(`Sheet looks wrong: only ${sheet.length} rows`);
const all = merge(sheet, page, overrides);

// Look up size + length for files we haven't seen (or recheck recent misses).
const fileFor = (e) => (overrides.files?.[e.key]) || `${e.key}.mp3`;
const todo = all.filter((e) => {
  const c = cache[fileFor(e)];
  if (!c) return true;
  if (c.missing) return daysSince(c.checked) > (daysSince(e.date) < 60 ? 0.4 : 30);
  return false;
});
if (!args.has('--offline')) {
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < todo.length) {
      const e = todo[i++]; const f = fileFor(e);
      try {
        const p = await probe((cfg.probeBase || cfg.audioBase) + f);
        cache[f] = p.missing ? { missing: true, checked: today } : { size: p.size, seconds: p.seconds, checked: today };
      } catch (err) { console.warn(`skip ${f}: ${err.message}`); }
    }
  }));
}

// Slow release of the back catalog so the first month doesn't blow the storage's download allowance.
let fromYear = 0;
if (cfg.drip?.enabled) {
  const start = Date.parse(cfg.drip.start);
  const months = Math.max(0, Math.floor((Date.now() - start) / (30.44 * 864e5)));
  const years = cfg.drip.initialYears + months * cfg.drip.yearsPerMonth;
  fromYear = new Date().getUTCFullYear() - years + 1;
}

const ORDER = { sr: 0, am: 1, ampm: 2, pm: 3 };
const ready = [], missing = [], held = [];
for (const e of all) {
  const f = fileFor(e); const c = cache[f];
  if (!c || c.missing || !c.size) { missing.push(e); continue; }
  if (+e.date.slice(0, 4) < fromYear) { held.push(e); continue; }
  ready.push({ ...e, file: f, size: c.size, seconds: c.seconds });
}
const sortKey = (e) => `${e.date}${ORDER[e.slot] ?? 1}${String(e.plusMinutes || 0).padStart(2, '0')}`;
ready.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

// Safety: never publish a feed that suddenly lost episodes (site down, sheet unpublished...).
const shownBefore = state.episodes || 0;
if (ready.length < shownBefore * 0.9 && !args.has('--force')) {
  console.error(`Refusing to publish: ${ready.length} episodes vs ${shownBefore} last time. Run with --force if intended.`);
  process.exit(1);
}

const xml = buildFeed(ready, cfg);
await mkdir('docs', { recursive: true });
await mkdir('data', { recursive: true });
if (existsSync('cover.jpg')) await writeFile('docs/cover.jpg', await readFile('cover.jpg'));
await writeFile('docs/feed.xml', xml);
await writeFile('data/audio.json', JSON.stringify(Object.fromEntries(Object.entries(cache).sort()), null, 0).replace(/},"/g, '},\n"') + '\n');
await writeFile('data/state.json', JSON.stringify({ episodes: ready.length }, null, 2) + '\n');

const lines = [
  `${ready.length} episodes in feed` + (held.length ? `, ${held.length} older ones held back until the archive release reaches them (showing ${fromYear} onward)` : ''),
  `Sources: ${sheet.length} sheet rows, ${page.length} website entries`,
  `No audio file found for ${missing.length}:`,
  ...missing.sort((a, b) => b.date.localeCompare(a.date)).map((e) => `  ${e.date} ${e.slot.toUpperCase()}  ${e.key}.mp3  ${e.preacher} – ${e.title}`),
];
await writeFile('data/report.txt', lines.join('\n') + '\n');
console.log(lines.slice(0, 3).join('\n'));
