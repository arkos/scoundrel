# Scoundrel

A polished, accessible browser version of **Scoundrel**, the solo dungeon-crawl card game by Zach Gage and Kurt Bieg, played with a standard deck of cards.

It uses vanilla HTML, CSS and JavaScript, with no frameworks, libraries or build step.

---

## Game overview

You are a scoundrel delving into a dungeon made of 44 playing cards. You start with **20 health** (also the maximum) and must fight through every card to escape.

| Suit | Role | Values |
|------|------|--------|
| ♠ ♣ | **Monsters** (26) | 2–10, J = 11, Q = 12, K = 13, A = 14 |
| ♦ | **Weapons** (9) | 2–10 |
| ♥ | **Potions** (9) | 2–10 |

Jokers, red face cards (J/Q/K of ♥♦) and red Aces are removed from the 52-card deck.

## Rules

### Each turn
Cards are drawn until **4** are face up. That is the **room**. Then you either:

- **Avoid the room:** all 4 cards go to the bottom of the deck in order. You **cannot avoid two rooms in a row**.
- **Face the room:** resolve **3 of the 4** cards in any order. The 4th card **carries over** and becomes the first card of the next room.

### Resolving cards
- **Weapon ♦:** equip it immediately. The previous weapon and every monster stacked on it are discarded, and the new weapon starts with a clean history.
- **Potion ♥:** heal by its value, capped at 20. **Only one potion per room heals.** Any extra potions are discarded with no effect.
- **Monster ♠♣:**
  - *Bare-handed:* take damage equal to its full value.
  - *With a weapon:* take `max(0, monster − weapon)` damage. The monster is slain and stacked on the weapon, becoming its **last defeated** value.

### The weapon rule (non-increasing)
A weapon can only be used on a monster whose value is **≤ the last monster it defeated**. A fresh weapon can hit anything.

```
Equip ♦5                → may attack anything
♠J (11)                 → take 6, last defeated = 11
♣9  (9 ≤ 11) ✔          → take 4, last defeated = 9
♠9  (9 ≤ 9)  ✔          → take 4 (equal is allowed)
♠10 (10 > 9) ✘          → weapon unusable; fight bare-handed for 10
```

When the weapon *is* usable you may still choose to fight bare-handed, which keeps its last-defeated value high for later. In the UI this is the **✊ Bare hands** button under a monster card, or <kbd>Shift</kbd>+<kbd>1–4</kbd>.

### The potion rule
```
Health 12. Room holds ♥6 and ♥4.
Drink ♥6 → 18
Drink ♥4 → no effect (still 18); it still counts as one of your 3 resolved cards
```

### End of game & scoring
- **Win:** every card is resolved (deck and room are empty). **Score = remaining health.**
- **Lose:** health reaches 0. **Score = −(sum of monster values still in the dungeon)**, counting the deck plus any unresolved room cards.
- When the deck runs out, the **final room must be resolved completely**, since there is no next room for a card to carry into.

> **Interpretation note:** when you fight with a weapon, the monster is always slain and stacked on the weapon, even if some damage gets through (e.g. ♦7 vs ♠Q → take 5, ♠Q stacked). This is the standard Scoundrel rule.

## How to run

No install, server or build step is needed.

1. Download or clone this folder.
2. Open **`index.html`** in any modern browser (double-clicking works).

The JavaScript uses classic `<script>` tags that share one `window.Scoundrel` namespace instead of ES modules. Browsers block module imports over `file://`, so this keeps the game runnable straight from disk.

Optional: serve it locally with `python3 -m http.server` and visit `http://localhost:8000`.

### Controls

| Action | Mouse / touch | Keyboard |
|---|---|---|
| Resolve a card (uses weapon when possible) | Tap the card | <kbd>1</kbd>–<kbd>4</kbd> or <kbd>Tab</kbd> + <kbd>Enter</kbd> |
| Fight a monster bare-handed | **✊ Bare hands** | <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>4</kbd> |
| Avoid room | **Avoid room** | <kbd>A</kbd> |
| New game (new shuffle) | **New game** | <kbd>N</kbd> |
| Restart (same shuffle) | **Restart** | <kbd>R</kbd> |
| Rules | **Rules** | <kbd>?</kbd> / <kbd>H</kbd> |
| Close a dialog | Click the backdrop | <kbd>Esc</kbd> |

Every card shows a **preview** of its outcome, for example `⚔ −3`, `+5 ♥` or `No effect`. The preview turns red when the hit would be lethal.

### Debug panel
Click **Debug panel** in the footer, or open `index.html?debug`. It shows the seed and hidden state, can reveal the deck order, starts a game from any seed, and clears the saved game.

## File responsibilities

```
scoundrel/
├── index.html        Page structure: top bar & controls, HUD, room grid, action log,
│                     debug panel, and <dialog> modals (rules, end of game, confirm)
├── css/
│   └── styles.css    Theme tokens (CSS variables), responsive layout, HUD, card styles
│                     per type, flip/resolve/damage animations, focus styles,
│                     prefers-reduced-motion and forced-colors support
├── js/
│   ├── rng.js        Seedable PRNG (string hash + mulberry32) and Fisher–Yates shuffle
│   ├── cards.js      Card model, 44-card dungeon construction, naming helpers (♦7, "King of Spades")
│   ├── game.js       Pure rules engine (no DOM): state model, room drawing, avoid/face,
│   │                 card resolution, weapon/potion rules, end detection, scoring.
│   │                 Includes worked examples in comments for the tricky rules.
│   ├── storage.js    LocalStorage save/load (guarded with try/catch) for game state and prefs
│   ├── ui.js         Rendering: HUD, weapon panel, room cards, incremental ARIA-live log,
│   │                 feedback animations, modals, debug panel, focus restoration
│   └── main.js       Controller: input handling (mouse + keyboard), action → state → save → render,
│                     new game / restart / end-of-game flow, boot & resume
└── README.md
```

### Architecture notes
- **State-driven:** every action clones the state, applies one rules-engine function, saves it to LocalStorage, and re-renders. The previous state is used only for animation diffs, such as which cards are new or how health changed.
- **Deterministic:** each game has a seed. **Restart** recreates the identical dungeon, and **New game** rolls a new seed.
- **Persistent:** the game is saved after every action and resumed automatically on reload. If storage is unavailable (for example in private mode), the game still plays.

## Accessibility
- Fully keyboard operable, with a skip link, logical tab order, number-key shortcuts and focus restored after every action.
- Cards are real `<button>`s with descriptive labels, e.g. *"Slot 2: Monster, Queen of Clubs (value 12). Fight with ♦7 and take 5 damage."*
- The health bar uses `role="meter"` with `aria-valuetext`.
- The action log is a `role="log"` live region, and only **new** entries are announced.
- Native `<dialog>` modals provide focus trapping and <kbd>Esc</kbd> to close.
- Focus styles are clearly visible, `prefers-reduced-motion` disables animations, and `forced-colors` is supported.
- The layout is mobile-first: a 2×2 card grid on phones and 4 across on wider screens, with 44 px touch targets.
