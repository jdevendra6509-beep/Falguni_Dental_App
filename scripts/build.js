'use strict';

// Bundles src/ into the single apps-script/Index.html file that Apps Script serves.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');

function build() {
  const js = read('app.js');
  if (/<\/script/i.test(js)) throw new Error('app.js must not contain a closing script tag');
  return read('index.html')
    .replace('<!-- STYLES -->', () => `<style>\n${read('styles.css')}</style>`)
    .replace('<!-- SCRIPT -->', () => `<script>\n${js}</script>`);
}

if (require.main === module) {
  fs.writeFileSync(path.join(root, 'apps-script', 'Index.html'), build());
  console.log('Built apps-script/Index.html');
}

module.exports = { build };
