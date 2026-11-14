// Phase 4 screenshot runner — token-radar-01.
// Renders out/dashboard/index.html at 1440x900 and captures 3 whole-page PNGs:
//   1-board.png    (board)
//   2-detail.png   (#detail=steakhouse-financial)
//   3-filtered.png (#watchlist=1)
// Usage: node scripts/screenshot.mjs [--chromium <path-to-chrome-binary>]
// Without --chromium it uses playwright's bundled chromium (needs `npx playwright install chromium`).
// Served over a tiny local HTTP server (file:// works too, but http avoids any file-origin quirks).
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'out');
const shotDir = join(root, 'screenshots');

const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  const file = join(outDir, urlPath === '/' ? 'dashboard/index.html' : urlPath);
  if (!file.startsWith(outDir) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const argv = process.argv.slice(2);
const exeIdx = argv.indexOf('--chromium');
const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'] };
if (exeIdx >= 0 && argv[exeIdx + 1]) launchOpts.executablePath = argv[exeIdx + 1];

const browser = await chromium.launch(launchOpts);
const shots = [
  { file: '1-board.png', url: `http://127.0.0.1:${port}/dashboard/index.html` },
  { file: '2-detail.png', url: `http://127.0.0.1:${port}/dashboard/index.html#detail=steakhouse-financial` },
  { file: '3-filtered.png', url: `http://127.0.0.1:${port}/dashboard/index.html#watchlist=1` },
];
mkdirSync(shotDir, { recursive: true });
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(s.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600); // let the JS render settle
  const rendered = await page.evaluate(() => document.querySelectorAll('#board tbody tr, table tbody tr').length + '|' + (document.body.innerText || '').slice(0, 120).replace(/\n/g, ' / '));
  console.log(`${s.file}: rendered rows/text -> ${rendered}`);
  await page.screenshot({ path: join(shotDir, s.file), fullPage: true });
  await page.close();
}
await browser.close();
server.close();

// The gate caps each screenshot at 524,288 bytes. The full-page board
// (1440x14934, 200 rows of text) is ~1.9 MB as RGB, so quantize to a
// palette with PIL: 32 colours for the long board, 256 for the shorter
// views. The dashboard is flat colours + text, so this stays legible.
const quantize = `
from PIL import Image
import os
for name, colors in [('1-board.png', 32), ('2-detail.png', 256), ('3-filtered.png', 256)]:
    p = 'screenshots/' + name
    img = Image.open(p).convert('RGB')
    q = img.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    q.save(p, optimize=True)
    print(name, os.path.getsize(p), 'bytes,', q.size)
`;
execFileSync('python3', ['-c', quantize], { cwd: root, stdio: 'inherit' });
console.log('done');
