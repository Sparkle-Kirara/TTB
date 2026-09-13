/* =====================================================================
   CORE/DIALOGUE.JS — Shared, lightweight dialogue selection utility
   =====================================================================
   This module knows nothing about any specific game. It answers exactly
   one question: "given a pool of lines, which one should I use next?"

   It does NOT know:
     - what happened in the game (that's the game's job to detect)
     - what the lines actually say (that's each game's *-dialogue.js file)
     - how/where to display the chosen line (that's the game's existing UI code)

   Responsibilities:
     - pick a random line from a pool
     - avoid repeating the immediately-previous line for a given history key
     - gracefully allow reuse when a pool is too small to avoid repetition

   Usage:
     Dialogue.pick(SOME_DIALOGUE.someCategory, 'uniqueHistoryKey')

   `historyKey` scopes the "don't repeat" memory. Using the category name
   itself as the key (e.g. 'rps.winReactions') is usually the right choice,
   matching how Trust Me's existing pickTtmLine() tracked history per
   category rather than globally.
   ===================================================================== */

const Dialogue = (function () {
  // Tracks the last line used per historyKey, across all games. A single
  // shared Map is enough -- this is intentionally NOT a "complicated
  // dialogue database" (spec section 5), just enough state to avoid an
  // immediate repeat.
  const lastLineByKey = new Map();

  /**
   * Picks a line from `pool`, avoiding an immediate repeat of the last line
   * used for `historyKey` when the pool is large enough to make that
   * possible. Falls back to any line (including the last one) when the
   * pool has only one entry.
   *
   * @param {string[]} pool - array of candidate lines
   * @param {string} [historyKey] - scopes anti-repetition memory; omit to skip anti-repetition entirely
   * @returns {string} the chosen line, or '...' if the pool is empty/missing
   */
  function pick(pool, historyKey) {
    if (!pool || pool.length === 0) return '...';
    if (pool.length === 1) return pool[0];

    const lastLine = historyKey ? lastLineByKey.get(historyKey) : undefined;

    let choice;
    let attempts = 0;
    do {
      choice = pool[Math.floor(Math.random() * pool.length)];
      attempts++;
    } while (choice === lastLine && attempts < 8);

    if (historyKey) lastLineByKey.set(historyKey, choice);
    return choice;
  }

  /**
   * Picks from whichever of several weighted pools "wins" a random roll,
   * for the common case of "usually category A, sometimes category B".
   * `weightedPools` is an array of { pool, historyKey, weight }. Weights
   * don't need to sum to 1 -- they're normalized internally.
   *
   * This is a small convenience on top of pick(); it does not replace a
   * game's own event-detection logic (spec section 3: this utility must
   * not contain game-specific gameplay logic -- the caller still decides
   * WHICH pools are even candidates for a given moment).
   */
  function pickWeighted(weightedPools) {
    const totalWeight = weightedPools.reduce((sum, p) => sum + p.weight, 0);
    if (totalWeight <= 0) return '...';

    let roll = Math.random() * totalWeight;
    for (const entry of weightedPools) {
      roll -= entry.weight;
      if (roll <= 0) {
        return pick(entry.pool, entry.historyKey);
      }
    }
    // Floating point safety net -- fall back to the last entry.
    const last = weightedPools[weightedPools.length - 1];
    return pick(last.pool, last.historyKey);
  }

  /** Clears anti-repetition memory for a specific key, or everything if no key is given. Useful when starting a fresh game session. */
  function resetHistory(historyKey) {
    if (historyKey) lastLineByKey.delete(historyKey);
    else lastLineByKey.clear();
  }

  return { pick, pickWeighted, resetHistory };
})();
