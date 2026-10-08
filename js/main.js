/**
 * main.js — Controller: wires user input to the rules engine, persists
 * every change to LocalStorage, and asks the UI to re-render.
 *
 * Flow for every action:
 *   input → clone state → game.<action>(clone) → save → ui.render(next, prev)
 */
(function (NS) {
  'use strict';

  const { game, storage, ui, rng } = NS;

  let state = null;
  let busy = false; // blocks double-activation while a card animates out
  const prefs = storage.loadPrefs();

  /* ------------------------------------------------------------------ */
  /* State transitions                                                   */
  /* ------------------------------------------------------------------ */

  function commit(next, opts = {}) {
    const prev = state;
    state = next;
    storage.saveGame(state);
    ui.render(state, prev, opts);

    const justEnded = state.status !== 'playing' && (!prev || prev.status === 'playing' || opts.showEnd);
    if (justEnded) handleEnd();
  }

  async function handleEnd() {
    // Give the final card/health animation a moment before the modal.
    await wait(ui.reducedMotion() ? 0 : 650);
    const choice = await ui.showEnd(state);
    if (choice === 'new') startNewGame();
    else if (choice === 'restart') restartGame();
  }

  function startNewGame(seed) {
    commit(game.createGame(seed || rng.randomSeed()));
    ui.el.room.focus({ preventScroll: true });
  }

  /** Restart = replay the exact same dungeon (same seed → same shuffle). */
  function restartGame() {
    commit(game.createGame(state.seed));
    ui.el.room.focus({ preventScroll: true });
  }

  /** Ask before throwing away a game the player has made progress in. */
  function inProgress() {
    return state.status === 'playing' && (state.turn > 1 || state.resolvedThisRoom > 0);
  }

  async function requestNewGame() {
    if (inProgress()) {
      const ok = await ui.confirm({
        title: 'Start a new dungeon?',
        message: 'Your current run will be abandoned and a freshly shuffled dungeon will be dealt.',
        okLabel: 'New game',
      });
      if (!ok) return;
    }
    startNewGame();
  }

  async function requestRestart() {
    if (inProgress()) {
      const ok = await ui.confirm({
        title: 'Restart this dungeon?',
        message: `You will start over from turn 1 with the same card order (seed “${state.seed}”).`,
        okLabel: 'Restart',
      });
      if (!ok) return;
    }
    restartGame();
  }

  async function playCard(slot, useAlt) {
    if (busy || state.status !== 'playing') return;
    const desc = game.describe(state, slot);
    if (!desc) return;

    const option = useAlt ? desc.alt : desc.primary;
    if (!option) {
      // Shift+N on a card with no alternative: explain instead of guessing.
      ui.announce('Bare-handed is the only option for that card, or it is not a monster.');
      return;
    }

    busy = true;
    try {
      await ui.animateResolve(slot);
      const next = game.clone(state);
      const result = game.resolveCard(next, slot, option.mode);
      if (!result.ok) {
        ui.announce(result.reason);
        ui.render(state, state); // undo the leave animation
        return;
      }
      commit(next, { event: result.event, focusSlot: slot });
    } finally {
      busy = false;
    }
  }

  function avoid() {
    if (busy) return;
    const reason = game.avoidBlocker(state);
    if (reason) {
      ui.announce(reason);
      ui.nudge(ui.el.btnAvoid);
      return;
    }
    const next = game.clone(state);
    const result = game.avoidRoom(next);
    commit(next, { event: result.event });
    focusFirstCard();
  }

  function focusFirstCard() {
    const first = ui.el.roomGrid.querySelector('.card__btn:not(:disabled)');
    (first || ui.el.room).focus({ preventScroll: true });
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    const { el } = ui;

    document.getElementById('btn-new').addEventListener('click', requestNewGame);
    el.btnRestart.addEventListener('click', requestRestart);
    document.getElementById('btn-help').addEventListener('click', ui.openHelp);
    el.btnAvoid.addEventListener('click', avoid);

    // Event delegation for card buttons (they are re-created every render).
    el.roomGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-slot]');
      if (!btn || btn.disabled) return;
      playCard(Number(btn.dataset.slot), btn.dataset.action === 'alt');
    });

    // Debug panel
    el.btnDebug.addEventListener('click', () => {
      const open = el.debugPanel.hidden;
      ui.setDebugOpen(open);
      storage.savePrefs({ ...prefs, debug: open });
      prefs.debug = open;
      ui.renderDebug(state);
    });
    el.debugReveal.addEventListener('change', () => ui.renderDebug(state));
    document.getElementById('debug-seed-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const seed = el.debugSeedInput.value.trim();
      if (seed) startNewGame(seed);
    });
    document.getElementById('debug-clear').addEventListener('click', () => {
      storage.clearGame();
      ui.announce('Saved game cleared. The current game will be saved again on your next action.');
    });

    document.addEventListener('keydown', onKeyDown);
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (ui.anyDialogOpen()) return; // <dialog> handles Esc and focus itself
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // e.code keeps Shift+1 working on any keyboard layout ("!" vs "1").
    const digit = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
    if (digit) {
      e.preventDefault();
      playCard(Number(digit[1]) - 1, e.shiftKey);
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'a':
        e.preventDefault();
        avoid();
        break;
      case 'n':
        e.preventDefault();
        requestNewGame();
        break;
      case 'r':
        e.preventDefault();
        requestRestart();
        break;
      case '?':
      case 'h':
        e.preventDefault();
        ui.openHelp();
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  function boot() {
    ui.init();
    bindEvents();
    ui.setDebugOpen(!!prefs.debug || new URLSearchParams(location.search).has('debug'));

    const saved = storage.loadGame();
    if (saved) {
      commit(saved, { showEnd: saved.status !== 'playing' });
    } else {
      commit(game.createGame(rng.randomSeed()));
      if (!prefs.seenHelp) {
        prefs.seenHelp = true;
        storage.savePrefs(prefs);
        ui.openHelp();
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})((window.Scoundrel = window.Scoundrel || {}));
