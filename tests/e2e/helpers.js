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
  await context.route(/^https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\//, route => {
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

/** Open the app in trial (browser storage) mode with the demo project. */
async function openTrialWithDemo(env, user) {
  await env.page.goto(env.base);
  await env.page.waitForSelector('.gate', { timeout: 30000 });
  if (user) await env.page.evaluate(u => TIM.app.setUserName(u), user);
  await env.page.click('.gate-link:has-text("瀏覽器暫存")');
  await env.page.waitForSelector('.proj-table', { timeout: 30000 });
}

module.exports = { start, stop, openTrialWithDemo, ROOT };
