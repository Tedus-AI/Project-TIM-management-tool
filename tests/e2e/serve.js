'use strict';
// Minimal static file server for headless tests (no dependencies).
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.xlsx': 'application/octet-stream' };

function serve(root, port) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise(resolve => server.listen(port || 0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

module.exports = { serve };
if (require.main === module) {
  serve(path.resolve(__dirname, '../..'), parseInt(process.argv[2] || '8765', 10)).then(({ port }) => console.log('serving on http://127.0.0.1:' + port));
}
