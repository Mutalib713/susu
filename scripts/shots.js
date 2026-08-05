// Captures submission media from the LIVE app. Real screenshots, not mockups.
// Drives a real circle into a real state first, so nothing on screen is staged.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.SHOT_URL || 'https://susu-cyan.vercel.app';
const OUT = path.join(__dirname, '..', 'media');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--force-device-scale-factor=2', '--hide-scrollbars'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
  page.setDefaultTimeout(180000);

  const shot = async (name, full = false) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
    console.log('saved', name);
  };
  const settled = (sel) => page.waitForFunction((s) => {
    const n = document.querySelector(s);
    return n && !n.textContent.includes('Loading') && !n.textContent.includes('Reading');
  }, {}, sel);

  console.log('target:', URL);
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle2' });
  await wait(1200);

  // 1 — the front door
  await shot('1-signin');

  // sign in
  await page.type('#fullname', 'Akosua Boateng');
  await page.type('#phone', '024 887 5512');
  await page.click('#b-gate');
  await page.waitForFunction(() => !document.getElementById('v-list').classList.contains('hidden'));
  await settled('#list');
  await wait(600);

  // 2 — no circles yet
  await shot('2-no-circles');

  // create one
  const code = 'SHOT' + Math.random().toString(36).slice(2, 6).toUpperCase();
  await page.click('[data-go="create"]');
  await wait(400);
  await page.type('#c-label', 'Ayeduase Hall Circle');
  await page.type('#c-code', code);
  await page.evaluate(() => { document.getElementById('c-amount').value = '20'; document.getElementById('c-size').value = '3'; });
  await page.select('#c-round', '120');
  await wait(300);

  // 3 — the create form
  await shot('3-start-a-circle');

  await page.click('#b-create');
  await page.waitForFunction(() => !document.getElementById('v-circle').classList.contains('hidden'));
  await settled('#ci-members');
  await wait(600);

  // 4 — the join code, before it starts
  await shot('4-join-code');

  // bring two more members in through the same relayer the browser uses
  console.log('adding two members…');
  await page.evaluate(async (c) => {
    for (const name of ['Kofi Mensah · 055•••3344', 'Yaa Boateng · 020•••5566']) {
      const w = ethers.Wallet.createRandom();
      await fetch('/api/joinCircle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: c, address: w.address, handle: name }),
      });
    }
  }, code);

  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => !document.getElementById('v-list').classList.contains('hidden'));
  await settled('#list');
  await page.evaluate(() => document.querySelector('[data-circle]').click());
  await settled('#ci-members');
  await wait(600);

  // start it, then pay
  console.log('starting and paying…');
  await page.evaluate(() => document.querySelector('#ci-actions button').click());
  await page.waitForFunction(() => document.getElementById('s-circle').getAttribute('data-kind') === 'good');
  await wait(800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#ci-actions button')].find((x) => x.textContent.startsWith('Put in'));
    if (b) b.click();
  });
  await page.waitForFunction(() => (document.getElementById('s-circle').textContent || '').includes('in the box'));
  await settled('#ci-book');
  await wait(800);

  // 5 — a circle actually running
  await shot('5-running');
  await shot('6-full-page', true);

  // 7 — the reveal
  await page.evaluate(() => {
    document.querySelector('.truth').open = true;
    document.querySelector('.truth').scrollIntoView({ block: 'start' });
  });
  await wait(700);
  await shot('7-the-truth');

  // 0 — cover card
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
  await page.goto('file:///' + path.join(__dirname, '..', 'media', 'cover.html').replace(/\\/g, '/'), {
    waitUntil: 'networkidle2',
  });
  await wait(900);
  await page.screenshot({ path: path.join(OUT, '0-cover.png') });
  console.log('saved 0-cover');

  await browser.close();
  console.log('\ndone — media/');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
