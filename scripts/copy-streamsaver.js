import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const fromDir = path.join(root, 'node_modules', 'streamsaver');
const toDir = path.join(root, 'dist', 'streamsaver');

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

const files = ['mitm.html', 'sw.js'];

for (const f of files) {
  const src = path.join(fromDir, f);
  const dst = path.join(toDir, f);
  if (!fs.existsSync(src)) {
    console.error(`streamsaver asset missing: ${src}`);
    process.exit(1);
  }
  copyFile(src, dst);
}

console.log('Copied streamsaver assets to dist/streamsaver');

