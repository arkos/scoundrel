/**
 * rng.js — Seedable randomness + Fisher–Yates shuffle.
 *
 * Every game is driven by a string seed. The same seed always produces the
 * same dungeon, which is what makes "Restart" (replay the same dungeon) and
 * the debug panel's "start with seed" possible.
 */
(function (NS) {
  'use strict';

  /**
   * xmur3-style string hash → 32-bit unsigned integer.
   * Turns any human-friendly seed ("goblin", "42") into a numeric seed.
   */
  function hashString(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  /** mulberry32: tiny, fast PRNG returning floats in [0, 1). */
  function mulberry32(a) {
    return function next() {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Create a deterministic random function from a seed of any type. */
  function create(seed) {
    return mulberry32(hashString(String(seed)));
  }

  /**
   * Fisher–Yates (Durstenfeld) shuffle. Returns a NEW array.
   * Walk from the end; swap each element with a random one at or before it.
   * Every permutation is equally likely, in O(n).
   */
  function shuffle(items, rng) {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** A short, readable random seed such as "k3x9qa". */
  function randomSeed() {
    const buf = new Uint32Array(2);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    return (buf[0].toString(36) + buf[1].toString(36)).slice(0, 6);
  }

  NS.rng = { create, shuffle, randomSeed, hashString };
})((window.Scoundrel = window.Scoundrel || {}));
