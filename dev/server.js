'use strict';

/**
 * Local preview: serves apps-script/Index.html and runs the real Code.gs against an
 * in-memory spreadsheet, with a google.script.run shim that calls it over HTTP.
 * Nothing here is used in production — Google runs the app there.
 */
const http = require('node:http');
const { loadBackend } = require('./gas-mock');
const { build } = require('../scripts/build');

const SHIM = `<script>
window.google = { script: { get run() {
  const h = {};
  const runner = new Proxy({}, { get(_, fn) {
    if (fn === 'withSuccessHandler') return (f) => { h.ok = f; return runner; };
    if (fn === 'withFailureHandler') return (f) => { h.fail = f; return runner; };
    return (...args) => fetch('/__gas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn, args }) })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Server error'))).then((r) => h.ok && h.ok(r.result), (e) => h.fail && h.fail(e));
  } });
  return runner;
} } };
</script>`;

const { gas } = loadBackend();
const port = Number(process.env.PORT) || 3000;

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__gas') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const { fn, args } = JSON.parse(body);
      if (fn !== 'api') return res.writeHead(404).end();
      // google.script.run round-trips arguments through JSON; mimic the network delay a little.
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: gas.api(...JSON.parse(JSON.stringify(args))) }));
      }, 150);
    });
    return;
  }
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(build().replace('<script>', SHIM + '<script>'));
  }
  res.writeHead(404).end('Not found');
}).listen(port, () => console.log(`Local preview (in-memory data): http://localhost:${port}`));
