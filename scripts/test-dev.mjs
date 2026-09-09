// Exercise the actual running dev URL, not the production test server.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { Chess } from 'chess.js';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  for (const url of ['http://localhost:5173/', 'http://127.0.0.1:5173/']) {
    await page.goto(url);
    await page.getByRole('status').filter({ hasText: /^Your move$/ }).waitFor();
    const board = page.locator('#board');
    const bounds = await board.boundingBox();
    await board.click({ position: { x: bounds.width * 4.5 / 8, y: bounds.height * 6.5 / 8 } });
    await board.click({ position: { x: bounds.width * 4.5 / 8, y: bounds.height * 4.5 / 8 } });
    await page.getByRole('status').filter({ hasText: /^Talbot is thinking$/ }).waitFor();
    await page.getByRole('status').filter({ hasText: /^Your move$/ }).waitFor();
    const chess = new Chess(await page.locator('#board').getAttribute('data-fen'));
    assert.equal(chess.turn(), 'w');
    assert.equal(chess.fen().split(' ')[5], '2');
    assert.deepEqual(errors, []);
    console.log(`PASS live dev startup and engine reply: ${url}`);
  }
  // A failed entry module shows a useful message instead of an empty #app.
  await page.route('**/src/main.ts*', route => route.abort());
  await page.goto('http://localhost:5173/');
  await page.getByRole('alert').filter({ hasText: 'Talbot could not load' }).waitFor();
  console.log('PASS startup failure message');
} finally { await browser.close(); }
