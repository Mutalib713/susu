// Captures submission media from the LIVE app. Real screenshots, not mockups.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.SHOT_URL || 'https://susu-dpbrw08ny-mutalib.vercel.app';
const OUT = path.join(__dirname, '..', 'media');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--force-device-scale-factor=2', '--hide-scrollbars'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });

  const shot = async (name, full = false) => {
    const p = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: p, fullPage: full });
    console.log('saved', name);
  };

  // 1 — the front door
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));
  await shot('1-signin');

  // 2 — signed in, money in the box
  await page.type('#fullname', 'Akosua Boateng');
  await page.type('#phone', '024 887 5512');
  await page.click('#gateBtn');
  await page.waitForFunction(() => document.getElementById('gate').classList.contains('hidden'), { timeout: 90000 });
  await page.waitForFunction(() => document.getElementById('activity').textContent.trim() !== '', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800));
  await shot('2-your-book');

  // 3 — a contribution going through
  await page.click('#payBtn');
  await page.waitForFunction(
    () => {
      const s = document.getElementById('status').textContent;
      return s.includes('in the box');
    },
    { timeout: 90000 },
  );
  await new Promise((r) => setTimeout(r, 800));
  await shot('3-put-in');

  // 4 — the whole page, ledger and dated book
  await shot('4-full-page', true);

  // 5 — the reveal
  await page.evaluate(() => {
    document.querySelector('.truth').open = true;
    document.querySelector('.truth').scrollIntoView({ block: 'start' });
  });
  await new Promise((r) => setTimeout(r, 600));
  await shot('5-the-truth');

  // 6 — cover card, 1200x630
  const cover = page;
  await cover.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
  await cover.goto('file:///' + path.join(__dirname, '..', 'media', 'cover.html').replace(/\\/g, '/'), {
    waitUntil: 'networkidle2',
  });
  await new Promise((r) => setTimeout(r, 900));
  await cover.screenshot({ path: path.join(OUT, '0-cover.png') });
  console.log('saved 0-cover');

  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
