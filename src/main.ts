import { Chessground } from '@lichess-org/chessground';
import type { Key } from '@lichess-org/chessground/types';
import type { Square } from 'chess.js';
import { Controller } from './controller';
import { colorName } from './game';
import { evaluationBar } from './evaluation';
import type { EngineResponse } from './engine/protocol';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="header">
    <h1>talbot</h1>
    <nav aria-label="Game controls">
      <button id="new-game">New game</button>
      <button id="swap">Swap sides</button>
    </nav>
  </header>
  <main>
    <section class="board-area" aria-label="Chess game">
      <div class="board-layout">
        <div id="eval-bar" class="eval-bar" role="meter" aria-label="Patricia evaluation, White's perspective" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" title="Patricia evaluation · White's perspective">
          <div id="eval-white" class="eval-white"></div><span id="eval-score">—</span>
        </div>
        <div class="board-frame"><div id="board" aria-label="Chessboard. Drag or click pieces to move."></div></div>
      </div>
      <p id="status" class="sr-only" role="status" aria-live="polite">Loading Patricia…</p>
      <p id="error" role="alert" hidden></p>
    </section>
    <section class="moves-panel" aria-labelledby="history-title">
      <div class="captures" aria-label="Captured pieces">
        <div class="capture-row"><span class="capture-label">White</span><div id="white-captures" class="captured-pieces cg-wrap" aria-label="Captured by White"></div></div>
        <div class="capture-row"><span class="capture-label">Black</span><div id="black-captures" class="captured-pieces cg-wrap" aria-label="Captured by Black"></div></div>
      </div>
      <div class="moves-header">
        <h2 id="history-title">Moves</h2>
        <div class="history-controls">
          <button id="undo" title="Undo your move and the reply">Undo</button>
          <button id="redo" title="Replay the recorded turn">Redo</button>
        </div>
      </div>
      <div id="history" class="history"></div>
      <button id="resume" hidden>Continue from here</button>
    </section>
  </main>
  <dialog id="promotion"><form method="dialog"><h2>Promote pawn</h2><div class="promotion-options"><button value="q">Queen</button><button value="r">Rook</button><button value="b">Bishop</button><button value="n">Knight</button></div><button value="cancel" class="promotion-cancel">Cancel</button></form></dialog>
`;

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const worker = new Worker(new URL('./engine/worker.ts', import.meta.url), { type: 'module' });
const controller = new Controller(worker, render);
const game = controller.game;
let renderedHistory = '';
let renderedBoard = '';
let pendingPromotion: { from: Key; to: Key; revision: number } | undefined;
const promotion = element<HTMLDialogElement>('promotion');

const board = Chessground(element('board'), {
  fen: game.chess.fen(), coordinates: true, animation: { enabled: true, duration: 160 },
  movable: { free: false, color: undefined, dests: new Map(), events: { after: onMove } },
  premovable: { enabled: false }, drawable: { enabled: true, visible: true },
  disableContextMenu: true,
});

function onMove(from: Key, to: Key): void {
  // Chessground has optimistically moved the piece; cancel/error must restore it
  // even if the authoritative chess.js FEN has not changed.
  renderedBoard = '';
  if (!controller.ready || controller.error || !game.humanTurn) { render(); return; }
  const legal = game.chess.moves({ square: from as Square, verbose: true }).filter(move => move.to === to);
  if (legal.some(move => move.promotion)) {
    pendingPromotion = { from, to, revision: controller.revision };
    promotion.returnValue = 'cancel';
    promotion.showModal();
    return;
  }
  try { controller.play(from + to); }
  catch { render(); }
}

promotion.addEventListener('close', () => {
  const pending = pendingPromotion;
  pendingPromotion = undefined;
  renderedBoard = '';
  if (pending && pending.revision === controller.revision && /^[qrbn]$/.test(promotion.returnValue)) {
    controller.play(pending.from + pending.to + promotion.returnValue);
  } else render();
});

function render(): void {
  const canMove = controller.ready && !controller.error && controller.visible && game.humanTurn && !game.chess.isGameOver();
  const last = game.history[game.cursor - 1];
  const boardKey = `${game.chess.fen()}:${game.human}:${canMove}`;
  if (boardKey !== renderedBoard) {
    renderedBoard = boardKey;
    board.set({
    fen: game.chess.fen(), orientation: colorName(game.human), turnColor: colorName(game.chess.turn()),
    check: game.chess.isCheck(), lastMove: last ? [last.from, last.to] : [],
    movable: { free: false, color: canMove ? colorName(game.human) : undefined, dests: canMove ? game.destinations() : new Map() },
    });
  }
  element('board').dataset.fen = game.chess.fen();
  element('board').dataset.orientation = colorName(game.human);
  element('board').dataset.mode = controller.mode;
  element('board').dataset.depth = String(controller.analysis?.depth ?? 0);
  element('board').setAttribute('aria-busy', String(!controller.ready || controller.mode === 'thinking'));
  element('swap').title = `Playing ${colorName(game.human)} — switch sides`;
  const ending = game.ending();
  let evaluation = evaluationBar(controller.evaluation);
  if (game.chess.isCheckmate()) evaluation = game.chess.turn() === 'b'
    ? { percent: 100, label: '1–0' } : { percent: 0, label: '0–1' };
  else if (game.chess.isDraw()) evaluation = { percent: 50, label: '½–½' };
  element('eval-white').style.height = `${evaluation.percent}%`;
  element('eval-bar').classList.toggle('black', game.human === 'b');
  element('eval-bar').setAttribute('aria-valuenow', String(Math.round(evaluation.percent)));
  element('eval-bar').setAttribute('aria-valuetext', evaluation.label === '—' ? 'Waiting for evaluation' : evaluation.label);
  element('eval-score').textContent = evaluation.label;
  const status = controller.error ? 'Engine unavailable' : ending ?? {
    loading: 'Loading Patricia…', thinking: 'Talbot is thinking', pondering: game.chess.isCheck() ? 'Your move — check' : 'Your move',
    idle: 'Game complete', paused: 'Analysis paused', error: 'Engine unavailable',
  }[controller.mode];
  element('status').textContent = status[0].toUpperCase() + status.slice(1);
  element('error').hidden = !controller.error;
  element('error').textContent = controller.error;
  element<HTMLButtonElement>('undo').disabled = !game.cursor;
  element<HTMLButtonElement>('redo').disabled = game.cursor >= game.history.length;
  element<HTMLButtonElement>('resume').hidden = !(game.reviewing && !game.humanTurn && !ending);
  element<HTMLButtonElement>('new-game').disabled = !!controller.error;
  const historyKey = `${game.cursor}:${game.history.map(move => move.san).join(' ')}`;
  if (historyKey !== renderedHistory) {
    renderedHistory = historyKey;
    const roles = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
    for (const by of ['w', 'b'] as const) {
      const row = element(`${colorName(by)}-captures`);
      row.replaceChildren();
      for (const captured of game.captures(by)) {
        const piece = document.createElement('piece');
        const color = by === 'w' ? 'black' : 'white';
        piece.className = `${roles[captured]} ${color}`;
        piece.setAttribute('role', 'img');
        piece.setAttribute('aria-label', `${color} ${roles[captured]}`);
        row.append(piece);
      }
    }
    const history = element('history');
    history.replaceChildren();
    for (let i = 0; i < game.history.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'move-row';
      const number = document.createElement('span');
      number.className = 'move-number';
      number.textContent = `${i / 2 + 1}.`;
      row.append(number);
      for (const index of [i, i + 1]) {
        const move = game.history[index];
        const cell = document.createElement('span');
        cell.className = `move${index >= game.cursor ? ' future' : ''}${index === game.cursor - 1 ? ' current' : ''}`;
        cell.textContent = move?.san ?? '';
        row.append(cell);
      }
      history.append(row);
    }
    const current = history.querySelector<HTMLElement>('.current');
    if (current) history.scrollTop = current.offsetTop - history.clientHeight / 2;
  }
}

for (const [id, action] of Object.entries({
  'new-game': () => controller.newGame(), swap: () => controller.swap(),
  undo: () => controller.undo(), redo: () => controller.redo(), resume: () => controller.resume(),
})) element(id).addEventListener('click', () => {
  pendingPromotion = undefined;
  if (promotion.open) promotion.close();
  action();
});

worker.onmessage = (event: MessageEvent<EngineResponse>) => controller.receive(event.data);
worker.onerror = () => controller.fail('The engine could not load. Check the connection, then reload this page.');
worker.onmessageerror = () => controller.fail('The engine sent an unreadable message. Reload the page to retry.');
document.addEventListener('visibilitychange', () => controller.visibility(!document.hidden));
window.addEventListener('pagehide', () => controller.visibility(false));
window.addEventListener('pageshow', () => controller.visibility(!document.hidden));
controller.visible = !document.hidden;
worker.postMessage({ type: 'init', assetBase: new URL(`${import.meta.env.BASE_URL}engine/`, document.baseURI).href });
const loadTimeout = setTimeout(() => {
  if (!controller.ready) controller.fail('Engine loading timed out. Check the connection, then reload this page.');
}, 30000);
window.addEventListener('pagehide', () => clearTimeout(loadTimeout));
render();
