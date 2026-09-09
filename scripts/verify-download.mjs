import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [path, expected] = process.argv.slice(2);
const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
if (actual !== expected) throw new Error(`Checksum mismatch for ${path}: ${actual}`);
