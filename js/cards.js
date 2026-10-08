/**
 * cards.js — Card model, dungeon construction and naming helpers.
 *
 * A card is a plain, serialisable object so the whole game state can be
 * stored in LocalStorage as JSON:
 *   { id: 'S13', suit: 'S', rank: 13, type: 'monster' }
 */
(function (NS) {
  'use strict';

  const SUITS = {
    S: { symbol: '♠', name: 'Spades', type: 'monster' },
    C: { symbol: '♣', name: 'Clubs', type: 'monster' },
    D: { symbol: '♦', name: 'Diamonds', type: 'weapon' },
    H: { symbol: '♥', name: 'Hearts', type: 'potion' },
  };

  const FACE_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const FACE_NAME = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
  const TYPE_NAME = { monster: 'Monster', weapon: 'Weapon', potion: 'Potion' };

  function makeCard(suit, rank) {
    return { id: suit + rank, suit, rank, type: SUITS[suit].type };
  }

  /**
   * Build the 44-card dungeon from a standard 52-card deck:
   *   - Jokers are never added.
   *   - Red face cards (J/Q/K of ♥♦) and red Aces are removed:
   *     red suits only contribute ranks 2–10.
   *   Result: 26 monsters (♠♣ 2–A) + 9 weapons (♦ 2–10) + 9 potions (♥ 2–10).
   */
  function buildDungeon() {
    const cards = [];
    for (const suit of ['S', 'C']) {
      for (let rank = 2; rank <= 14; rank++) cards.push(makeCard(suit, rank));
    }
    for (const suit of ['D', 'H']) {
      for (let rank = 2; rank <= 10; rank++) cards.push(makeCard(suit, rank));
    }
    return cards;
  }

  const rankLabel = (card) => FACE_LABEL[card.rank] || String(card.rank);
  const symbol = (card) => SUITS[card.suit].symbol;

  /** Compact label used in the log and HUD, e.g. "♦7", "♠K". */
  const short = (card) => symbol(card) + rankLabel(card);

  /** Screen-reader friendly name, e.g. "Monster, King of Spades (value 13)". */
  function long(card) {
    const rankName = FACE_NAME[card.rank] || String(card.rank);
    return `${TYPE_NAME[card.type]}, ${rankName} of ${SUITS[card.suit].name} (value ${card.rank})`;
  }

  NS.cards = { SUITS, TYPE_NAME, buildDungeon, rankLabel, symbol, short, long };
})((window.Scoundrel = window.Scoundrel || {}));
