import { Chessground } from '@lichess-org/chessground';
import type { Key } from '@lichess-org/chessground/types';
import type { Square } from 'chess.js';
import { Controller } from './controller';
import { Game, colorName } from './game';
import { evaluationBar } from './evaluation';
import { gameFromHash, gameHash } from './share';
import { MoveSounds, soundForMove } from './sound';
import { icons } from './icons';
import { OpeningMemory } from './opening-memory';
import type { EngineResponse } from './engine/protocol';
import talPortrait from './assets/tal/mikhail-tal-1982.jpg';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="header">
    <div class="brand">
      <a class="tal-portrait-link" href="https://commons.wikimedia.org/wiki/File:Mikhail_Tal_1982.jpg" target="_blank" rel="noopener noreferrer" aria-label="Mikhail Tal portrait source and license" title="Mikhail Tal, 1982 · Rob C. Croes / Anefo · CC BY-SA 3.0 NL">
        <img class="tal-portrait" src="${talPortrait}" width="40" height="40" alt="Mikhail Tal in 1982">
      </a>
      <h1>talbot</h1>
    </div>
    <div class="header-tools">
    <button id="sound" class="icon-button" aria-label="Move sounds" aria-pressed="true" title="Mute">${icons.mute}</button>
    <a id="version" class="version" href="https://github.com/pathikrit/talbot/commit/${__GIT_SHA__}" target="_blank" rel="noopener noreferrer" aria-label="View running commit ${__GIT_SHA__.slice(0, 7)}" ${__GIT_SHA__ ? '' : 'hidden'}>${__GIT_SHA__.slice(0, 7)}</a>
    </div>
  </header>
  <main>
    <section class="board-area" aria-label="Chess game">
      <div class="board-messages">
        <p id="status" role="status" aria-live="polite">Loading Patricia…</p>
        <p id="result" aria-live="polite" hidden></p>
        <p id="error" role="alert" hidden></p>
        <div id="draw-actions" hidden><button id="accept-draw">Accept draw</button> <button id="decline-draw">Decline draw</button></div>
      </div>
      <div class="board-layout">
        <div id="eval-bar" class="eval-bar" role="meter" aria-label="Patricia evaluation, White's perspective" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" title="Patricia evaluation · White's perspective">
          <div id="eval-white" class="eval-white"></div><span id="eval-score">—</span>
        </div>
        <div class="board-frame"><div id="board" aria-label="Chessboard. Drag or click pieces to move."></div></div>
        <div class="captures" aria-label="Captured pieces">
          <div id="white-captures" class="captured-pieces cg-wrap" aria-label="Captured by White"></div>
          <div id="black-captures" class="captured-pieces cg-wrap" aria-label="Captured by Black"></div>
          <div id="material" class="material" title="Material only: pawn 1 · knight/bishop 3 · rook 5 · queen 9"><span id="material-side">Even</span><strong id="material-score"></strong></div>
        </div>
      </div>
      <nav class="game-controls" aria-label="Game controls">
        <button id="new-game">New game</button>
        <button id="draw">Offer draw</button>
        <button id="swap" class="icon-button" aria-label="Swap sides" title="Swap Sides">${icons.swap}</button>
        <button id="undo" class="icon-button" aria-label="Undo" aria-keyshortcuts="ArrowLeft" title="Undo Move">${icons.undo}</button>
        <button id="redo" class="icon-button" aria-label="Redo" aria-keyshortcuts="ArrowRight" title="Redo Move">${icons.redo}</button>
      </nav>
    </section>
  </main>
  <dialog id="promotion"><form method="dialog"><h2>Promote pawn</h2><div class="promotion-options"><button value="q">Queen</button><button value="r">Rook</button><button value="b">Bishop</button><button value="n">Knight</button></div><button value="cancel" class="promotion-cancel">Cancel</button></form></dialog>
`;

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const worker = new Worker(new URL('./engine/worker.ts', import.meta.url), { type: 'module' });
const sounds = new MoveSounds();
const openingMemory = new OpeningMemory();
const initialGame = gameFromHash(location.hash) ?? new Game();
const controller = new Controller(worker, render, initialGame, (move, human) => {
  if (!document.hidden) sounds.play(soundForMove(move, human));
}, openingMemory);
for (const event of ['pointerdown', 'pointerup', 'keydown']) {
  document.addEventListener(event, () => sounds.unlock(), { capture: true });
}
element('sound').addEventListener('click', () => {
  sounds.toggle();
  element('sound').innerHTML = sounds.enabled ? icons.mute : icons.unmute;
  element('sound').setAttribute('aria-pressed', String(sounds.enabled));
  element('sound').title = sounds.enabled ? 'Mute' : 'UnMute';
});
const game = controller.game;
let renderedMaterial = '';
let renderedBoard = '';
let pendingPromotion: { from: Key; to: Key; revision: number } | undefined;
const promotion = element<HTMLDialogElement>('promotion');

const board = Chessground(element('board'), {
  fen: game.chess.fen(), coordinates: true, animation: { enabled: true, duration: 160 },
  movable: { free: false, color: undefined, dests: new Map(), events: { after: onMove } },
  premovable: { enabled: false }, drawable: { enabled: true, visible: true },
  disableContextMenu: true,
});

let boardResizeFrame = 0;
new ResizeObserver(([entry]) => {
  const size = `${entry.contentRect.width}px`;
  cancelAnimationFrame(boardResizeFrame);
  boardResizeFrame = requestAnimationFrame(() => {
    element('board').closest<HTMLElement>('.board-layout')!.style.setProperty('--board-size', size);
    // Chessground caches pixel dimensions; mobile viewport changes do not always
    // trigger its window resize handler after CSS has finished reflowing.
    board.redrawAll();
  });
}).observe(element('board'));

function onMove(from: Key, to: Key): void {
  // Chessground has optimistically moved the piece; cancel/error must restore it
  // even if the authoritative chess.js FEN has not changed.
  renderedBoard = '';
  if (!controller.ready || controller.error || !game.humanTurn || game.over) { render(); return; }
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
  const hash = gameHash(game);
  if (location.hash !== hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
  const canMove = controller.ready && !controller.error && controller.visible && game.humanTurn && !game.over;
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
  const ending = game.ending();
  let evaluation = evaluationBar(controller.evaluation);
  if (game.resigned) evaluation = game.resigned === 'b'
    ? { percent: 100, label: '1–0' } : { percent: 0, label: '0–1' };
  else if (game.chess.isCheckmate()) evaluation = game.chess.turn() === 'b'
    ? { percent: 100, label: '1–0' } : { percent: 0, label: '0–1' };
  else if (game.agreedDraw || game.chess.isDraw()) evaluation = { percent: 50, label: '½–½' };
  element('eval-white').style.height = `${evaluation.percent}%`;
  element('eval-bar').classList.toggle('black', game.human === 'b');
  element('eval-bar').setAttribute('aria-valuenow', String(Math.round(evaluation.percent)));
  element('eval-bar').setAttribute('aria-valuetext', evaluation.label === '—' ? 'Waiting for evaluation' : evaluation.label);
  element('eval-score').textContent = evaluation.label;
  const routineStatus = controller.error ? 'Engine unavailable' : ending ?? {
    loading: 'Loading Patricia…', thinking: game.cursor ? 'Talbot is thinking' : 'I’ll start.', pondering: game.chess.isCheck() ? 'Your move — check' : 'Your move',
    idle: 'Game complete', paused: 'Analysis paused', error: 'Engine unavailable',
  }[controller.mode];
  element<HTMLButtonElement>('undo').disabled = !game.cursor;
  element<HTMLButtonElement>('redo').disabled = game.cursor >= game.history.length;
  element<HTMLButtonElement>('new-game').disabled = !!controller.error;
  element('new-game').textContent = game.active ? 'Resign' : 'New game';
  element('draw').textContent = controller.drawOffer === 'engine' ? 'Accept draw' : controller.drawOffer === 'human' ? 'Draw offered' : 'Offer draw';
  element<HTMLButtonElement>('draw').disabled = !controller.ready || !!controller.error || !game.active || controller.drawOffer === 'human';
  const result = ending ?? (controller.drawOffer === 'engine' ? 'Talbot offers a draw' : controller.drawNotice);
  const special = !result && !controller.error && controller.mode === 'pondering' ? controller.announcement : '';
  const status = special ? special + (game.chess.isCheck() ? ' — check!' : '') : routineStatus;
  element('status').textContent = status[0].toUpperCase() + status.slice(1);
  element('error').hidden = !controller.error;
  element('error').textContent = controller.error;
  element('result').hidden = !result;
  element('result').textContent = result ? result[0].toUpperCase() + result.slice(1) : '';
  element('status').classList.toggle('sr-only', !!result || !!controller.error);
  element('draw-actions').hidden = controller.drawOffer !== 'engine';
  const materialKey = `${game.cursor}:${game.history.map(move => move.san).join(' ')}`;
  if (materialKey !== renderedMaterial) {
    renderedMaterial = materialKey;
    const roles = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
    const captures = { w: game.captures('w'), b: game.captures('b') };
    const material = game.materialDifference;
    const ahead = material > 0 ? 'White' : 'Black';
    element('material-side').textContent = material ? ahead : 'Even';
    element('material-score').textContent = material ? `+${Math.abs(material)}` : '';
    element('material').setAttribute('aria-label', material ? `${ahead} is ahead by ${Math.abs(material)} material points` : 'Material is equal');
    const types = ['q', 'r', 'b', 'n', 'p'] as const;
    const rows = types.map(type => Math.max(...(['w', 'b'] as const).map(by => captures[by].filter(piece => piece === type).length)));
    element('board').closest<HTMLElement>('.board-layout')!.style.setProperty('--capture-rows', String(Math.max(1, rows.reduce((a, b) => a + b, 0))));
    for (const by of ['w', 'b'] as const) {
      const row = element(`${colorName(by)}-captures`);
      row.replaceChildren();
      for (const [index, captured] of types.entries()) {
        if (!rows[index]) continue;
        const slot = document.createElement('div');
        slot.className = 'capture-slot';
        slot.dataset.piece = captured;
        slot.style.height = `calc(var(--capture-size) * ${rows[index]})`;
        row.append(slot);
        const count = captures[by].filter(piece => piece === captured).length;
        for (let i = 0; i < count; i++) {
          const piece = document.createElement('piece');
          const color = by === 'w' ? 'black' : 'white';
          piece.className = `${roles[captured]} ${color}`;
          piece.setAttribute('role', 'img');
          piece.setAttribute('aria-label', `${color} ${roles[captured]}`);
          slot.append(piece);
        }
      }
    }
  }
}

for (const [id, action] of Object.entries({
  'new-game': () => game.active ? controller.resign() : controller.newGame(), swap: () => controller.swap(),
  draw: () => controller.drawOffer === 'engine' ? controller.acceptDraw() : controller.offerDraw(),
  'accept-draw': () => controller.acceptDraw(), 'decline-draw': () => controller.declineDraw(),
  undo: () => controller.undo(), redo: () => controller.redo(),
})) element(id).addEventListener('click', () => {
  pendingPromotion = undefined;
  if (promotion.open) promotion.close();
  action();
});

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || promotion.open) return;
  if (event.key === 'Escape' && controller.drawOffer === 'engine') { controller.declineDraw(); return; }
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
  const id = event.key === 'ArrowLeft' ? 'undo' : event.key === 'ArrowRight' ? 'redo' : undefined;
  if (!id) return;
  event.preventDefault();
  element<HTMLButtonElement>(id).click();
});

worker.onmessage = (event: MessageEvent<EngineResponse>) => controller.receive(event.data);
worker.onerror = () => controller.fail('The engine could not load. Check the connection, then reload this page.');
worker.onmessageerror = () => controller.fail('The engine sent an unreadable message. Reload the page to retry.');
document.addEventListener('visibilitychange', () => controller.visibility(!document.hidden));
window.addEventListener('pagehide', () => controller.visibility(false));
window.addEventListener('pageshow', () => controller.visibility(!document.hidden));
window.addEventListener('hashchange', () => {
  if (location.hash !== gameHash(game)) location.reload();
});
controller.visible = !document.hidden;
worker.postMessage({ type: 'init', assetBase: new URL(`${import.meta.env.BASE_URL}engine/`, document.baseURI).href });
const loadTimeout = setTimeout(() => {
  if (!controller.ready) controller.fail('Engine loading timed out. Check the connection, then reload this page.');
}, 30000);
window.addEventListener('pagehide', () => clearTimeout(loadTimeout));
render();
