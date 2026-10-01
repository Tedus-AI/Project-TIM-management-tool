'use strict';
// E2E runner: each tests/e2e/*.e2e.js exports { name, run(env) } scenarios; fresh browser per file.
const fs = require('fs');
const path = require('path');
const { start, stop } = require('./helpers');

(async () => {
  const only = process.argv[2];
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.e2e.js') && (!only || f.includes(only))).sort();
  let pass = 0, fail = 0;
  for (const f of files) {
    const scenarios = require(path.join(__dirname, f));
    for (const sc of scenarios) {
      const env = await start();
      const t0 = Date.now();
      try {
        await sc.run(env);
        if (env.errors.length) throw new Error('browser errors:\n  ' + env.errors.join('\n  '));
        pass++;
        console.log('  ✓ ' + f + ' › ' + sc.name + ' (' + (Date.now() - t0) + ' ms)');
      } catch (e) {
        fail++;
        console.log('  ✗ ' + f + ' › ' + sc.name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n    '));
        if (env.errors.length) console.log('    browser errors:\n      ' + env.errors.join('\n      '));
        try { fs.mkdirSync(path.resolve(__dirname, '../../test-results'), { recursive: true }); await env.page.screenshot({ path: path.resolve(__dirname, '../../test-results/fail-' + f + '-' + sc.name.replace(/\W+/g, '_') + '.png') }); } catch (x) { /* ignore */ }
      } finally {
        await stop(env);
      }
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
