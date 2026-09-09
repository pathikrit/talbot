import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const workerAsset = readdirSync(new URL('../../dist/assets/', import.meta.url)).find(name => /^worker-.*\.js$/.test(name))!;

test('the production worker selects the largest declined sacrifice within 50cp and returns its own PV', async ({ page }) => {
  // Exercise the actual bundled worker/selector with deterministic Patricia
  // output; separate app tests exercise real WASM searches and timing.
  await page.route('**/harness.html', route => route.fulfill({ contentType: 'text/html', body: '<title>Worker test</title>' }));
  await page.route('**/fixture/patricia.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    export default async function({ print }) {
      return { ccall(name) {
        if (name === 'talbot_position') return 1;
        if (name === 'talbot_search') {
          print('info depth 7 multipv 1 score cp 50 pv h1g1 a8b8');
          print('info depth 7 multipv 2 score cp 40 pv b2b4 a8b8');
          print('info depth 7 multipv 3 score cp 0 pv g2e3 a8b8');
          print('bestmove h1g1');
          return Promise.resolve();
        }
      }};
    }
  ` }));
  await page.goto('./harness.html');
  const response = await page.evaluate(async asset => {
    const worker = new Worker(new URL(`assets/${asset}`, location.href), { type: 'module' });
    try {
      return await new Promise<{ move: string; selected?: { pv: string[]; score: { value: number } } }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Worker timed out')), 3000);
        worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') worker.postMessage({
            type: 'search', id: 1, multipv: 3,
            position: { fen: 'k7/8/8/p7/3p4/8/1P4N1/7K w - - 0 1', moves: [] },
            deadline: performance.timeOrigin + performance.now() + 1000,
          });
          if (data.type === 'bestmove') { clearTimeout(timer); resolve(data); }
          if (data.type === 'error') { clearTimeout(timer); reject(new Error(data.message)); }
        };
        worker.postMessage({ type: 'init', assetBase: new URL('fixture/', location.href).href });
      });
    } finally { worker.terminate(); }
  }, workerAsset);
  expect(response.move).toBe('g2e3');
  expect(response.selected?.pv).toEqual(['g2e3', 'a8b8']);
  expect(response.selected?.score.value).toBe(0);
});
