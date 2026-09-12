// Explicit maintenance command, never part of startup/build. Pin inputs, archive
// them compressed, and check in the small runtime book. Recompile offline by default.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';

const sources = JSON.parse(readFileSync('book/sources.json', 'utf8'));
const families = JSON.parse(readFileSync('book/families.json', 'utf8'));
const familyCatalog = [...families];
const automaticFamilies = new Map();
const download = process.argv.includes('--download');
const check = process.argv.includes('--check');
if (download && check) throw new Error('Use --download or --check, not both.');
const digest = input => createHash('sha256').update(input).digest('hex');
const key = chess => chess.fen().split(' ').slice(0, 4).join(' ');
const rows = [];
const inputs = [];
const excludedOrigins = new Set();
mkdirSync('book/sources', { recursive: true });
mkdirSync('book/licenses', { recursive: true });
for (const source of sources) {
  for (const file of [...source.files, source.licenseFile]) {
    const license = file === source.licenseFile;
    const target = license ? `book/licenses/${source.id}.txt` : `book/sources/${source.id}-${file}.gz`;
    if (download) {
      const url = `https://raw.githubusercontent.com/${source.repo}/${source.revision}/${file}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      let data = Buffer.from(await response.arrayBuffer());
      if (!license && file.endsWith('.json')) {
        // Do not redistribute the aggregator's differently licensed imports,
        // even inside the archived compiler inputs. Retain only bare records
        // under the two terms we ship, without aliases from other sources.
        const omittedOrigins = new Set();
        const records = {};
        for (const [fen, row] of Object.entries(JSON.parse(data.toString('utf8')))) {
          const origin = row.src ?? 'eco_js';
          if (!['eco_tsv', 'eco_js'].includes(origin)) { omittedOrigins.add(origin); continue; }
          records[fen] = { name: row.name, eco: row.eco, moves: row.moves, src: origin };
        }
        data = Buffer.from(JSON.stringify({ omittedOrigins: [...omittedOrigins].sort(), records }));
      }
      writeFileSync(target, license ? data : gzipSync(data, { level: 9 }));
    }
    const data = license ? readFileSync(target) : gunzipSync(readFileSync(target));
    inputs.push({ source: source.id, file, sha256: digest(data) });
    if (license) continue;
    if (file.endsWith('.tsv')) {
      for (const line of data.toString('utf8').trim().split('\n').slice(1)) {
        const [eco, name, moves] = line.trim().split('\t');
        rows.push({ eco, name, moves, source: source.id, origin: 'eco_tsv' });
      }
    } else {
      const snapshot = JSON.parse(data.toString('utf8'));
      snapshot.omittedOrigins.forEach(origin => excludedOrigins.add(origin));
      for (const row of Object.values(snapshot.records)) {
        rows.push({ ...row, source: source.id, origin: row.src ?? 'eco_js' });
      }
    }
  }
}

const merged = new Map();
const rejected = [];
for (const row of rows) {
  if (typeof row.name !== 'string' || typeof row.moves !== 'string') continue;
  if (!/gambit|trap|attack/i.test(row.name)) continue;
  // eco.json aggregates sources with different terms. Include its MIT original
  // records and its CC0 Lichess records; do not relicense third-party imports.
  if (!['eco_tsv', 'eco_js'].includes(row.origin)) { excludedOrigins.add(row.origin); continue; }
  const chess = new Chess();
  try { chess.loadPgn(row.moves); }
  catch { rejected.push({ source: row.source, name: row.name, reason: 'illegal PGN' }); continue; }
  const history = chess.history({ verbose: true });
  if (!history.length || history.length > 40) continue;
  let family = families.find(f => new RegExp(f.pattern, 'i').test(row.name)
    && (!f.exclude || !new RegExp(f.exclude, 'i').test(row.name)));
  if (!family) {
    const id = `auto-${digest(row.name).slice(0, 16)}`;
    family = automaticFamilies.get(id);
    if (!family) {
      family = { id, label: row.name, side: 'both',
        weight: /trap/i.test(row.name) ? 5 : /gambit/i.test(row.name) ? 4 : 3 };
      automaticFamilies.set(id, family);
      familyCatalog.push(family);
    }
  }
  const moves = history.map(move => move.from + move.to + (move.promotion ?? ''));
  const positions = history.map(move => key(new Chess(move.before)));
  const signature = family.id + ':' + moves.join(' ');
  const existing = merged.get(signature);
  const attribution = `${row.source}:${row.origin}`;
  if (existing) {
    if (!existing.sources.includes(attribution)) existing.sources.push(attribution);
  } else merged.set(signature, {
    id: digest(signature).slice(0, 16), family: family.id, name: row.name,
    moves, positions, sources: [attribution],
  });
}
// Prefer actual continuations over duplicate short prefixes of the same family.
const all = [...merged.values()];
const prefixes = new Set();
for (const line of all) for (let n = 1; n < line.moves.length; n++) {
  prefixes.add(line.family + ':' + line.moves.slice(0, n).join(' '));
}
const lines = all.filter(line => !prefixes.has(line.family + ':' + line.moves.join(' ')))
  .sort((a, b) => a.id.localeCompare(b.id, 'en'));
const positions = [...new Set(lines.flatMap(line => line.positions))].sort();
const positionIds = new Map(positions.map((fen, id) => [fen, id]));
const used = new Set(lines.map(line => line.family));
const book = {
  version: 2,
  families: familyCatalog.filter(f => used.has(f.id)).map(({ id, side, weight, label }) => ({ id, side, weight, label })),
  positions,
  lines: lines.map(({ sources: attribution, positions: path, ...line }) => ({
    ...line, path: path.map(fen => positionIds.get(fen)),
  })),
};
const report = {
  sources, inputs, excludedOrigins: [...excludedOrigins].sort(), rejected,
  families: familyCatalog.map(f => ({ id: f.id, label: f.label, side: f.side,
    lines: lines.filter(line => line.family === f.id).length })),
  attribution: lines.map(({ id, sources }) => ({ id, sources })),
};
for (const [file, data] of [['book/opening-book.json', JSON.stringify(book) + '\n'],
  ['book/provenance.json', JSON.stringify(report, null, 2) + '\n']]) {
  if (check) {
    if (readFileSync(file, 'utf8') !== data) throw new Error(`${file} is stale; run npm run book:compile`);
  } else writeFileSync(file, data);
}
console.log(`Book: ${lines.length} lines, ${used.size} families, ${positions.length} positions, ${JSON.stringify(book).length} bytes; ${rejected.length} rejected PGNs`);
