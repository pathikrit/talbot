import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Chess, DEFAULT_POSITION } from 'chess.js';

async function ready(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText('Your move');
  await expect(page.locator('#board')).toHaveAttribute('data-depth', /^[1-9]\d*$/);
}
async function move(page: Page, from: string, to: string): Promise<void> {
  const board = page.locator('#board');
  const bounds = (await board.boundingBox())!;
  const flipped = await board.getAttribute('data-orientation') === 'black';
  const coordinate = (square: string) => {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]) - 1;
    return { x: bounds.width * ((flipped ? 7 - file : file) + .5) / 8, y: bounds.height * ((flipped ? rank : 7 - rank) + .5) / 8 };
  };
  await board.click({ position: coordinate(from) });
  await board.click({ position: coordinate(to) });
}
async function fen(page: Page): Promise<string> { return (await page.locator('#board').getAttribute('data-fen'))!; }

test('loads at a repository subpath, plays on the board, replies in one second, and replays a turn', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await expect(page.locator('piece')).toHaveCount(33); // 32 pieces plus Chessground drag ghost.
  await move(page, 'e2', 'e4');
  const started = Date.now();
  await expect(page.getByRole('status')).toHaveText('Talbot is thinking');
  await expect(page.locator('.move:not(.future)')).toHaveCount(2);
  await expect(page.getByRole('status')).toHaveText('Your move', { timeout: 2500 });
  const elapsed = Date.now() - started;
  expect(elapsed).toBeGreaterThan(800);
  expect(elapsed).toBeLessThan(2000);
  const afterReply = await fen(page);
  const chess = new Chess(afterReply);
  expect(chess.turn()).toBe('w');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await fen(page)).toBe(DEFAULT_POSITION);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(await fen(page)).toBe(afterReply);
  await page.keyboard.press('ArrowLeft');
  expect(await fen(page)).toBe(DEFAULT_POSITION);
  await page.keyboard.press('ArrowRight');
  expect(await fen(page)).toBe(afterReply);
  await page.keyboard.press('Shift+ArrowLeft');
  expect(await fen(page)).toBe(afterReply);
  expect(errors).toEqual([]);
  await expect(page.locator('piece.anim')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('talbot.png'), fullPage: true });
});

test('switches sides during search and cancels obsolete replies', async ({ page }) => {
  await ready(page);
  await move(page, 'e2', 'e4');
  await page.getByRole('button', { name: 'Swap sides' }).click();
  await expect(page.locator('#board')).toHaveAttribute('data-orientation', 'black');
  await expect(page.getByRole('status')).toHaveText('Your move');
  await move(page, 'e7', 'e5');
  await expect(page.getByRole('status')).toHaveText('Talbot is thinking');
  await page.getByRole('button', { name: 'New game' }).click();
  // New game retains the chosen side, so Patricia now makes White's first move.
  await expect(page.getByRole('status')).toHaveText('Your move', { timeout: 2500 });
  expect(new Chess(await fen(page)).turn()).toBe('b');
  expect((await fen(page)).split(' ')[5]).toBe('1');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await fen(page)).toBe(DEFAULT_POSITION);
  await expect(page.getByRole('button', { name: 'Continue from here' })).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Your move');
});

test('keeps playing without a network after loading', async ({ page, context }) => {
  await ready(page);
  await context.setOffline(true);
  await move(page, 'd2', 'd4');
  await expect(page.getByRole('status')).toHaveText('Talbot is thinking');
  await expect(page.getByRole('status')).toHaveText('Your move', { timeout: 2500 });
  expect(new Chess(await fen(page)).turn()).toBe('w');
});

test('shows an explicit engine loading failure', async ({ page }) => {
  await page.route('**/engine/patricia.js', route => route.abort());
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText('Engine unavailable');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#board')).toHaveAttribute('data-mode', 'error');
});

test('pauses a pending reply while hidden and starts a fresh reply on return', async ({ page }) => {
  await ready(page);
  await move(page, 'e2', 'e4');
  await expect(page.getByRole('status')).toHaveText('Talbot is thinking');
  const pending = await fen(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('status')).toHaveText('Analysis paused');
  // Intentionally cross the original reply deadline to catch a stale commit.
  await page.waitForTimeout(1200);
  expect(await fen(page)).toBe(pending);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('status')).toHaveText('Talbot is thinking');
  await expect(page.getByRole('status')).toHaveText('Your move', { timeout: 2500 });
  expect(new Chess(await fen(page)).turn()).toBe('w');
});

test('has no horizontal overflow at the project viewport', async ({ page }) => {
  await ready(page);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
  const bounds = (await page.locator('#board').boundingBox())!;
  expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
});

test('offers underpromotion and restores the board when promotion is cancelled', async ({ page }) => {
  // Deterministic opponent for this UI-only scenario. Engine legality and search
  // are tested separately against real WASM; no production test hooks are used.
  await page.addInitScript(() => {
    class PromotionOpponent {
      onmessage?: (event: { data: unknown }) => void;
      postMessage(message: { type: string; id: number; deadline?: number; position?: { moves: string[] } }) {
        const emit = (data: unknown) => setTimeout(() => this.onmessage?.({ data }), 0);
        if (message.type === 'init') emit({ type: 'ready' });
        if (message.type === 'search') {
          emit({ type: 'info', id: message.id, analysis: { depth: 1, multipv: 1, score: { kind: 'cp', value: 0 }, nodes: 20, nps: 20, time: 1, pv: [] } });
          if (message.deadline !== undefined) {
            const replies = ['h7h5', 'h5h4', 'h4h3', 'h3g2', 'g2h1n'];
            const index = Math.floor((message.position!.moves.length - 1) / 2);
            emit({ type: 'bestmove', id: message.id, move: replies[index] });
          }
        }
      }
    }
    window.Worker = PromotionOpponent as unknown as typeof Worker;
  });
  await ready(page);
  for (const [from, to] of [['a2', 'a4'], ['a4', 'a5'], ['a5', 'a6'], ['a6', 'b7']]) {
    await move(page, from, to);
    await expect(page.getByRole('status')).toHaveText('Talbot is thinking');
    await expect(page.getByRole('status')).toHaveText('Your move');
  }
  const before = await fen(page);
  await expect(page.locator('#white-captures piece.black.pawn')).toHaveCount(1);
  await expect(page.locator('#black-captures piece.white.pawn')).toHaveCount(1);
  await move(page, 'b7', 'a8');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await fen(page)).toBe(before);
  await expect(page.locator('piece.anim')).toHaveCount(0);
  await move(page, 'b7', 'a8');
  await page.getByRole('button', { name: 'Knight', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  // Chromium dispatches the dialog close event after it becomes invisible.
  await expect.poll(async () => new Chess(await fen(page)).get('a8')?.type).toBe('n');
  await expect(page.locator('#white-captures piece.black.rook')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#white-captures piece.black.rook')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('#white-captures piece.black.rook')).toHaveCount(1);
});

test('shows only the compact game interface', async ({ page }) => {
  await ready(page);
  await expect(page).toHaveTitle('talbot');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('talbot');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Moves');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  for (const name of ['Undo', 'Redo']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toHaveText(name);
    await expect(button).toHaveAttribute('aria-keyshortcuts', name === 'Undo' ? 'ArrowLeft' : 'ArrowRight');
    await expect(button).toHaveAttribute('title', /.+/);
  }
  await expect(page.getByRole('meter')).toBeVisible();
  await expect(page.locator('#eval-score')).not.toHaveText('—');
  const bar = (await page.locator('#eval-bar').boundingBox())!;
  const board = (await page.locator('#board').boundingBox())!;
  expect(bar.x + bar.width).toBeLessThan(board.x);
  const captures = (await page.locator('.captures').boundingBox())!;
  const moves = (await page.locator('.moves-header').boundingBox())!;
  expect(captures.y + captures.height).toBeLessThanOrEqual(moves.y + 1);
  await expect(page.locator('footer, .intro, .status-card, .player-row, details, #move-form')).toHaveCount(0);
  const box = await page.locator('#history').boundingBox();
  expect(box!.height).toBeGreaterThan(150);
});
