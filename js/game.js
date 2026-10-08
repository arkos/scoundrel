/**
 * game.js — The Scoundrel rules engine.
 *
 * Pure game logic: no DOM access. Every action takes a state object and
 * mutates it in place (the controller clones before calling, so the previous
 * state is kept around for render diffing and animations).
 *
 * State shape (fully JSON-serialisable for LocalStorage):
 * {
 *   version, seed, createdAt,
 *   health,                 // 0–20
 *   deck: Card[],           // deck[0] is the TOP of the dungeon
 *   room: (Card|null)[4],   // fixed 4 slots; null = resolved/empty slot
 *   discard: Card[],
 *   weapon: { card, stack: Card[] } | null,   // stack = monsters slain with it
 *   turn,                   // room counter, starts at 1
 *   avoidedLast,            // true if the previous room was avoided
 *   potionUsed,             // a potion has already healed in this room
 *   resolvedThisRoom,       // cards resolved in the current room
 *   status: 'playing' | 'won' | 'lost',
 *   score: number | null,
 *   stats: { slain, damageTaken, healed, potionsWasted, avoids },
 *   log: { id, turn, kind, text }[], logSeq
 * }
 */
(function (NS) {
  'use strict';

  const { cards } = NS;

  const STATE_VERSION = 1;
  const MAX_HEALTH = 20;
  const ROOM_SIZE = 4;
  const RESOLVE_PER_ROOM = 3; // the 4th card carries over to the next room
  const LOG_LIMIT = 250;

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  const clone = (state) => JSON.parse(JSON.stringify(state));
  const roomCards = (s) => s.room.filter(Boolean);
  const isFinalRoom = (s) => s.deck.length === 0;

  function addLog(s, text, kind = 'info') {
    s.logSeq += 1;
    s.log.push({ id: s.logSeq, turn: s.turn, kind, text });
    if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
  }

  /** Last monster slain with the current weapon, or null for a fresh weapon. */
  function lastDefeated(s) {
    if (!s.weapon || s.weapon.stack.length === 0) return null;
    return s.weapon.stack[s.weapon.stack.length - 1];
  }

  /** Sum of every monster still in the dungeon (deck + unresolved room cards). */
  function remainingMonsterValue(s) {
    return s.deck
      .concat(roomCards(s))
      .filter((c) => c.type === 'monster')
      .reduce((sum, c) => sum + c.rank, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Setup                                                               */
  /* ------------------------------------------------------------------ */

  function createGame(seed) {
    seed = String(seed);
    const deck = NS.rng.shuffle(cards.buildDungeon(), NS.rng.create(seed));
    const s = {
      version: STATE_VERSION,
      seed,
      createdAt: Date.now(),
      health: MAX_HEALTH,
      deck,
      room: [],
      discard: [],
      weapon: null,
      turn: 0,
      avoidedLast: false,
      potionUsed: false,
      resolvedThisRoom: 0,
      status: 'playing',
      score: null,
      stats: { slain: 0, damageTaken: 0, healed: 0, potionsWasted: 0, avoids: 0 },
      log: [],
      logSeq: 0,
    };
    addLog(s, `A new dungeon awaits (seed “${seed}”). 44 cards shuffled.`, 'info');
    startRoom(s);
    return s;
  }

  /**
   * Begin a new room: keep any carried-over card(s) first, then draw from the
   * top of the deck until 4 cards are visible (or the deck runs out).
   *
   * Example: you resolved ♠5, ♦3 and ♥4 and left ♣9 behind.
   *   Next room = [♣9, draw, draw, draw]  — ♣9 is the first card.
   */
  function startRoom(s) {
    const carried = roomCards(s);
    const drawn = [];
    while (carried.length + drawn.length < ROOM_SIZE && s.deck.length > 0) {
      drawn.push(s.deck.shift());
    }

    s.room = carried.concat(drawn);
    while (s.room.length < ROOM_SIZE) s.room.push(null);

    s.turn += 1;
    s.potionUsed = false;
    s.resolvedThisRoom = 0;

    const parts = [];
    if (carried.length) parts.push(`carried ${carried.map(cards.short).join(', ')}`);
    if (drawn.length) parts.push(`drew ${drawn.map(cards.short).join(', ')}`);
    addLog(s, `Room ${s.turn}: ${parts.join(' · ')}.`, 'room');

    if (isFinalRoom(s)) {
      addLog(s, 'The deck is empty: this is the final room. Resolve every card.', 'info');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Avoiding a room                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Returns null if the room may be avoided, otherwise a human reason.
   *
   * Avoid restriction, worked example:
   *   Room 3: avoid → its 4 cards go to the bottom of the deck, Room 4 is drawn.
   *   Room 4: avoid is LOCKED (no two avoids in a row). You must face it.
   *   Room 5: after facing Room 4, avoid is available again.
   */
  function avoidBlocker(s) {
    if (s.status !== 'playing') return 'The game is over.';
    if (s.avoidedLast) return 'You avoided the previous room. This one must be faced.';
    if (s.resolvedThisRoom > 0) return 'You have already started facing this room.';
    if (s.deck.length === 0) return 'The deck is empty, so there is nowhere left to flee.';
    return null;
  }

  function avoidRoom(s) {
    const reason = avoidBlocker(s);
    if (reason) return { ok: false, reason };

    // Keep the room's left-to-right order when sliding it under the deck.
    const fled = roomCards(s);
    s.deck.push(...fled);
    s.room = [];
    s.avoidedLast = true;
    s.stats.avoids += 1;
    addLog(s, `Avoided the room. ${fled.map(cards.short).join(', ')} moved to the bottom of the deck.`, 'avoid');

    startRoom(s);
    return { ok: true, event: { kind: 'avoid', newRoom: true } };
  }

  /* ------------------------------------------------------------------ */
  /* Weapons                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Non-increasing weapon rule.
   *
   * A weapon may only be used on a monster whose value is ≤ the value of the
   * LAST monster it defeated. A fresh weapon (no kills yet) can hit anything.
   *
   * Worked example with ♦5:
   *   Equip ♦5            → last defeated: —     (may attack anything)
   *   Attack ♠J (11)      → take 11 − 5 = 6      last defeated: 11
   *   Attack ♣9 (9 ≤ 11)  ✔ take 9 − 5 = 4       last defeated: 9
   *   Attack ♠9 (9 ≤ 9)   ✔ equal is allowed     last defeated: 9
   *   Attack ♣3 (3 ≤ 9)   ✔ take 0 (blocked)     last defeated: 3
   *   Attack ♠4 (4 > 3)   ✘ weapon unusable → fight bare-handed for 4
   *   Equip ♦8            → history resets, ♦8 can attack anything again.
   */
  function canUseWeapon(s, monster) {
    if (!s.weapon) return false;
    const last = lastDefeated(s);
    return last === null || monster.rank <= last.rank;
  }

  function equipWeapon(s, card) {
    let note = '';
    if (s.weapon) {
      const old = s.weapon;
      s.discard.push(old.card, ...old.stack);
      note = old.stack.length
        ? `, discarding ${cards.short(old.card)} and ${old.stack.length} slain monster${old.stack.length === 1 ? '' : 's'}`
        : `, discarding ${cards.short(old.card)}`;
    }
    s.weapon = { card, stack: [] };
    addLog(s, `Equipped ${cards.short(card)}${note}.`, 'weapon');
  }

  /* ------------------------------------------------------------------ */
  /* Potions                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Potion restriction: only ONE potion per room can heal.
   *
   * Worked example (health 12/20):
   *   Room has ♥6 and ♥4.
   *   Drink ♥6 → 12 + 6 = 18. potionUsed = true.
   *   Drink ♥4 → discarded with NO effect (still 18). It still counts as one
   *              of your 3 resolved cards for the room.
   *   Next room: potionUsed resets. Drinking ♥9 at 18 heals only 2 (cap 20).
   */
  function drinkPotion(s, card) {
    s.discard.push(card);
    if (s.potionUsed) {
      s.stats.potionsWasted += 1;
      addLog(s, `${cards.short(card)} had no effect. Only one potion per room.`, 'wasted');
      return 0;
    }
    const heal = Math.min(card.rank, MAX_HEALTH - s.health);
    s.health += heal;
    s.potionUsed = true;
    s.stats.healed += heal;
    const capped = heal < card.rank ? ' (capped at 20)' : '';
    addLog(s, `Drank ${cards.short(card)}: healed ${heal}${capped}. Health ${s.health}.`, 'heal');
    return heal;
  }

  /* ------------------------------------------------------------------ */
  /* Monsters                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Fight a monster either bare-handed or with the equipped weapon.
   *
   *   Bare-handed:  damage = monster value. Monster goes to the discard.
   *   With weapon:  damage = max(0, monster − weapon). The monster is slain
   *                 and stacked on the weapon; it becomes the new "last
   *                 defeated" value that limits future weapon use.
   *
   *   Example: ♦7 vs ♠Q (12) → take 5.   ♦7 vs ♣4 → take 0 (fully blocked).
   */
  function fightMonster(s, card, mode) {
    let damage;
    if (mode === 'weapon') {
      damage = Math.max(0, card.rank - s.weapon.card.rank);
      s.weapon.stack.push(card);
      addLog(
        s,
        damage > 0
          ? `Fought ${cards.short(card)} with ${cards.short(s.weapon.card)}: took ${damage} damage.`
          : `Slew ${cards.short(card)} with ${cards.short(s.weapon.card)}: no damage taken.`,
        damage > 0 ? 'damage' : 'slay'
      );
    } else {
      damage = card.rank;
      s.discard.push(card);
      addLog(s, `Fought ${cards.short(card)} bare-handed: took ${damage} damage.`, 'damage');
    }
    s.health = Math.max(0, s.health - damage);
    s.stats.slain += 1;
    s.stats.damageTaken += damage;
    return damage;
  }

  /* ------------------------------------------------------------------ */
  /* Describing a card's available actions (used by the UI)              */
  /* ------------------------------------------------------------------ */

  /**
   * What would happen if the player picks the card in `slot`?
   * Returns { primary, alt? } where each option is
   *   { mode, verb, label, hint, tone }  (tone: '' | 'warn' | 'danger')
   */
  function describe(s, slot) {
    const card = s.room[slot];
    if (!card) return null;
    const lethal = (dmg) => (dmg >= s.health ? 'danger' : '');

    if (card.type === 'weapon') {
      return {
        primary: {
          mode: 'equip',
          verb: 'Equip',
          label: s.weapon ? `Equip it, replacing ${cards.short(s.weapon.card)}` : 'Equip it',
          hint: s.weapon ? `Swap ${cards.short(s.weapon.card)}` : 'Equip',
          tone: '',
        },
      };
    }

    if (card.type === 'potion') {
      if (s.potionUsed) {
        return {
          primary: {
            mode: 'drink',
            verb: 'Discard',
            label: 'Discard it with no effect, because a potion was already used this room',
            hint: 'No effect',
            tone: 'warn',
          },
        };
      }
      const heal = Math.min(card.rank, MAX_HEALTH - s.health);
      return {
        primary: {
          mode: 'drink',
          verb: 'Drink',
          label: `Drink it to heal ${heal}${heal < card.rank ? ' (capped at 20)' : ''}`,
          hint: `+${heal} ♥`,
          tone: heal === 0 ? 'warn' : '',
        },
      };
    }

    // Monster
    const bare = {
      mode: 'bare',
      verb: 'Fight',
      label: `Fight bare-handed and take ${card.rank} damage`,
      hint: `✊ −${card.rank}`,
      tone: lethal(card.rank),
    };

    if (canUseWeapon(s, card)) {
      const dmg = Math.max(0, card.rank - s.weapon.card.rank);
      return {
        primary: {
          mode: 'weapon',
          verb: 'Fight',
          label: `Fight with ${cards.short(s.weapon.card)} and take ${dmg} damage`,
          hint: `⚔ −${dmg}`,
          tone: lethal(dmg),
        },
        alt: { ...bare, verb: 'Bare hands' },
      };
    }

    if (s.weapon) {
      const last = lastDefeated(s);
      bare.label += `. ${cards.short(s.weapon.card)} cannot be used, since its last kill was ${cards.short(last)} (${last.rank})`;
    }
    return { primary: bare };
  }

  /* ------------------------------------------------------------------ */
  /* Resolving a card                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Resolve the card in `slot`. `mode` only matters for monsters:
   * 'weapon' | 'bare' (defaults to the weapon when it is usable).
   * Returns { ok, reason?, event? } — the event drives UI feedback.
   */
  function resolveCard(s, slot, mode) {
    if (s.status !== 'playing') return { ok: false, reason: 'The game is over.' };
    const card = s.room[slot];
    if (!card) return { ok: false, reason: 'That slot is empty.' };

    if (card.type === 'monster') {
      const usable = canUseWeapon(s, card);
      if (!mode) mode = usable ? 'weapon' : 'bare';
      if (mode === 'weapon' && !usable) {
        return { ok: false, reason: 'Your weapon cannot be used on that monster.' };
      }
    }

    // Remove the card from the room BEFORE applying it, so a lethal monster
    // is not counted among the "remaining" monsters in the loss score.
    s.room[slot] = null;
    s.resolvedThisRoom += 1;

    const event = { kind: card.type, card, damage: 0, heal: 0 };
    if (card.type === 'weapon') equipWeapon(s, card);
    else if (card.type === 'potion') event.heal = drinkPotion(s, card);
    else event.damage = fightMonster(s, card, mode);

    if (checkEnd(s)) {
      event.ended = s.status;
      return { ok: true, event };
    }

    if (isRoomComplete(s)) {
      s.avoidedLast = false; // facing a room re-enables Avoid
      startRoom(s);
      event.newRoom = true;
    }
    return { ok: true, event };
  }

  /**
   * A room is complete when 3 cards are resolved (the 4th carries over).
   * Exception, the final room: once the deck is empty there is nothing to
   * carry into, so every remaining card must be resolved.
   */
  function isRoomComplete(s) {
    if (roomCards(s).length === 0) return true;
    return !isFinalRoom(s) && s.resolvedThisRoom >= RESOLVE_PER_ROOM;
  }

  /** How many more cards must be resolved before the room ends. */
  function cardsLeftToResolve(s) {
    const remaining = roomCards(s).length;
    if (isFinalRoom(s)) return remaining;
    return Math.max(0, Math.min(remaining, RESOLVE_PER_ROOM - s.resolvedThisRoom));
  }

  /* ------------------------------------------------------------------ */
  /* End of game & scoring                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Checked immediately after every resolved card.
   *   Loss: health ≤ 0 → score = −(sum of monster values still in the dungeon)
   *         e.g. ♠K(13) + ♣9 + ♠4 remain → score −26.
   *   Win:  deck AND room empty → score = remaining health, e.g. 14.
   */
  function checkEnd(s) {
    if (s.health <= 0) {
      s.status = 'lost';
      s.score = -remainingMonsterValue(s);
      addLog(s, `You were slain. Final score: ${s.score}.`, 'loss');
      return true;
    }
    if (s.deck.length === 0 && roomCards(s).length === 0) {
      s.status = 'won';
      s.score = s.health;
      addLog(s, `Dungeon cleared! Final score: ${s.score}.`, 'win');
      return true;
    }
    return false;
  }

  /** Light validation for states loaded from LocalStorage. */
  function isValidState(s) {
    return (
      !!s &&
      s.version === STATE_VERSION &&
      Array.isArray(s.deck) &&
      Array.isArray(s.room) &&
      s.room.length === ROOM_SIZE &&
      Array.isArray(s.discard) &&
      Array.isArray(s.log) &&
      typeof s.health === 'number' &&
      typeof s.seed === 'string' &&
      ['playing', 'won', 'lost'].includes(s.status)
    );
  }

  NS.game = {
    MAX_HEALTH,
    RESOLVE_PER_ROOM,
    clone,
    createGame,
    avoidBlocker,
    avoidRoom,
    resolveCard,
    describe,
    canUseWeapon,
    lastDefeated,
    cardsLeftToResolve,
    isFinalRoom,
    remainingMonsterValue,
    isValidState,
  };
})((window.Scoundrel = window.Scoundrel || {}));
