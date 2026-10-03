const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => errors.push(`reqfail: ${req.url()} ${req.failure()?.errorText}`));

  const shots = [
    ['/', '/tmp/shot-root.png'],
    ['/login', '/tmp/shot-login.png'],
    ['/invoices/new', '/tmp/shot-editor.png'],
    ['/businesses', '/tmp/shot-businesses.png'],
  ];
  for (const [path, out] of shots) {
    await page.goto(`http://127.0.0.1:5173${path}`, { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => errors.push(`nav ${path}: ${e.message}`));
    await page.waitForTimeout(800);
    await page.screenshot({ path: out });
    const title = await page.title().catch(() => '?');
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => '?');
    console.log(`${path} -> title="${title}" text="${bodyText.replace(/\n/g, ' | ')}"`);
  }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
