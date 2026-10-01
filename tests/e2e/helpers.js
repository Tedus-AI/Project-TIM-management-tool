'use strict';
// Shared helpers for headless tests.
// CDN requests can be served from a local cache (TIM_CDN_CACHE) holding the exact pinned files —
// the page's SRI hashes still verify them. Without the env var requests go to the network (CI).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serve } = require('./serve');

const ROOT = path.resolve(__dirname, '../..');

async function routeCdn(context) {
  const cache = process.env.TIM_CDN_CACHE;
  if (!cache) return;
  await context.route(/^https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com|alcdn\.msauth\.net)\//, route => {
    const u = new URL(route.request().url());
    const rel = u.pathname.replace(/^\/npm\//, '/').replace(/^\//, '');
    const file = path.join(cache, rel.replace(/\//g, '_'));
    if (fs.existsSync(file)) {
      return route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { 'Content-Type': 'text/javascript', 'Access-Control-Allow-Origin': '*' } });
    }
    return route.continue();
  });
  // Web fonts are cosmetic; in the sandbox they fall back to system fonts.
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
}

async function start(opts) {
  opts = opts || {};
  const { server, port } = await serve(ROOT);
  // UTF-8 locale so Chinese download file names survive (the sandbox defaults to the C locale).
  const browser = await chromium.launch({ env: Object.assign({}, process.env, { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }) });
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1600, height: 960 }, acceptDownloads: true });
  await routeCdn(context);
  // Stress option: slow animation frames (as on a busy CI runner) so hook effects run late.
  if (process.env.TIM_SLOW_FRAMES) {
    await context.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = cb => raf(t => setTimeout(() => cb(t), 90));
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (process.env.TIM_CDN_CACHE && /Failed to load resource: net::ERR_FAILED/.test(t)) return;   // aborted font requests
    errors.push('console: ' + t);
  });
  return { server, browser, context, page, errors, base: 'http://127.0.0.1:' + port + '/' };
}

async function stop(env) {
  await env.browser.close();
  env.server.close();
}

/** Attach an in-memory stand-in for the database file (window.__fakeFile.text = its content). */
async function attachFakeFile(page, text) {
  await page.evaluate(text => {
    const f = window.__fakeFile = { text, writes: 0 };
    const handle = {
      name: 'tim_db.json',
      kind: 'file',
      async getFile() { return new File([f.text], 'tim_db.json', { type: 'application/json' }); },
      async createWritable() { let buf = ''; return { async write(t) { buf += t; }, async close() { f.text = buf; f.writes++; } }; },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    };
    TIM.fileBackend.__setHandleForTest(handle);
    window.__attachResult = TIM.app.attach(TIM.fileBackend);
  }, text);
  return page.evaluate(() => window.__attachResult);
}

/** Add the demo project (test fixture, not part of the app) to the open database. */
async function addDemo(page) {
  if (!await page.evaluate(() => !!(window.TIM && TIM.sample))) await page.addScriptTag({ path: path.join(__dirname, 'fixtures', 'sample.js') });
  return page.evaluate(() => TIM.sample.addSampleToStore());
}

/** Open the app on an in-memory database holding the demo project. */
async function openWithDemo(env, user) {
  const { page } = env;
  await page.goto(env.base);
  await page.waitForSelector('.gate', { timeout: 30000 });
  if (user) await page.evaluate(u => TIM.app.setUserName(u), user);
  if (!await attachFakeFile(page, '')) throw new Error('could not attach the test database');
  await addDemo(page);
  await page.waitForSelector('.proj-table', { timeout: 30000 });
}

module.exports = { start, stop, openWithDemo, attachFakeFile, addDemo, ROOT };
