// T03 manifest: emit "hash|size|relpath" rows (DIR/SYMLINK rows included) for a file or dir.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, lstat, readlink, writeFile } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';

const [target, out] = process.argv.slice(2);
if (!target || !out) { console.error('usage: manifest.mjs <file|dir> <out.tsv>'); process.exit(2); }
const root = target;
const rows = [];

async function hashFile(p) {
  const h = createHash('sha256');
  await new Promise((res, rej) => {
    createReadStream(p).on('data', (d) => h.update(d)).on('end', res).on('error', rej);
  });
  return h.digest('hex');
}

async function walk(dir) {
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const p = join(dir, e.name);
    const rel = relative(root, p);
    if (e.isDirectory()) { rows.push(`DIR\t0\t${rel}`); await walk(p); }
    else if (e.isSymbolicLink()) { rows.push(`SYMLINK:${await readlink(p)}\t0\t${rel}`); }
    else if (e.isFile()) { const st = await stat(p); rows.push(`${await hashFile(p)}\t${st.size}\t${rel}`); }
    else { const st = await lstat(p); rows.push(`OTHER:${e.isFIFO() ? 'fifo' : e.isSocket() ? 'socket' : 'unknown'}\t${st.size}\t${rel}`); }
  }
}

const st = await stat(target);
if (st.isDirectory()) { rows.push(`DIR\t0\t.`); await walk(target); }
else { rows.push(`${await hashFile(target)}\t${st.size}\t${basename(target)}`); }
rows.sort((a, b) => { const x = a.split('\t')[2], y = b.split('\t')[2]; return x < y ? -1 : x > y ? 1 : 0; });
await writeFile(out, rows.join('\n') + '\n');
console.log(`${rows.length} rows -> ${out}`);
