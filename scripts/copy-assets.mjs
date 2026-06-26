// Copy non-TS assets (JSON data files) from src/ to dist/
// Required because tsc does not copy .json files referenced via readFileSync.

import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const srcRoot = join(__dirname, '..', 'src');
const distRoot = join(__dirname, '..', 'dist');

if (!existsSync(distRoot)) {
  console.error(`dist/ does not exist — run \`tsc\` first.`);
  process.exit(1);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

const allFiles = await walk(srcRoot);
const jsonFiles = allFiles.filter((p) => p.endsWith('.json'));

for (const srcFile of jsonFiles) {
  const rel = relative(srcRoot, srcFile);
  const destFile = join(distRoot, rel);
  await mkdir(dirname(destFile), { recursive: true });
  await writeFile(destFile, await readFile(srcFile));
  console.log(`Copied ${rel}`);
}

console.log(`Done — copied ${jsonFiles.length} JSON file(s).`);
