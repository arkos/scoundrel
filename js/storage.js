/**
 * storage.js — LocalStorage persistence.
 *
 * The full game state is saved after every action, so reloading the page
 * resumes exactly where you left off. The state also carries its seed, which
 * lets "Restart" rebuild the identical starting dungeon.
 *
 * All access is wrapped in try/catch: storage may be unavailable (private
 * browsing, blocked cookies, quota) and the game must still be playable.
 */
(function (NS) {
  'use strict';

  const GAME_KEY = 'scoundrel.game.v1';
  const PREFS_KEY = 'scoundrel.prefs.v1';

  function read(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function write(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  function remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (err) {
      /* storage unavailable — nothing to clear */
    }
  }

  /** Load a saved game, discarding anything that does not look valid. */
  function loadGame() {
    const state = read(GAME_KEY);
    return NS.game.isValidState(state) ? state : null;
  }

  NS.storage = {
    loadGame,
    saveGame: (state) => write(GAME_KEY, state),
    clearGame: () => remove(GAME_KEY),
    loadPrefs: () => read(PREFS_KEY) || {},
    savePrefs: (prefs) => write(PREFS_KEY, prefs),
  };
})((window.Scoundrel = window.Scoundrel || {}));
