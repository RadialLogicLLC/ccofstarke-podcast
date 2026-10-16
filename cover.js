// Builds cover.jpg (3000x3000) for the podcast from the church's own vector logo.
// Runs once in the GitHub job when cover.jpg is missing. Needs: npm i sharp
import { writeFile } from 'node:fs/promises';

const LOGO = 'https://irp.cdn-website.com/eccf99db/dms3rep/multi/ccofstarke-white-gold-hz.svg';

// Pieces of the horizontal logo, in the logo's own coordinates: [x, y, width, height]
const PIECES = {
  mark: [0, 0, 279, 329.34], // circle, cross and open Bible (cross sits 13 units right of center)
  name: [297, 93, 820, 58.5], // CHRIST'S CHURCH
  starke: [297, 178.9, 820, 34.2], // —— OF STARKE ——
  motto: [401, 235.5, 623, 46.8], // His Life • His Love • His Light
};

/** Re-stacks the horizontal logo into a square cover. Pure string work: runs in Node or a browser. */
export function composeCover(logoSvg, size = 3000) {
  const inner = logoSvg.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const s = size / 3000;
  // [piece, target width or null, target height or null, gap after]
  const rows = [['mark', null, 1250, 170], ['name', 2400, null, 95], ['starke', 2400, null, 120], ['motto', 1700, null, 0]];
  const nudge = { mark: -(13 / 279) }; // center the cross, not the circle, on the page
  const laid = rows.map(([k, w, h, gap]) => {
    const [, , bw, bh] = PIECES[k];
    const width = w ?? (h * bw) / bh; const height = h ?? (w * bh) / bw;
    return { k, width, height, gap };
  });
  const total = laid.reduce((a, r) => a + r.height + r.gap, 0);
  let y = (3000 - total) / 2 - 30;
  const parts = laid.map((r) => {
    const x = (3000 - r.width) / 2 + (nudge[r.k] || 0) * r.width;
    const out = `<svg x="${(x * s).toFixed(1)}" y="${(y * s).toFixed(1)}" width="${(r.width * s).toFixed(1)}" height="${(r.height * s).toFixed(1)}" viewBox="${PIECES[r.k].join(' ')}"><use href="#L" xlink:href="#L"/></svg>`;
    y += r.height + r.gap;
    return out;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<defs><radialGradient id="bg" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#585858"/><stop offset="1" stop-color="#2b2b2b"/></radialGradient><g id="L">${inner}</g></defs>
<rect width="${size}" height="${size}" fill="url(#bg)"/>
${parts.join('\n')}
</svg>`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sharp = (await import('sharp')).default;
  const r = await fetch(LOGO);
  if (!r.ok) throw new Error(`Logo download failed: HTTP ${r.status}`);
  const svg = composeCover(await r.text());
  let q = 90, out;
  do { out = await sharp(Buffer.from(svg)).flatten({ background: '#2b2b2b' }).jpeg({ quality: q, chromaSubsampling: '4:4:4' }).toBuffer(); q -= 5; } while (out.length > 500_000 && q > 60);
  await writeFile('cover.jpg', out);
  const meta = await sharp(out).metadata();
  console.log(`cover.jpg ${meta.width}x${meta.height} ${meta.space} ${Math.round(out.length / 1024)} KB`);
}
