'use strict';
// Test stand-ins for SharePoint (not *.e2e.js, so the runner does not treat it as scenarios):
// an in-memory Microsoft Graph routed in Node, and MSAL.js defined before the page loads
// (so the CDN copy is not used).
const DB = 'TIM_Manager/Database/tim_db.json';
const SITE = 'site-1';

/** In-memory document library: path → { id, content: Buffer, etag, modified }. */
function fakeDrive() {
  // members: rows of the Project_Members list (fields as Graph returns them);
  // down: true → every write answers 503 (SharePoint unreachable for writes)
  const g = { files: new Map(), seq: 0, n: 0, log: [], tokens: new Set(), beforePut: null, members: null, down: false };
  g.put = (path, buf) => {
    let f = g.files.get(path);
    if (!f) { f = { id: 'item-' + (++g.seq), path }; g.files.set(path, f); }
    f.content = buf; f.etag = '"{' + f.id + '},' + (++g.n) + '"'; f.modified = new Date().toISOString();
    return f;
  };
  g.byId = id => Array.from(g.files.values()).find(f => f.id === id) || null;
  g.text = path => (g.files.get(path) ? g.files.get(path).content.toString('utf8') : null);
  g.json = path => JSON.parse(g.text(path));
  return g;
}

async function routeGraph(context, g) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS', 'Access-Control-Expose-Headers': '*' };
  const json = (route, status, obj) => route.fulfill({ status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors), body: JSON.stringify(obj) });
  const meta = f => ({ id: f.id, name: f.path.split('/').pop(), eTag: f.etag, size: f.content.length, lastModifiedDateTime: f.modified, webUrl: 'https://sharepoint.test/' + encodeURI(f.path), file: {} });
  const notFound = route => json(route, 404, { error: { code: 'itemNotFound', message: 'The resource could not be found.' } });
  await context.route(/^https:\/\/graph\.microsoft\.com\//, async route => {
    const req = route.request();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const p = decodeURIComponent(u.pathname).replace(/^\/v1\.0/, '');
    const auth = req.headers()['authorization'] || '';
    g.log.push({ method, p, ifMatch: req.headers()['if-match'] || null, auth, query: u.search });
    if (!/^Bearer tok-/.test(auth)) return json(route, 401, { error: { code: 'InvalidAuthenticationToken', message: 'no token' } });
    g.tokens.add(auth);
    if (p === '/sites/deltao365.sharepoint.com:/sites/Thermal-Spec-DB') return json(route, 200, { id: SITE });
    if (g.down && method !== 'GET') return json(route, 503, { error: { code: 'serviceNotAvailable', message: 'Service unavailable' } });
    if (p === '/sites/site-1/lists') {
      const want = /displayName eq 'Project_Members'/.test(decodeURIComponent(u.search));
      return json(route, 200, { value: want && g.members ? [{ id: 'list-members', displayName: 'Project_Members' }] : [] });
    }
    if (p === '/sites/site-1/lists/list-members/items') {
      return json(route, 200, { value: (g.members || []).map((f, i) => ({ id: String(i + 1), fields: f })) });
    }
    let m = /^\/sites\/site-1\/drive\/root:\/(.+?)(?::\/(content|children))?$/.exec(p);
    if (m) {
      const path = m[1], what = m[2] || 'meta';
      if (what === 'children') {
        const names = Array.from(g.files.keys()).filter(k => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).map(k => ({ name: k.slice(path.length + 1) }));
        return names.length ? json(route, 200, { value: names }) : notFound(route);
      }
      const f = g.files.get(path);
      if (method === 'GET') {
        if (!f) return notFound(route);
        return what === 'content' ? route.fulfill({ status: 200, headers: cors, body: f.content }) : json(route, 200, meta(f));
      }
      if (method === 'PUT') {
        if (f && /conflictBehavior=fail/.test(u.search)) return json(route, 409, { error: { code: 'nameAlreadyExists', message: 'exists' } });
        return json(route, f ? 200 : 201, meta(g.put(path, req.postDataBuffer() || Buffer.alloc(0))));
      }
      if (method === 'DELETE') { g.files.delete(path); return route.fulfill({ status: 204, headers: cors }); }
    }
    m = /^\/sites\/site-1\/drive\/items\/([^/]+)(\/content)?$/.exec(p);
    if (m) {
      const f = g.byId(m[1]);
      if (!f) return notFound(route);
      if (method === 'GET') return m[2] ? route.fulfill({ status: 200, headers: cors, body: f.content }) : json(route, 200, meta(f));
      if (method === 'PUT') {
        if (g.beforePut) { const h = g.beforePut; g.beforePut = null; h(f); }
        const im = req.headers()['if-match'];
        if (im && im !== f.etag) return json(route, 412, { error: { code: 'resourceModified', message: 'ETag does not match' } });
        return json(route, 200, meta(g.put(f.path, req.postDataBuffer() || Buffer.alloc(0))));
      }
    }
    return json(route, 400, { error: { code: 'badRequest', message: 'unhandled ' + method + ' ' + p } });
  });
}

/** MSAL stand-in: accounts in localStorage (like the real cache); window.__expired makes silent token calls fail. */
function fakeMsal() {
  const key = '__fake_msal_account';
  window.msal = {
    PublicClientApplication: class {
      constructor(cfg) { window.__msalConfig = cfg; }
      async initialize() {}
      async handleRedirectPromise() { return null; }
      getAllAccounts() { const a = localStorage.getItem(key); return a ? [JSON.parse(a)] : []; }
      async loginPopup() {
        window.__logins = (window.__logins || 0) + 1;
        const acc = window.__nextAccount || { name: 'Tester A', username: 'tester.a@example.test' };
        localStorage.setItem(key, JSON.stringify(acc));
        return { account: acc };
      }
      async acquireTokenSilent(req) {
        if (window.__expired) throw Object.assign(new Error('interaction required'), { errorCode: 'interaction_required' });
        return { accessToken: 'tok-' + req.account.username };
      }
      async acquireTokenPopup(req) { window.__expired = false; window.__popups = (window.__popups || 0) + 1; return { accessToken: 'tok-' + req.account.username, account: req.account }; }
    },
  };
}

async function setup(env, g) {
  await env.context.addInitScript(fakeMsal);
  await routeGraph(env.context, g);
}
/**
 * Chrome logs every 4xx response as a console error. 404 (does the database / folder exist?)
 * and 412 (someone saved first) are answers the tool expects; anything else still fails the test.
 */
function allowHttp(env, statuses) {
  const re = new RegExp('Failed to load resource: the server responded with a status of (' + statuses.join('|') + ')');
  const other = env.errors.filter(e => !re.test(e));
  env.errors.length = 0; env.errors.push(...other);
}
const saved = page => page.waitForFunction(() => TIM.store.status.state === 'saved' && !TIM.store.hasUnsaved());
async function openSp(page, base) {
  await page.goto(base);
  await page.waitForSelector('.gate');
  await page.click('button:has-text("SharePoint 共用資料庫")');
}


module.exports = { DB, SITE, fakeDrive, routeGraph, fakeMsal, setup, allowHttp, saved, openSp };
