// Run: node test/test.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromSheet, fromPage, merge } from './sources.js';
import { rfc2822Eastern, episodeTitle } from './feed.js';
import { mp3Duration, id3Size } from './mp3.js';

const root = dirname(fileURLToPath(import.meta.url));
const fx = (f) => readFileSync(join(root, `test-${f}`), 'utf8');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('sheet rows -> file names, slots, speaker cleanup', () => {
  const s = fromSheet(fx('sheet.csv'));
  const by = Object.fromEntries(s.map((e) => [e.key, e]));
  assert.equal(s.length, 17);
  assert.ok(by['040526sr'] && by['040526am']);
  assert.ok(by['041821am'], 'trailing space in "AM " handled');
  assert.ok(by['061712ampm'], 'AM/PM slot');
  assert.equal(by['090422am'].preacher, 'Gene Burnsed');
  assert.equal(by['061712ampm'].preacher, 'Bro Lester');
  assert.equal(by['110120am'].preacher, 'Kermit Matthews');
  assert.equal(by['120323am'].title, "Begging, Bowing & Believing'");
});

t('website page -> episodes (messy hand-edited HTML)', () => {
  const p = fromPage(fx('sermons.html'));
  const by = Object.fromEntries(p.map((e) => [e.key, e]));
  assert.deepEqual(by['101126am'], { key: '101126am', date: '2026-10-11', slot: 'am', preacher: 'Jason Crawford', title: '2Cor.5:21', source: 'page' });
  assert.equal(by['092826am'].date, '2026-09-27', 'page date wins over mislabeled file name');
  assert.equal(by['091326am'].preacher, 'Jason Crawford');
  assert.equal(by['091326am'].title, '2Cor.5:19 - Committed to us the Word');
  assert.equal(by['080926pm'].title, 'Extremes: Son to a Servant');
  assert.equal(by['080926pm'].preacher, 'Dana Williams');
  assert.equal(by['080926am'].date, '2026-08-09');
  assert.equal(by['080926am'].title, 'A Preacher');
  assert.equal(by['061426am'].title, '2Cor.5:18 - Ministering to our Fellows & the Fallen');
  assert.equal(by['052426am'].title, 'By Faith: The Journey from Egypt');
  assert.equal(by['040526sr'].slot, 'sr');
  assert.equal(by['032226am'].title, '2Cor.5:18 All things are of God');
  assert.equal(p.filter((e) => e.key === '080926am').length, 1, 'stray URL link not double counted');
});

t('merge: sheet wins, page adds new, overrides apply', () => {
  const m = merge(fromSheet(fx('sheet.csv')), fromPage(fx('sermons.html')), JSON.parse(readFileSync(join(root, 'overrides.json'), 'utf8')));
  const by = Object.fromEntries(m.map((e) => [e.key, e]));
  assert.equal(by['050326am'].source, 'sheet');
  assert.equal(by['101126am'].source, 'page');
  assert.equal(by['100911am'].title, 'Knowing #6 (Part 1)');
  assert.ok(by['100911ampt2']);
});

t('dates: Eastern time with daylight saving', () => {
  assert.equal(rfc2822Eastern('2026-10-11', 'am').text, 'Sun, 11 Oct 2026 10:30:00 -0400');
  assert.equal(rfc2822Eastern('2026-03-08', 'am').text, 'Sun, 08 Mar 2026 10:30:00 -0400');
  assert.equal(rfc2822Eastern('2020-11-01', 'am').text, 'Sun, 01 Nov 2020 10:30:00 -0500');
  assert.equal(rfc2822Eastern('2026-10-07', 'pm').text, 'Wed, 07 Oct 2026 18:30:00 -0400');
  assert.equal(rfc2822Eastern('2026-04-05', 'sr').text, 'Sun, 05 Apr 2026 07:00:00 -0400');
  assert.equal(rfc2822Eastern('2012-01-22', 'pm', 2).text, 'Sun, 22 Jan 2012 18:32:00 -0500');
});

t('episode titles', () => {
  const T = (title, preacher = 'Bro Lester') => episodeTitle({ title, preacher, date: '2018-04-15', slot: 'am' });
  assert.equal(T('2Cor.5:21', 'Jason Crawford'), '2Cor.5:21 | Jason Crawford');
  assert.equal(T('Gal.1:15; no PM recording'), 'Gal.1:15 | Bro Lester');
  assert.equal(T('Eph.1:17 (no PM service message)'), 'Eph.1:17 | Bro Lester');
  assert.equal(T('Eph.4:26,27 PM Power out'), 'Eph.4:26,27 | Bro Lester');
  assert.equal(T('Confession - message not posted online'), 'Confession | Bro Lester');
  assert.equal(T('Rebellion (5/10 service not uploaded)'), 'Rebellion | Bro Lester');
  assert.equal(T('The Love of God (Service not recorded)', 'Jason Crawford'), 'The Love of God | Jason Crawford');
  assert.equal(T('Treasures in Earthen Vessels (services combines, audio issues)'), 'Treasures in Earthen Vessels | Bro Lester');
  assert.equal(T('Thanksgiving #2 (Missed 1st part)'), 'Thanksgiving #2 (Missed 1st part) | Bro Lester');
  assert.equal(T('Making Room: For what you;ve got', 'Dana Williams'), 'Making Room: For what you’ve got | Dana Williams');
  assert.equal(T('Knowing #15 Phil 4:13; 2Thes 3:1-3'), 'Knowing #15 Phil 4:13; 2Thes 3:1-3 | Bro Lester');
  assert.equal(T('Missionary; no PM recording', 'Francis Landingin'), 'Francis Landingin – Sunday morning, April 15, 2018');
  assert.equal(episodeTitle({ title: 'Message', preacher: 'Deoram Bolan', date: '2015-02-24', slot: 'pm' }), 'Deoram Bolan – Tuesday evening, February 24, 2015');
  assert.equal(episodeTitle({ title: '#REF!', preacher: 'Ron Thames', date: '2024-12-08', slot: 'am' }), 'Ron Thames – Sunday morning, December 8, 2024');
  assert.equal(episodeTitle({ title: 'Whole Service', preacher: 'Whole Service', date: '2026-04-12', slot: 'am' }), 'Christ’s Church of Starke – Sunday morning, April 12, 2026');
  assert.equal(episodeTitle({ title: 'Missionary', preacher: '', date: '2017-11-05', slot: 'pm' }), 'Christ’s Church of Starke – Sunday evening, November 5, 2017');
});

t('mp3 length: VBR (Xing) and constant bitrate, with ID3 tag', () => {
  // MPEG1 Layer III, 128 kbps, 44.1 kHz, stereo -> 417-byte frames
  const frameHdr = [0xff, 0xfb, 0x90, 0x00];
  const frame = (fill) => { const f = new Uint8Array(417); f.set(frameHdr); f.fill(fill, 4); return f; };
  const id3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0x08, 0x00]); // 1024-byte tag
  assert.equal(id3Size(id3), 10 + 1024);
  const build = (first) => { const b = new Uint8Array(1034 + 417 * 20); b.set(id3); b.set(first, 1034); for (let i = 1; i < 20; i++) b.set(frame(0), 1034 + 417 * i); return b; };
  // CBR: 1 hour at 128 kbps = 57,600,000 bytes of audio
  const cbr = build(frame(0));
  assert.equal(mp3Duration(cbr, 1034 + 57_600_000).seconds, 3600);
  // VBR: Xing header says 137,812 frames * 1152 / 44100 = 3600 s
  const x = frame(0); x.set([0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 1, 0x00, 0x02, 0x1a, 0x54], 4 + 32);
  assert.equal(mp3Duration(build(x), 99_999_999).seconds, 3600);
});

t('full build offline -> valid feed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccos-'));
  for (const p of ['build.js', 'sources.js', 'feed.js', 'mp3.js', 'package.json', 'overrides.json', 'test-sheet.csv', 'test-sermons.html']) cpSync(join(root, p), join(dir, p));
  const cfg = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
  cfg.drip.enabled = false;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
  mkdirSync(join(dir, 'data'), { recursive: true });
  const keys = ['050326am', '042626am', '041226am', '040526am', '040526sr', '030826am', '120824am', '120323am', '110517pm', '021620am', '041821am', '110120am',
    '061712am', '012212pm1', '012212pm2', '012212pm3', '012212pm4', '100911ampt1', '100911ampt2', '090422am',
    '101126am', '092826am', '091326am', '080926pm', '080926am', '061426am', '052426am', '032226am'];
  const audio = Object.fromEntries(keys.map((k, i) => [`${k}.mp3`, { size: 20_000_000 + i, seconds: 2400 + i, checked: '2026-10-12' }]));
  audio['022415pm.mp3'] = { missing: true, checked: '2026-10-12' };
  writeFileSync(join(dir, 'data/audio.json'), JSON.stringify(audio));
  const out = execFileSync('node', ['build.js', '--offline'], { cwd: dir, encoding: 'utf8' });
  const xml = readFileSync(join(dir, 'docs/feed.xml'), 'utf8');
  try { execFileSync('xmllint', ['--noout', join(dir, 'docs/feed.xml')]); }
  catch (e) { if (e.code !== 'ENOENT') throw e; } // xmllint not installed: skip
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml), 'no illegal characters');
  const items = xml.match(/<item>/g).length;
  assert.equal(items, 28, out);
  const guids = [...xml.matchAll(/<guid[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.equal(new Set(guids).size, guids.length, 'unique ids');
  assert.ok(xml.indexOf('ccofstarke-101126am') < xml.indexOf('ccofstarke-092826am'), 'newest first');
  assert.ok(xml.indexOf('ccofstarke-012212pm4<') < xml.indexOf('ccofstarke-012212pm<'), 'multi-part sermons in order');
  for (const m of xml.matchAll(/<pubDate>([^<]+)</g)) assert.match(m[1], /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), \d\d (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d\d:\d\d:00 -0[45]00$/);
  assert.match(xml, /url="https:\/\/sermons\.ccofstarke\.com\/010221am\.mp3"|url="https:\/\/sermons\.ccofstarke\.com\/100911ampt1\.mp3"/);
  assert.match(readFileSync(join(dir, 'data/report.txt'), 'utf8'), /022415pm\.mp3/);
});

console.log(`\n${n} checks passed`);
