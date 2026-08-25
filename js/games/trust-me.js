    const TTM_CONFIG = {
      STORAGE_KEY: 'ttb_ttm_best_level'
    };

    let ttmState = {
      status: 'READY',        // 'READY', 'PLAYING', 'WIN', 'LOSE'
      level: 0,
      bestLevel: 0,
      secret: 0,
      range: { min: 1, max: 20 },
      attemptsLeft: 7,
      maxAttempts: 7,
      guesses: [],             // { value, result: 'higher'|'lower'|'correct' }
      lastLineByCategory: {},  // avoid repeating the same line back-to-back
      consecutiveEfficientWins: 0 // simple session-only "AI getting impressed" tracker
    };

    /* --- 5.2 LEVEL CONFIGURATION --- */
    function getTtmLevelConfig(level) {
      // Difficulty grows mainly through tighter attempt budgets relative to
      // range, not just a huge range (spec section 4) — range plateaus at
      // 1-100 while attempts keep shrinking slightly at higher levels.
      if (level === 0) return { min: 1, max: 20, attempts: 7 };
      if (level === 1) return { min: 1, max: 50, attempts: 7 };
      if (level === 2) return { min: 1, max: 100, attempts: 7 };
      if (level === 3) return { min: 1, max: 100, attempts: 6 };
      // Level 4+: attempts keep tightening slowly, floor at 5.
      const attempts = Math.max(5, 6 - Math.floor((level - 3) / 2));
      return { min: 1, max: 100, attempts };
    }

    /* --- 5.3 SECRET NUMBER GENERATION --- */
    function generateTtmSecret(range) {
      return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
    }

    /* --- SETUP / LIFECYCLE --- */
    function startTtmGame() {
      TTBAudio.playStart();
      showView('ttmView');
      loadTtmHighScore();
      ttmState.level = 0;
      ttmState.consecutiveEfficientWins = 0;
      setupTtmRound();
      showTtmOverlay('READY');
    }

    function loadTtmHighScore() {
      const saved = localStorage.getItem(TTM_CONFIG.STORAGE_KEY);
      ttmState.bestLevel = saved ? parseInt(saved, 10) : 0;
      document.getElementById('ttmBestDisplay').innerText = ttmState.bestLevel;
    }

    function saveTtmHighScore() {
      if (ttmState.level > ttmState.bestLevel) {
        ttmState.bestLevel = ttmState.level;
        localStorage.setItem(TTM_CONFIG.STORAGE_KEY, ttmState.bestLevel.toString());
        document.getElementById('ttmBestDisplay').innerText = ttmState.bestLevel;
      }
    }

    function setupTtmRound() {
      const config = getTtmLevelConfig(ttmState.level);
      ttmState.range = { min: config.min, max: config.max };
      ttmState.maxAttempts = config.attempts;
      ttmState.attemptsLeft = config.attempts;
      ttmState.secret = generateTtmSecret(ttmState.range);
      ttmState.guesses = [];

      document.getElementById('ttmRangeHint').innerText =
        `Guess a number between ${ttmState.range.min} and ${ttmState.range.max}`;
      document.getElementById('ttmGuessInput').min = ttmState.range.min;
      document.getElementById('ttmGuessInput').max = ttmState.range.max;
      document.getElementById('ttmGuessInput').value = '';
      document.getElementById('ttmInputError').innerText = '';
      document.getElementById('ttmHistoryList').innerHTML =
        '<div style="font-size:0.75rem; color:var(--text-muted);">No guesses yet.</div>';
      document.getElementById('ttmHintDisplay').style.display = 'none';

      updateTtmScoresUI();
    }

    function updateTtmScoresUI() {
      document.getElementById('ttmLevelDisplay').innerText = `Level ${ttmState.level}`;
      document.getElementById('ttmAttemptsDisplay').innerText = ttmState.attemptsLeft;
      document.getElementById('ttmBestDisplay').innerText = ttmState.bestLevel;
    }

    function showTtmOverlay(type) {
      document.getElementById('ttmOverlayReady').style.display = (type === 'READY') ? 'flex' : 'none';
      document.getElementById('ttmOverlayWin').style.display = (type === 'WIN') ? 'flex' : 'none';
      document.getElementById('ttmOverlayLose').style.display = (type === 'LOSE') ? 'flex' : 'none';
      document.getElementById('ttmControlsSection').style.display = (type === 'NONE') ? 'block' : 'none';
    }

    function ttmStartRun() {
      TTBAudio.playStart();
      ttmState.status = 'PLAYING';
      showTtmOverlay('NONE');
      setTtmDialogue(pickTtmLine('OPENING'));
      focusTtmInput();
    }

    function ttmNextLevelRun() {
      TTBAudio.playStart();
      ttmState.level += 1;
      saveTtmHighScore();
      setupTtmRound();
      ttmState.status = 'PLAYING';
      showTtmOverlay('NONE');
      setTtmDialogue(pickTtmLine('OPENING'));
      focusTtmInput();
    }

    function ttmRetryRun() {
      TTBAudio.playStart();
      ttmState.consecutiveEfficientWins = 0; // a loss resets the "impressed" streak
      setupTtmRound();
      ttmState.status = 'PLAYING';
      showTtmOverlay('NONE');
      setTtmDialogue(pickTtmLine('OPENING'));
      focusTtmInput();
    }

    function focusTtmInput() {
      const input = document.getElementById('ttmGuessInput');
      if (input) setTimeout(() => input.focus(), 50);
    }

    /* --- 5.4 GUESS HANDLING --- */
    function ttmSubmitGuess() {
      if (ttmState.status !== 'PLAYING') return;

      const input = document.getElementById('ttmGuessInput');
      const errorEl = document.getElementById('ttmInputError');
      const raw = input.value.trim();

      // Validation: empty, non-number, out of range — none of these consume
      // an attempt (spec section 2).
      if (raw === '') {
        showTtmInputError('Enter a number first.');
        return;
      }
      const value = Number(raw);
      if (!Number.isInteger(value)) {
        showTtmInputError('Whole numbers only.');
        return;
      }
      if (value < ttmState.range.min || value > ttmState.range.max) {
        showTtmInputError(`Stay between ${ttmState.range.min} and ${ttmState.range.max}.`);
        return;
      }

      errorEl.innerText = '';
      TTBAudio.playSelect();

      const distance = Math.abs(value - ttmState.secret);
      let result;
      if (value === ttmState.secret) result = 'correct';
      else if (value < ttmState.secret) result = 'higher';
      else result = 'lower';

      ttmState.guesses.push({ value, result, distance });
      ttmState.attemptsLeft -= 1;
      input.value = '';

      renderTtmHistory();
      updateTtmScoresUI();

      if (result === 'correct') {
        handleTtmWin();
        return;
      }

      document.getElementById('ttmHintDisplay').style.display = 'inline-block';
      document.getElementById('ttmHintDisplay').innerText = result === 'higher' ? 'Higher' : 'Lower';

      if (ttmState.attemptsLeft <= 0) {
        handleTtmLose();
        return;
      }

      // React to this guess with behavior-aware dialogue (spec sections 8-13)
      const line = pickTtmReactionLine();
      setTtmDialogue(line);
      focusTtmInput();
    }

    function showTtmInputError(message) {
      const errorEl = document.getElementById('ttmInputError');
      const input = document.getElementById('ttmGuessInput');
      errorEl.innerText = message;
      input.classList.remove('shake');
      void input.offsetWidth; // restart animation
      input.classList.add('shake');
    }

    function renderTtmHistory() {
      const list = document.getElementById('ttmHistoryList');
      list.innerHTML = '';
      ttmState.guesses.forEach((g, i) => {
        const item = document.createElement('div');
        const cls = g.result === 'correct' ? 'win-item' : (g.result === 'higher' ? 'higher-item' : 'lower-item');
        item.className = `history-item ${cls}`;
        const icon = g.result === 'correct' ? '🎯' : (g.result === 'higher' ? '⬆️' : '⬇️');
        item.innerHTML = `
          <span class="round-lbl">#${i + 1}</span>
          <span class="moves-lbl">${g.value} ${icon}</span>
        `;
        list.appendChild(item);
      });
      list.scrollLeft = list.scrollWidth;
    }

    /* --- 5.5 WIN / LOSE HANDLING --- */
    function handleTtmWin() {
      TTBAudio.playLevelUp();
      ttmState.status = 'WIN';
      saveTtmHighScore();

      const guessCount = ttmState.guesses.length;
      const wasEfficient = guessCount <= Math.ceil(ttmState.maxAttempts * 0.5);
      ttmState.consecutiveEfficientWins = wasEfficient ? ttmState.consecutiveEfficientWins + 1 : 0;

      document.getElementById('ttmWinLevel').innerText = ttmState.level;
      document.getElementById('ttmWinGuesses').innerText = guessCount;

      setTtmDialogue(pickTtmWinLine(guessCount));
      showTtmOverlay('WIN');
      updateTtmScoresUI();
    }

    function handleTtmLose() {
      TTBAudio.playGameOver();
      ttmState.status = 'LOSE';
      ttmState.consecutiveEfficientWins = 0;

      document.getElementById('ttmLoseNumber').innerText = ttmState.secret;
      document.getElementById('ttmLoseBest').innerText = ttmState.bestLevel;

      setTtmDialogue(pickTtmLine('LOSS'));
      showTtmOverlay('LOSE');
      updateTtmScoresUI();
    }

    function setTtmDialogue(line) {
      document.getElementById('ttmDialogueText').innerText = `"${line}"`;
    }

    /* --- 5.6 BEHAVIOR TRACKING & CLASSIFICATION --- */
    // Looks only at the current round's guesses — no persistence needed
    // (spec section 9: lightweight, session-only analysis).
    function detectTtmBehaviorPattern() {
      const guesses = ttmState.guesses;
      if (guesses.length < 3) return null;

      const recent = guesses.slice(-4).map(g => g.value);
      const deltas = [];
      for (let i = 1; i < recent.length; i++) deltas.push(recent[i] - recent[i - 1]);

      // TINY_STEPS: every recent move was a small nudge (+/- 1 or 2)
      if (deltas.every(d => Math.abs(d) > 0 && Math.abs(d) <= 2)) {
        return 'TINY_STEPS';
      }

      // SAME_DIRECTION: all recent deltas share a sign and are reasonably large
      const sameSign = deltas.every(d => d > 0) || deltas.every(d => d < 0);
      if (sameSign && deltas.length >= 2) {
        return 'SAME_DIRECTION';
      }

      // BINARY_SEARCH-like: overall distance trend is shrinking across the
      // last few guesses. Compare the earliest vs latest distance in the
      // window (robust to one non-improving step) rather than requiring
      // every consecutive pair to shrink by a fixed percentage, which
      // breaks down once the distance is already small.
      const distances = guesses.slice(-3).map(g => g.distance);
      if (distances.length >= 3) {
        const improved = distances[distances.length - 1] < distances[0] * 0.6;
        const neverGotWorse = distances.every((d, i) => i === 0 || d <= distances[i - 1] + 1);
        if (improved && neverGotWorse) {
          return 'BINARY_SEARCH';
        }
      }

      // STRATEGY_SHIFT: direction just reversed after being consistent before
      if (guesses.length >= 4) {
        const older = guesses.slice(-4, -2).map(g => g.value);
        const olderDelta = older[1] - older[0];
        const newerDelta = recent[recent.length - 1] - recent[recent.length - 2];
        if (olderDelta !== 0 && newerDelta !== 0 && Math.sign(olderDelta) !== Math.sign(newerDelta)) {
          return 'STRATEGY_SHIFT';
        }
      }

      // RANDOM: guesses bounce around without a consistent trend
      const avgAbsDelta = deltas.reduce((s, d) => s + Math.abs(d), 0) / deltas.length;
      const rangeSize = ttmState.range.max - ttmState.range.min;
      if (avgAbsDelta > rangeSize * 0.25 && !sameSign) {
        return 'RANDOM';
      }

      return null;
    }

    function classifyTtmCloseness(distance) {
      const rangeSize = ttmState.range.max - ttmState.range.min;
      const pct = distance / rangeSize;
      if (pct <= 0.02) return 'VERY_CLOSE';
      if (pct <= 0.12) return 'CLOSE';
      return 'FAR';
    }

    /* --- 5.7 AI DIALOGUE POOLS --- */
    const TTM_DIALOGUE = {
      OPENING: [
        "Let's see what you've got.",
        "Pick a number.",
        "Go ahead. Surprise me.",
        "This should be interesting.",
        "Your move.",
        "Try not to embarrass yourself."
      ],
      FAR: [
        "That wasn't even close.",
        "Were you guessing or just clicking?",
        "Bold strategy.",
        "You're going to need a better idea than that."
      ],
      CLOSE: [
        "Getting warmer.",
        "Okay, you're getting somewhere.",
        "Not bad."
      ],
      VERY_CLOSE: [
        "Okay... that was actually good.",
        "Now you're getting it.",
        "One away. Don't mess this up."
      ],
      RANDOM: [
        "Do you have a strategy?",
        "Because I can't find it.",
        "Are you guessing or exploring?",
        "Interesting approach. Very... chaotic."
      ],
      SAME_DIRECTION: [
        "You really like going that way, huh?",
        "You're committed to that direction, huh?",
        "Maybe try thinking instead of marching."
      ],
      TINY_STEPS: [
        "One number at a time?",
        "You're taking the scenic route.",
        "You know you can make bigger moves, right?"
      ],
      BINARY_SEARCH: [
        "Okay... you're actually using logic.",
        "That's a pretty good strategy.",
        "Now we're playing seriously.",
        "You're narrowing that range fast."
      ],
      STRATEGY_SHIFT: [
        "Oh? New strategy?",
        "Finally figured something out?",
        "Changing tactics now?"
      ],
      IMPRESSED: [
        "Okay, you're good.",
        "I'll admit it. That was smart.",
        "That was actually impressive.",
        "You're getting annoyingly good at this.",
        "Okay... respect.",
        "Maybe I underestimated you."
      ],
      WIN_SLOW: [
        "Eventually.",
        "You got it.",
        "Finally."
      ],
      WIN_AVERAGE: [
        "Not bad.",
        "Okay, I'll give you that one.",
        "That was actually pretty good."
      ],
      WIN_EFFICIENT: [
        "Okay, that was good.",
        "Alright, I'm impressed.",
        "You're narrowing that range fast."
      ],
      WIN_FIRST_TRY: [
        "First try?!",
        "...Seriously?",
        "Okay, I wasn't expecting that."
      ],
      WIN_STREAK: [
        "Okay, that wasn't luck.",
        "Alright, stop showing off.",
        "You're getting annoyingly good at this."
      ],
      LOSS: [
        "Out of guesses.",
        "You were getting there. Sort of.",
        "Close enough... except it wasn't.",
        "You almost had it.",
        "Maybe next time."
      ]
    };

    // Picks a random line from a category while avoiding an immediate repeat
    // of the last line used in that same category (spec section 14).
    function pickTtmLine(category) {
      const pool = TTM_DIALOGUE[category];
      if (!pool || pool.length === 0) return '...';
      if (pool.length === 1) return pool[0];

      const lastLine = ttmState.lastLineByCategory[category];
      let choice;
      let attempts = 0;
      do {
        choice = pool[Math.floor(Math.random() * pool.length)];
        attempts++;
      } while (choice === lastLine && attempts < 8);

      ttmState.lastLineByCategory[category] = choice;
      return choice;
    }

    // Decides which dialogue category applies to the guess just made,
    // following the priority order from spec section 13:
    //   game state -> behavior detection -> dialogue category -> random line
    // Behavior patterns take priority over plain closeness commentary so the
    // AI reads as reacting to HOW the player plays, not just each guess in
    // isolation — but closeness still gets a turn most of the time so the
    // dialogue stays connected to the immediate result too.
    function pickTtmReactionLine() {
      const lastGuess = ttmState.guesses[ttmState.guesses.length - 1];
      const pattern = detectTtmBehaviorPattern();
      const closeness = classifyTtmCloseness(lastGuess.distance);

      // A very close guess with an efficient round so far can trigger an
      // earned "impressed" line instead of the usual closeness remark.
      if (closeness === 'VERY_CLOSE' && ttmState.guesses.length <= Math.ceil(ttmState.maxAttempts * 0.6)) {
        if (Math.random() < 0.4) return pickTtmLine('IMPRESSED');
      }

      // Otherwise, alternate between behavior commentary and closeness
      // commentary so neither dominates every single turn.
      if (pattern && Math.random() < 0.55) {
        return pickTtmLine(pattern);
      }

      return pickTtmLine(closeness === 'VERY_CLOSE' ? 'VERY_CLOSE' : (closeness === 'CLOSE' ? 'CLOSE' : 'FAR'));
    }

    function pickTtmWinLine(guessCount) {
      if (guessCount === 1) return pickTtmLine('WIN_FIRST_TRY');

      // Reward genuine repeated strong performance (spec section 12) before
      // falling back to a single-round performance tier.
      if (ttmState.consecutiveEfficientWins >= 2) return pickTtmLine('WIN_STREAK');

      const efficiencyRatio = guessCount / ttmState.maxAttempts;
      if (efficiencyRatio <= 0.4) return pickTtmLine('WIN_EFFICIENT');
      if (efficiencyRatio <= 0.7) return pickTtmLine('WIN_AVERAGE');
      return pickTtmLine('WIN_SLOW');
    }

    /* --- 5.8 INPUT HANDLING --- */
    document.getElementById('ttmGuessInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        ttmSubmitGuess();
      }
    });
