const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'store-assets', 'output');
const systemChrome = process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : undefined;
const expected = [
  ['01-popup-video-playing.png', 'capture.html?mode=playing', '[data-ready="true"]'],
  ['02-popup-japanese-detected.png', 'capture.html?mode=detected', '[data-ready="true"]'],
  ['03-daily-weekly-statistics.png', 'dashboard.html?view=stats&demo=1', '#stats.active'],
  ['04-history-analytics.png', 'dashboard.html?view=history&demo=1', '#history.active'],
  ['05-settings.png', 'dashboard.html?view=settings&demo=1', '#settings.active']
];
const screenshotTheme = process.env.SCREENSHOT_THEME === 'light' ? 'light' : 'dark';

function pngSize(file) {
  const data = fs.readFileSync(file);
  if (data.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${file} is not a PNG`);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    const type = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.png':'image/png' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const localBase = `http://127.0.0.1:${server.address().port}/store-assets/`;
  const context = await chromium.launchPersistentContext(path.join(output, '.chromium-profile'), {
    // Chrome's current headless mode disables unpacked extensions. Headful mode
    // still captures the page viewport only, so the output remains deterministic.
    headless: false,
    ...(systemChrome && fs.existsSync(systemChrome) ? { executablePath: systemChrome } : {}),
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  try {
    // Chromium exposes the MV3 worker. Some branded Chrome releases suppress
    // unpacked-extension workers in automated sessions; file:// is a visual-only
    // fallback using the exact same bundled HTML/CSS/JS assets.
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 2500 }).catch(() => null);
    const extensionBase = worker
      ? `chrome-extension://${new URL(worker.url()).host}/store-assets/`
      : localBase;
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const [name, target, ready] of expected) {
      const themedTarget = target.includes('dashboard.html') ? `${target}&theme=${screenshotTheme}` : target;
      await page.goto(new URL(themedTarget, extensionBase).href, { waitUntil: 'networkidle' });
      await page.waitForSelector(ready, { state: 'visible' });
      await page.evaluate(async () => { await document.fonts.ready; });
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(output, name), type: 'png' });
    }
    // Pro Analytics is not one of the five store frames, but its interactive
    // layout is still exercised whenever the marketing set is regenerated.
    await page.goto(new URL(`dashboard.html?view=pro&demo=1&theme=${screenshotTheme}`, extensionBase).href, { waitUntil: 'networkidle' });
    await page.waitForSelector('#pro.active', { state: 'visible' });
    const proLayout = await page.evaluate(() => {
      const panel = document.querySelector('.pro-sources')?.getBoundingClientRect();
      const lastRow = document.querySelector('.pro-source-row:last-child')?.getBoundingClientRect();
      return {
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        verticalOverflow: document.documentElement.scrollHeight > innerHeight,
        sourceRowsFit: !panel || !lastRow || lastRow.bottom <= panel.bottom - 8
      };
    });
    if (proLayout.horizontalOverflow || proLayout.verticalOverflow || !proLayout.sourceRowsFit) {
      throw new Error(`Pro Analytics layout overflow: ${JSON.stringify(proLayout)}`);
    }
    const firstProSource = page.locator('.pro-source-row').first();
    if (await firstProSource.count()) {
      await firstProSource.click();
      if (!await page.locator('#proSourceDrawer').isVisible()) throw new Error('Pro source drill-down did not open');
      await page.locator('#proDrawerClose').click();
    }
    await page.locator('.period-switch [data-days="90"]').click();
    if (!await page.locator('.period-switch [data-days="90"]').evaluate(node => node.classList.contains('active'))) {
      throw new Error('Pro period comparison control did not update');
    }
    for (const [name] of expected) {
      const [width, height] = pngSize(path.join(output, name));
      if (width !== 1280 || height !== 800) throw new Error(`${name}: expected 1280x800, got ${width}x${height}`);
      console.log(`✓ ${name} ${width}x${height}`);
    }
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(path.join(output, '.chromium-profile'), { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
