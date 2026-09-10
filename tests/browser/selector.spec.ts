import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { DEFAULT_POSITION } from 'chess.js';
import type { BookData } from '../../src/engine/openings';

const openingData = JSON.parse(readFileSync(new URL('../../book/opening-book.json', import.meta.url), 'utf8')) as BookData;

const workerAsset = readdirSync(new URL('../../dist/assets/', import.meta.url)).find(name => /^worker-.*\.js$/.test(name))!;

test('the staged production worker deepens and selects a future declined sacrifice within 75cp', async ({ page }) => {
  // Exercise the actual bundled worker/selector with deterministic Patricia
  // output; separate app tests exercise real WASM searches and timing.
  await page.route('**/harness.html', route => route.fulfill({ contentType: 'text/html', body: '<title>Worker test</title>' }));
  await page.route('**/fixture/patricia.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    export default async function({ print }) {
      return { ccall(name) {
        if (name === 'talbot_position') return 1;
        if (name === 'talbot_search' || name === 'talbot_search_moves') {
          const depth = name === 'talbot_search' ? 4 : 8;
          print('info depth ' + depth + ' multipv 1 score cp 75 pv h1h2 a8b8');
          print('info depth ' + depth + ' multipv 2 score cp 0 pv h1g1 a8b8 e3e4 b8a8');
          print('bestmove h1h2');
          return Promise.resolve();
        }
      }};
    }
  ` }));
  await page.goto('./harness.html');
  const response = await page.evaluate(async asset => {
    const worker = new Worker(new URL(`assets/${asset}`, location.href), { type: 'module' });
    try {
      return await new Promise<{ move: string; selected?: { depth: number; pv: string[]; score: { value: number } }; decision?: unknown }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Worker timed out')), 3000);
        worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') worker.postMessage({
            type: 'search', id: 1, multipv: 2,
            position: { fen: 'k7/8/8/3p4/8/4P3/8/7K w - - 0 1', moves: [] },
            deadline: performance.timeOrigin + performance.now() + 1000,
          });
          if (data.type === 'bestmove') { clearTimeout(timer); resolve(data); }
          if (data.type === 'error') { clearTimeout(timer); reject(new Error(data.message)); }
        };
        worker.postMessage({ type: 'init', assetBase: new URL('fixture/', location.href).href });
      });
    } finally { worker.terminate(); }
  }, workerAsset);
  expect(response.move).toBe('h1g1');
  expect(response.selected?.pv).toEqual(['h1g1', 'a8b8', 'e3e4', 'b8a8']);
  expect(response.selected?.score.value).toBe(0);
  expect(response.selected?.depth).toBe(8);
  expect(response.decision).toEqual({ sacrifice: { piece: 'pawn', insteadOf: 'h1h2' } });
});

test('the production worker avoids an immediate repetition within the configured 1cp', async ({ page }) => {
  await page.route('**/harness.html', route => route.fulfill({ contentType: 'text/html', body: '<title>Worker test</title>' }));
  await page.route('**/fixture/patricia.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    export default async function({ print }) {
      return { ccall(name) {
        if (name === 'talbot_position') return 1;
        if (name === 'talbot_search' || name === 'talbot_search_moves') {
          const depth = name === 'talbot_search' ? 4 : 8;
          print('info depth ' + depth + ' multipv 1 score cp 20 pv f6g8');
          print('info depth ' + depth + ' multipv 2 score cp 19 pv b8c6');
          print('bestmove f6g8');
          return Promise.resolve();
        }
      }};
    }
  ` }));
  await page.goto('./harness.html');
  const response = await page.evaluate(async ({ asset, fen }) => {
    const worker = new Worker(new URL(`assets/${asset}`, location.href), { type: 'module' });
    try {
      return await new Promise<{ move: string; selected?: { pv: string[]; score: { value: number } } }>((resolve, reject) => {
        const seen: unknown[] = [];
        const timer = setTimeout(() => reject(new Error(`Worker timed out after ${JSON.stringify(seen)}`)), 3000);
        worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
        worker.onmessage = ({ data }) => {
          seen.push(data);
          if (data.type === 'ready') worker.postMessage({
            type: 'search', id: 1, multipv: 2,
            position: {
              fen,
              moves: ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1'],
            },
            deadline: performance.timeOrigin + performance.now() + 1000,
          });
          if (data.type === 'bestmove') { clearTimeout(timer); resolve(data); }
          if (data.type === 'error') { clearTimeout(timer); reject(new Error(data.message)); }
        };
        worker.postMessage({ type: 'init', assetBase: new URL('fixture/', location.href).href });
      });
    } finally { worker.terminate(); }
  }, { asset: workerAsset, fen: DEFAULT_POSITION });
  expect(response.move).toBe('b8c6');
  expect(response.selected?.pv[0]).toBe('b8c6');
  expect(response.selected?.score.value).toBe(19);
});

test('bundled book follows its plan, falls back when invalid, and retires it for a verified sacrifice', async ({ page }) => {
  const lineId = openingData.lines.find(line => line.family === 'evans')!.id;
  await page.route('**/harness.html', route => route.fulfill({ contentType: 'text/html', body: '<title>Book test</title>' }));
  await page.route('**/fixture/patricia.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    export default async function({ print }) {
      let search = 0;
      return { ccall(name) {
        if (name === 'talbot_position') return 1;
        if (name === 'talbot_search' || name === 'talbot_search_moves') {
          if (name === 'talbot_search') search++;
          print('info depth 7 multipv 1 score cp 40 pv b1c3');
          print('info depth 7 multipv 2 score cp ' + (search === 3 ? -36 : 0) + ' pv g1f3');
          if (search === 4) print('info depth 7 multipv 3 score cp 0 pv f2f4 e5f4 g1f3 d7d6');
          print('bestmove b1c3');
          return Promise.resolve();
        }
      }};
    }
  ` }));
  await page.goto('./harness.html');
  const responses = await page.evaluate(async ({ asset, line, fen }) => {
    const worker = new Worker(new URL(`assets/${asset}`, location.href), { type: 'module' });
    try {
      return await new Promise<{ move: string; opening: string | null; decision?: unknown }[]>((resolve, reject) => {
        const replies: { move: string; opening: string | null; decision?: unknown }[] = [];
        const timer = setTimeout(() => reject(new Error('Book worker timed out')), 5000);
        const search = () => worker.postMessage({
          type: 'search', id: replies.length + 1, multipv: replies.length === 3 ? 3 : 2, opening: line,
          position: { fen, moves: ['e2e4', replies.length === 1 ? 'c7c5' : 'e7e5'] },
          deadline: performance.timeOrigin + performance.now() + 1000,
        });
        worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') search();
          if (data.type === 'bestmove') {
            replies.push(data);
            if (replies.length === 4) { clearTimeout(timer); resolve(replies); }
            else search();
          }
          if (data.type === 'error') { clearTimeout(timer); reject(new Error(data.message)); }
        };
        worker.postMessage({ type: 'init', assetBase: new URL('fixture/', location.href).href });
      });
    } finally { worker.terminate(); }
  }, { asset: workerAsset, line: lineId, fen: DEFAULT_POSITION });
  expect(responses[0]).toMatchObject({ move: 'g1f3', opening: lineId,
    decision: { opening: 'Evans Gambit' } });
  expect(responses[1]).toMatchObject({ move: 'b1c3', opening: null });
  expect(responses[2]).toMatchObject({ move: 'b1c3', opening: null });
  expect(responses[3]).toMatchObject({ move: 'f2f4', opening: null,
    selected: { depth: 7, score: { kind: 'cp', value: 0 }, pv: ['f2f4', 'e5f4', 'g1f3', 'd7d6'] },
    decision: { sacrifice: { piece: 'pawn', insteadOf: 'b1c3' } } });
});
