/**
 * ui.js — All DOM rendering: HUD, room, action log, modals, debug panel.
 *
 * The renderer is state-driven: render(state, prevState) redraws from the
 * current state, using the previous state only to decide which cards are new
 * (flip-in animation) and how health changed (damage/heal feedback).
 */
(function (NS) {
  'use strict';

  const { cards, game } = NS;
  const $ = (id) => document.getElementById(id);
  const el = {};

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = () => motionQuery.matches;

  // Log rendering is incremental so the ARIA live region only announces
  // NEW entries instead of re-reading the whole log after every action.
  let logGameKey = null;
  let lastLogId = 0;

  const ICONS = {
    monster:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5a8.5 8.5 0 0 0-8.5 8.5c0 3 1.4 5 3.5 6.2V20a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 20v-2.8c2.1-1.2 3.5-3.2 3.5-6.2A8.5 8.5 0 0 0 12 2.5Zm-3.2 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm6.4 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4ZM10 18h1v2h-1v-2Zm3 0h1v2h-1v-2Z"/></svg>',
    weapon:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14.5 3.5H20.5V9.5L10 20 4 14 14.5 3.5ZM7 17l-3.5 3.5M5.5 12.5l6 6"/></svg>',
    potion:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 2.5h6M10 2.5v6.2L4.6 18.2A2.2 2.2 0 0 0 6.5 21.5h11a2.2 2.2 0 0 0 1.9-3.3L14 8.7V2.5"/><path fill="currentColor" d="M7.3 15h9.4l1.6 3.2c.3.6-.1 1.3-.8 1.3H6.5c-.7 0-1.1-.7-.8-1.3L7.3 15Z"/></svg>',
  };

  const escapeHTML = (str) =>
    String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function init() {
    [
      'health-value', 'health-meter', 'health-fill', 'health-delta', 'hud-health',
      'weapon-panel', 'hud-weapon', 'hud-turn', 'hud-deck', 'hud-discard', 'hud-avoid',
      'room', 'room-title', 'room-status', 'room-grid', 'btn-avoid', 'avoid-reason',
      'log-list', 'sr-status', 'btn-restart',
      'help-dialog', 'end-dialog', 'confirm-dialog', 'confirm-message', 'confirm-title', 'confirm-ok',
      'end-title', 'end-summary', 'end-score', 'end-stats', 'end-emblem',
      'debug-panel', 'btn-debug', 'debug-seed', 'debug-deck-count', 'debug-monsters',
      'debug-avoided', 'debug-potion', 'debug-reveal', 'debug-deck', 'debug-seed-input',
    ].forEach((id) => {
      el[id.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = $(id);
    });

    // Help dialog: close buttons + click on the backdrop.
    el.helpDialog.querySelectorAll('[data-close]').forEach((btn) =>
      btn.addEventListener('click', () => el.helpDialog.close())
    );
    [el.helpDialog, el.endDialog, el.confirmDialog].forEach((dlg) => {
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.close(dlg === el.confirmDialog ? 'cancel' : 'close');
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Top-level render                                                    */
  /* ------------------------------------------------------------------ */

  function render(state, prev, opts = {}) {
    renderHUD(state);
    renderRoom(state, prev, opts);
    renderLog(state);
    renderDebug(state);
    if (opts.event) playFeedback(opts.event);
  }

  /* ------------------------------------------------------------------ */
  /* HUD                                                                 */
  /* ------------------------------------------------------------------ */

  function renderHUD(s) {
    const hp = s.health;
    const pct = Math.round((hp / game.MAX_HEALTH) * 100);
    el.healthValue.textContent = hp;
    el.healthMeter.setAttribute('aria-valuenow', hp);
    el.healthMeter.setAttribute('aria-valuetext', `${hp} of ${game.MAX_HEALTH}`);
    el.healthFill.style.setProperty('--pct', pct);
    el.hudHealth.dataset.level = pct > 60 ? 'high' : pct > 30 ? 'mid' : 'low';

    renderWeapon(s);

    el.hudTurn.textContent = s.turn;
    el.hudDeck.textContent = s.deck.length;
    el.hudDiscard.textContent = s.discard.length;

    const blocker = game.avoidBlocker(s);
    el.hudAvoid.textContent = blocker ? 'Locked' : 'Ready';
    el.hudAvoid.dataset.state = blocker ? 'locked' : 'ready';
    el.hudAvoid.title = blocker || 'You may avoid this room.';
  }

  function miniCard(card, extraClass = '') {
    return `<span class="mini mini--${card.type} ${extraClass}" title="${escapeHTML(cards.long(card))}">${cards.short(card)}</span>`;
  }

  function renderWeapon(s) {
    if (!s.weapon) {
      el.weaponPanel.innerHTML = `
        <div class="weapon__slot weapon__slot--empty" aria-hidden="true">✊</div>
        <div class="weapon__info">
          <p class="weapon__name">Bare-handed</p>
          <p class="weapon__meta">Last defeated: <strong>—</strong></p>
        </div>`;
      el.hudWeapon.setAttribute('aria-label', 'Equipped weapon: none. Last defeated: none.');
      return;
    }
    const w = s.weapon.card;
    const last = game.lastDefeated(s);
    const limit = last ? `Usable on monsters ≤ ${last.rank}` : 'Usable on any monster';
    const stack = s.weapon.stack.length
      ? `<ol class="weapon__stack" aria-label="Monsters slain with this weapon">${s.weapon.stack
          .map((c) => `<li>${miniCard(c, 'mini--xs')}</li>`)
          .join('')}</ol>`
      : '';
    el.weaponPanel.innerHTML = `
      <div class="weapon__slot" aria-hidden="true">${cards.short(w)}</div>
      <div class="weapon__info">
        <p class="weapon__name">${cards.short(w)} <span class="weapon__value">value ${w.rank}</span></p>
        <p class="weapon__meta">Last defeated: <strong>${last ? `${cards.short(last)} (${last.rank})` : '—'}</strong></p>
        <p class="weapon__limit">${limit}</p>
        ${stack}
      </div>`;
    el.hudWeapon.setAttribute(
      'aria-label',
      `Equipped weapon: ${cards.long(w)}. Last defeated: ${last ? cards.long(last) : 'none'}. ${limit}.`
    );
  }

  /* ------------------------------------------------------------------ */
  /* Room                                                                */
  /* ------------------------------------------------------------------ */

  function sameGame(a, b) {
    return !!a && !!b && a.seed === b.seed && a.createdAt === b.createdAt;
  }

  function roomStatusText(s) {
    if (s.status === 'won') return 'The dungeon is cleared.';
    if (s.status === 'lost') return 'You have fallen.';
    const left = game.cardsLeftToResolve(s);
    const plural = left === 1 ? 'card' : 'cards';
    const potion = s.potionUsed ? ' A potion has been used in this room.' : '';
    if (game.isFinalRoom(s)) return `Final room: resolve the last ${left} ${plural}.${potion}`;
    if (s.resolvedThisRoom === 0) {
      return `Face the room by resolving 3 of the 4 cards, or avoid it.${potion}`;
    }
    return `Resolve ${left} more ${plural}. The last card carries into the next room.${potion}`;
  }

  function renderRoom(s, prev, opts) {
    el.roomTitle.textContent = s.status === 'playing' ? `Room ${s.turn}` : `Room ${s.turn}: game over`;
    el.roomStatus.textContent = roomStatusText(s);

    const blocker = game.avoidBlocker(s);
    el.btnAvoid.disabled = !!blocker;
    el.avoidReason.textContent = blocker && s.status === 'playing' ? blocker : '';

    // Cards that were already visible keep their place without re-flipping.
    const prevIds = new Set(sameGame(s, prev) ? prev.room.filter(Boolean).map((c) => c.id) : []);
    const ended = s.status !== 'playing';
    const focusedSlot = opts.focusSlot;
    const frag = document.createDocumentFragment();
    let newIndex = 0;

    s.room.forEach((card, slot) => {
      const li = document.createElement('li');
      li.className = 'slot';

      if (!card) {
        li.classList.add('slot--empty');
        li.innerHTML = `<div class="card-empty"><span>Slot ${slot + 1}<br />resolved</span></div>`;
        frag.appendChild(li);
        return;
      }

      const d = game.describe(s, slot);
      const isNew = !prevIds.has(card.id);
      const wrap = document.createElement('div');
      wrap.className = `card card--${card.type}`;
      if (isNew) {
        wrap.classList.add('is-new');
        wrap.style.setProperty('--i', newIndex++);
      }
      if (d.primary.tone) wrap.classList.add(`card--${d.primary.tone}`);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card__btn';
      btn.dataset.slot = slot;
      btn.dataset.action = 'primary';
      btn.disabled = ended;
      btn.setAttribute('aria-keyshortcuts', String(slot + 1));
      btn.setAttribute('aria-label', `Slot ${slot + 1}: ${cards.long(card)}. ${d.primary.label}.`);
      btn.innerHTML = cardFace(card, d);
      wrap.appendChild(btn);

      const actions = document.createElement('div');
      actions.className = 'card__actions';
      if (d.alt && !ended) {
        actions.innerHTML = `<button type="button" class="card__alt" data-slot="${slot}" data-action="alt"
          aria-keyshortcuts="Shift+${slot + 1}"
          aria-label="Slot ${slot + 1}: ${escapeHTML(d.alt.label)}">✊ Bare hands <span class="card__alt-dmg">−${card.rank}</span></button>`;
      } else {
        actions.innerHTML = `<span class="card__caption" aria-hidden="true">${ended ? 'Unresolved' : d.primary.verb}</span>`;
      }
      wrap.appendChild(actions);
      li.appendChild(wrap);
      frag.appendChild(li);
    });

    el.roomGrid.replaceChildren(frag);

    // Re-rendering replaces the buttons, so restore focus for keyboard users:
    // the same slot if it still has a card, otherwise the nearest card.
    if (typeof focusedSlot === 'number') restoreFocus(focusedSlot);
  }

  function cardFace(card, d) {
    const rank = cards.rankLabel(card);
    const sym = cards.symbol(card);
    const hint = escapeHTML(d.primary.hint);
    return `
      <span class="card__inner" aria-hidden="true">
        <span class="card__face card__face--front">
          <span class="card__corner"><span>${rank}</span><span>${sym}</span></span>
          <span class="card__body">
            <span class="card__type">${ICONS[card.type]}${cards.TYPE_NAME[card.type]}</span>
            <span class="card__pip">${sym}</span>
            <span class="card__value">${card.rank}</span>
          </span>
          <span class="card__hint">${hint}</span>
          <span class="card__corner card__corner--br"><span>${rank}</span><span>${sym}</span></span>
        </span>
        <span class="card__face card__face--back"><span class="card__back-mark">♠</span></span>
      </span>`;
  }

  function restoreFocus(slot) {
    const buttons = [...el.roomGrid.querySelectorAll('.card__btn:not(:disabled)')];
    if (buttons.length === 0) {
      (el.btnAvoid.disabled ? el.room : el.btnAvoid).focus({ preventScroll: true });
      return;
    }
    const best = buttons.reduce((a, b) =>
      Math.abs(+b.dataset.slot - slot) < Math.abs(+a.dataset.slot - slot) ? b : a
    );
    best.focus({ preventScroll: true });
  }

  /** Play the "card leaves the room" animation; resolves when finished. */
  function animateResolve(slot) {
    const card = el.roomGrid.querySelector(`.card__btn[data-slot="${slot}"]`);
    if (!card || reducedMotion()) return Promise.resolve();
    const wrap = card.closest('.card');
    wrap.classList.add('is-resolving');
    return new Promise((resolve) => {
      const done = () => resolve();
      wrap.addEventListener('animationend', done, { once: true });
      setTimeout(done, 320); // safety net if animationend never fires
    });
  }

  /* ------------------------------------------------------------------ */
  /* Feedback (damage / heal)                                            */
  /* ------------------------------------------------------------------ */

  function playFeedback(event) {
    if (event.damage > 0) pulse(el.hudHealth, 'is-hurt', `−${event.damage}`, 'damage');
    else if (event.heal > 0) pulse(el.hudHealth, 'is-healed', `+${event.heal}`, 'heal');
    if (event.kind === 'weapon') pulse(el.hudWeapon, 'is-equipped');
  }

  function pulse(node, cls, deltaText, deltaKind) {
    node.classList.remove(cls);
    void node.offsetWidth; // restart the CSS animation
    node.classList.add(cls);
    setTimeout(() => node.classList.remove(cls), 700);

    if (deltaText) {
      const span = document.createElement('span');
      span.className = `health__delta health__delta--${deltaKind}`;
      span.textContent = deltaText;
      el.healthDelta.appendChild(span);
      setTimeout(() => span.remove(), reducedMotion() ? 900 : 1100);
    }
  }

  function nudge(node) {
    pulse(node, 'is-denied');
  }

  /** Announce a transient message to screen readers. */
  function announce(message) {
    el.srStatus.textContent = '';
    setTimeout(() => (el.srStatus.textContent = message), 30);
  }

  /* ------------------------------------------------------------------ */
  /* Action log                                                          */
  /* ------------------------------------------------------------------ */

  function renderLog(s) {
    const key = `${s.seed}:${s.createdAt}`;
    const list = el.logList;

    if (key !== logGameKey) {
      // New or reloaded game: rebuild quietly, then resume live announcements.
      logGameKey = key;
      lastLogId = 0;
      list.setAttribute('aria-busy', 'true');
      list.replaceChildren();
    }

    const fresh = s.log.filter((entry) => entry.id > lastLogId);
    for (const entry of fresh) {
      const li = document.createElement('li');
      li.className = `log__item log__item--${entry.kind}`;
      li.innerHTML = `<span class="log__turn" aria-hidden="true">R${entry.turn}</span><span class="log__text">${escapeHTML(entry.text)}</span>`;
      list.appendChild(li);
      lastLogId = entry.id;
    }
    while (list.children.length > s.log.length) list.firstElementChild.remove();

    if (list.getAttribute('aria-busy') === 'true') {
      requestAnimationFrame(() => list.removeAttribute('aria-busy'));
    }
    if (fresh.length) list.scrollTop = list.scrollHeight;
  }

  /* ------------------------------------------------------------------ */
  /* Modals                                                              */
  /* ------------------------------------------------------------------ */

  function openHelp() {
    if (!el.helpDialog.open) el.helpDialog.showModal();
  }

  function anyDialogOpen() {
    return !!document.querySelector('dialog[open]');
  }

  /** Promise-based confirm built on <dialog>. Resolves true on confirm. */
  function confirm({ title, message, okLabel }) {
    el.confirmTitle.textContent = title;
    el.confirmMessage.textContent = message;
    el.confirmOk.textContent = okLabel;
    el.confirmDialog.returnValue = 'cancel';
    el.confirmDialog.showModal();
    el.confirmOk.focus();
    return new Promise((resolve) => {
      el.confirmDialog.addEventListener('close', () => resolve(el.confirmDialog.returnValue === 'ok'), { once: true });
    });
  }

  /** Show the win/loss modal. Resolves with 'new' | 'restart' | 'close'. */
  function showEnd(s) {
    const won = s.status === 'won';
    el.endDialog.dataset.outcome = s.status;
    el.endEmblem.textContent = won ? '♛' : '☠';
    el.endTitle.textContent = won ? 'You escaped the dungeon!' : 'Slain in the dungeon';
    el.endSummary.textContent = won
      ? `You cleared all 44 cards with ${s.health} health remaining.`
      : `${game.remainingMonsterValue(s)} points of monsters were still lurking in the dungeon.`;
    el.endScore.textContent = s.score > 0 ? `+${s.score}` : String(s.score);

    const st = s.stats;
    const rows = [
      ['Rooms', s.turn],
      ['Monsters fought', st.slain],
      ['Damage taken', st.damageTaken],
      ['Health restored', st.healed],
      ['Rooms avoided', st.avoids],
      ['Potions wasted', st.potionsWasted],
    ];
    el.endStats.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

    el.endDialog.returnValue = 'close';
    el.endDialog.showModal();
    return new Promise((resolve) => {
      el.endDialog.addEventListener('close', () => resolve(el.endDialog.returnValue || 'close'), { once: true });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Debug panel                                                         */
  /* ------------------------------------------------------------------ */

  function setDebugOpen(open) {
    el.debugPanel.hidden = !open;
    el.btnDebug.setAttribute('aria-expanded', String(open));
  }

  function renderDebug(s) {
    if (el.debugPanel.hidden) return;
    el.debugSeed.textContent = s.seed;
    el.debugDeckCount.textContent = `${s.deck.length} cards`;
    el.debugMonsters.textContent = game.remainingMonsterValue(s);
    el.debugAvoided.textContent = s.avoidedLast ? 'yes' : 'no';
    el.debugPotion.textContent = s.potionUsed ? 'yes' : 'no';
    el.debugDeck.hidden = !el.debugReveal.checked;
    if (el.debugReveal.checked) {
      el.debugDeck.innerHTML = s.deck.map((c) => `<li>${miniCard(c, 'mini--xs')}</li>`).join('');
    }
  }

  NS.ui = {
    init,
    render,
    renderDebug,
    animateResolve,
    announce,
    nudge,
    openHelp,
    anyDialogOpen,
    confirm,
    showEnd,
    setDebugOpen,
    reducedMotion,
    el,
  };
})((window.Scoundrel = window.Scoundrel || {}));
