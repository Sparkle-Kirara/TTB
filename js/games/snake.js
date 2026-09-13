    const SNAKE_CONFIG = {
      GRID_SIZE: 20,
      INITIAL_INTERVAL: 120,
      MIN_INTERVAL: 55,
      SPEED_DECREMENT: 2.5,
      STORAGE_KEY: 'ttb_snake_highscore',
      AI_BOOTSTRAP_GENERATIONS: 150, // one-time background pre-training when no checkpoint exists yet
      MAX_EXPERIENCE_BUFFER: 2000, // cap on recorded player-gameplay experience kept in memory
      // --- Apple Timeout -> Warning -> Death Zone (core rule, applies to both Me and Not me) ---
      APPLE_WARNING_1_SECONDS: 30,
      APPLE_WARNING_2_SECONDS: 40,
      APPLE_WARNING_3_SECONDS: 50,
      APPLE_COUNTDOWN_SECONDS: 10, // final warning at 50s begins this countdown; death zone starts when it hits 0
      DEATH_ZONE_COLUMNS_PER_SECOND: 2
    };

    const DIRECTIONS = {
      UP: { x: 0, y: -1 },
      DOWN: { x: 0, y: 1 },
      LEFT: { x: -1, y: 0 },
      RIGHT: { x: 1, y: 0 }
    };

    let snakeState = {
      status: 'READY',
      mode: 'ME', // 'ME' (player-controlled) or 'NOT_ME' (AI-controlled) -- exactly one snake either way
      snake: [],
      direction: DIRECTIONS.RIGHT,
      inputQueue: [],
      food: { x: 0, y: 0 },
      score: 0,
      bestScore: 0,
      hasBeatenBestThisRun: false,
      moveInterval: SNAKE_CONFIG.INITIAL_INTERVAL,
      lastStepTime: 0,
      lastFrameTime: 0,
      foodEatenAnim: 0,
      // --- Apple Timeout / Death Zone state (spec: core rule, not AI-specific) ---
      appleTimerSeconds: 0,       // elapsed seconds since the current apple appeared
      warningStage: 'NONE',       // 'NONE' | 'WARN_30' | 'WARN_40' | 'WARN_50' | 'COUNTDOWN'
      countdownValue: null,       // 10..1 while in COUNTDOWN, otherwise null
      deathZoneActive: false,
      deathZoneElapsedSeconds: 0  // drives deathZoneColumns = elapsed * DEATH_ZONE_COLUMNS_PER_SECOND
    };

    let snakeCanvas, snakeCtx;
    let snakeAnimationId = null;

    // The AI's currently-loaded brain (a NeuralNetwork instance) and a
    // small status object for the debug panel. This is initialized once
    // when Snake first loads (see the bootstrap block near the bottom of
    // this file), not every time a match starts.
    let snakeAiBrain = null;
    let snakeAiStatus = {
      state: 'Idle', // 'Idle' | 'Bootstrapping' | 'Ready' | 'Training'
      generation: 0,
      gamesTrained: 0,
      bestScore: 0,
      bestFitness: 0
    };

    // Session-only counters for dialogue purposes (not persisted, not part
    // of the AI's training checkpoint) -- tracks how many "Not me" runs in
    // a row have ended in death, purely so the AI can comment on it.
    let snakeConsecutiveAiDeaths = 0;

    // Recorded (state, action, nextState, reward, done) tuples from "Me"
    // runs, per spec PART 12. This is prepared for future AI training but
    // is NOT consumed by any training step yet, and the AI's model is never
    // modified mid-run from this data (spec: AI must not change weights
    // during the player's current run).
    let snakeExperienceBuffer = [];

    function startSnakeGame() {
      TTBAudio.playStart();
      showView('snakeView');
      initSnakeCanvas();
      loadSnakeHighScore();
      snakeState.status = 'READY';
      showSnakeOverlay('READY');
      updateSnakeAiDebugPanelUI();
    }

    function startSnakeLoop() {
      if (!snakeAnimationId) {
        snakeAnimationId = requestAnimationFrame(snakeGameLoop);
      }
    }

    function initSnakeCanvas() {
      snakeCanvas = document.getElementById('snakeCanvas');
      if (!snakeCanvas) return;
      snakeCtx = snakeCanvas.getContext('2d');

      const container = document.getElementById('snakeBoardContainer');
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const size = Math.floor(rect.width * dpr);

      if (snakeCanvas.width !== size) {
        snakeCanvas.width = size;
        snakeCanvas.height = size;
      }
    }

    window.addEventListener('resize', () => {
      if (currentActiveGame === 'snake' && snakeCanvas) {
        initSnakeCanvas();
        drawSnakeBoard();
      }
    });

    function loadSnakeHighScore() {
      const saved = localStorage.getItem(SNAKE_CONFIG.STORAGE_KEY);
      snakeState.bestScore = saved ? parseInt(saved, 10) : 0;
      document.getElementById('snakeBestDisplay').innerText = snakeState.bestScore;
    }

    function saveSnakeHighScore() {
      if (snakeState.score > snakeState.bestScore) {
        snakeState.bestScore = snakeState.score;
        localStorage.setItem(SNAKE_CONFIG.STORAGE_KEY, snakeState.bestScore.toString());
        document.getElementById('snakeBestDisplay').innerText = snakeState.bestScore;
      }
    }

    function resetSnakeState(mode) {
      snakeState.mode = mode || snakeState.mode || 'ME';
      snakeState.snake = [
        { x: 7, y: 10 },
        { x: 6, y: 10 },
        { x: 5, y: 10 }
      ];
      snakeState.direction = DIRECTIONS.RIGHT;
      snakeState.inputQueue = [];
      snakeState.score = 0;
      snakeState.hasBeatenBestThisRun = false;
      snakeState.moveInterval = SNAKE_CONFIG.INITIAL_INTERVAL;
      snakeState.lastStepTime = 0;
      snakeState.lastFrameTime = 0;
      snakeState.foodEatenAnim = 0;

      snakeExperienceBuffer = [];
      snakeConsecutiveAiDeaths = 0;

      const dialogueEl = document.getElementById('snakeAiDialogue');
      if (snakeState.mode === 'NOT_ME') {
        dialogueEl.style.display = 'block';
        setSnakeAiDialogue(Dialogue.pick(SNAKE_AI_DIALOGUE.opening, 'snake.opening'));
      } else {
        dialogueEl.style.display = 'none';
      }

      spawnFood();
      resetAppleTimeout();
      updateSnakeScoresUI();
    }

    function spawnFood() {
      const occupied = new Set(snakeState.snake.map(segment => `${segment.x},${segment.y}`));
      const freeCells = [];

      for (let x = 0; x < SNAKE_CONFIG.GRID_SIZE; x++) {
        for (let y = 0; y < SNAKE_CONFIG.GRID_SIZE; y++) {
          if (!occupied.has(`${x},${y}`)) freeCells.push({ x, y });
        }
      }

      if (freeCells.length > 0) {
        snakeState.food = freeCells[Math.floor(Math.random() * freeCells.length)];
      }
    }

    /* =====================================================================
       APPLE TIMEOUT -> WARNING -> DEATH ZONE
       =====================================================================
       This is a core gameplay rule that applies identically to Me and Not
       me -- it lives entirely in snakeState/SNAKE_CONFIG and is driven by
       the existing requestAnimationFrame loop's timestamp delta, exactly
       like the existing move-interval timing. No setInterval/setTimeout is
       used, so there is no separate timer loop that could leak or duplicate
       (spec PART 16: only one active timeout process per session).
       ===================================================================== */

    /** Fully clears all Apple Timeout / Death Zone state. Called whenever a
     * fresh apple appears, and whenever the game session ends in any way
     * (game over, Play Again, Main Menu, Not today, mode switch). */
    function resetAppleTimeout() {
      snakeState.appleTimerSeconds = 0;
      snakeState.warningStage = 'NONE';
      snakeState.countdownValue = null;
      snakeState.deathZoneActive = false;
      snakeState.deathZoneElapsedSeconds = 0;
      clearSnakeSystemMessage();
    }

    /**
     * Advances the Apple Timeout clock by `deltaMs` (the same frame delta
     * the game loop already computes). Called once per frame while PLAYING,
     * for both Me and Not me -- identical rules, no AI immunity (spec PART 12).
     *
     * Timeline (seconds since the current apple appeared):
     *   0-29  : NONE
     *   30-39 : WARN_30
     *   40-49 : WARN_40
     *   50    : WARN_50 fires once, right as the 10-second countdown begins
     *   50-59 : COUNTDOWN (10..1)
     *   60+   : Death Zone active
     */
    function updateAppleTimeout(deltaMs) {
      const deltaSeconds = deltaMs / 1000;

      if (snakeState.deathZoneActive) {
        snakeState.deathZoneElapsedSeconds += deltaSeconds;
        return;
      }

      snakeState.appleTimerSeconds += deltaSeconds;
      const t = snakeState.appleTimerSeconds;

      const W1 = SNAKE_CONFIG.APPLE_WARNING_1_SECONDS; // 30
      const W2 = SNAKE_CONFIG.APPLE_WARNING_2_SECONDS; // 40
      const W3 = SNAKE_CONFIG.APPLE_WARNING_3_SECONDS; // 50
      const countdownEnd = W3 + SNAKE_CONFIG.APPLE_COUNTDOWN_SECONDS; // 60: death zone begins here

      // Checked from the highest threshold down, so a single frame that
      // happens to cross more than one boundary at once (e.g. a lag spike)
      // still lands on the correct furthest-along stage instead of getting
      // stuck one stage behind. Each stage's message fires exactly once,
      // the moment `warningStage` changes to that stage.
      if (t >= countdownEnd) {
        snakeState.deathZoneActive = true;
        snakeState.deathZoneElapsedSeconds = t - countdownEnd;
        snakeState.countdownValue = null;
        snakeState.warningStage = 'NONE';
      } else if (t >= W3) {
        const remaining = Math.max(1, Math.min(SNAKE_CONFIG.APPLE_COUNTDOWN_SECONDS, Math.ceil(countdownEnd - t)));
        if (remaining !== snakeState.countdownValue) {
          snakeState.countdownValue = remaining;
          if (snakeState.warningStage !== 'COUNTDOWN') {
            // First tick of the countdown window (remaining === 10): fire
            // the WARN_50 "final warning" line instead of the "10..." tick,
            // per spec section 2/3 -- the final warning IS the moment the
            // countdown begins, not a separate preceding stage.
            snakeState.warningStage = 'COUNTDOWN';
            setSnakeSystemMessage(Dialogue.pick(SNAKE_SYSTEM_DIALOGUE.warn50, 'snake.warn50'));
          } else {
            setSnakeSystemMessage(pickSnakeCountdownLine(remaining));
          }
        }
      } else if (t >= W2) {
        if (snakeState.warningStage !== 'WARN_40') {
          snakeState.warningStage = 'WARN_40';
          setSnakeSystemMessage(Dialogue.pick(SNAKE_SYSTEM_DIALOGUE.warn40, 'snake.warn40'));
        }
      } else if (t >= W1) {
        if (snakeState.warningStage !== 'WARN_30') {
          snakeState.warningStage = 'WARN_30';
          setSnakeSystemMessage(Dialogue.pick(SNAKE_SYSTEM_DIALOGUE.warn30, 'snake.warn30'));
        }
      }
      // else: t < W1 (below 30s) -- stays 'NONE', nothing to trigger yet.
    }

    /**
     * Returns true if grid column `x` currently lies inside the Death Zone.
     * The zone expands LEFT -> RIGHT at DEATH_ZONE_COLUMNS_PER_SECOND,
     * clamped to the actual board width (spec PART 6/7: never hard-coded
     * to 20, always derived from SNAKE_CONFIG.GRID_SIZE).
     */
    function isDeathZoneColumn(x) {
      if (!snakeState.deathZoneActive) return false;
      const dangerousColumns = Math.min(
        SNAKE_CONFIG.GRID_SIZE,
        Math.floor(snakeState.deathZoneElapsedSeconds * SNAKE_CONFIG.DEATH_ZONE_COLUMNS_PER_SECOND)
      );
      return x < dangerousColumns;
    }

    function updateSnakeScoresUI() {
      document.getElementById('snakeScoreDisplay').innerText = snakeState.score;
      document.getElementById('snakeBestDisplay').innerText = snakeState.bestScore;
      document.getElementById('snakeStatusBadge').innerText = snakeState.status;
    }

    function showSnakeOverlay(type) {
      document.getElementById('snakeOverlayReady').style.display = (type === 'READY') ? 'flex' : 'none';
      document.getElementById('snakeOverlayPaused').style.display = (type === 'PAUSED') ? 'flex' : 'none';
      document.getElementById('snakeOverlayGameOver').style.display = (type === 'GAME_OVER') ? 'flex' : 'none';
    }

    function snakeStartRun(mode) {
      TTBAudio.playStart();
      resetSnakeState(mode || 'ME');
      snakeState.status = 'PLAYING';
      showSnakeOverlay('NONE');
      updateSnakeScoresUI();
    }

    /** Play Again: restarts the SAME mode that was just being played (spec PART 8). */
    function snakePlayAgain() {
      snakeStartRun(snakeState.mode);
    }

    /** Main Menu: returns to the WHO WILL PLAY? menu, staying inside Snake (spec PART 9). */
    function mainMenu() {
      TTBAudio.playUI();
      snakeState.status = 'READY';
      document.getElementById('snakeAiDialogue').style.display = 'none';
      resetAppleTimeout();
      showSnakeOverlay('READY');
      updateSnakeScoresUI();
    }

    /** Not today: leaves Snake entirely and returns to the TTB Hub (spec PART 10), using the existing navigation system. */
    function notToday() {
      TTBAudio.playUI();
      resetAppleTimeout();
      showView('hubView');
    }

    function toggleSnakePause() {
      TTBAudio.playUI();
      if (snakeState.status === 'PLAYING') {
        snakeState.status = 'PAUSED';
        showSnakeOverlay('PAUSED');
      } else if (snakeState.status === 'PAUSED') {
        snakeState.status = 'PLAYING';
        showSnakeOverlay('NONE');
        snakeState.lastStepTime = performance.now();
      }
      updateSnakeScoresUI();
    }

    function snakeGameLoop(timestamp) {
      if (currentActiveGame === 'snake') {
        if (snakeState.status === 'PLAYING') {
          if (!snakeState.lastStepTime) snakeState.lastStepTime = timestamp;
          if (!snakeState.lastFrameTime) snakeState.lastFrameTime = timestamp;

          const elapsed = timestamp - snakeState.lastStepTime;
          const frameDelta = timestamp - snakeState.lastFrameTime;
          snakeState.lastFrameTime = timestamp;

          // Apple Timeout runs on real elapsed time every frame, independent
          // of the snake's move speed -- it must not speed up or slow down
          // as moveInterval changes with score.
          updateAppleTimeout(frameDelta);

          if (elapsed >= snakeState.moveInterval) {
            stepSnakeMovement();
            snakeState.lastStepTime = timestamp;
          }
        } else {
          // Not playing (paused, ready, game over): don't let a stale
          // lastFrameTime cause a huge frameDelta jump on resume.
          snakeState.lastFrameTime = 0;
        }
        drawSnakeBoard();
        snakeAnimationId = requestAnimationFrame(snakeGameLoop);
      } else {
        snakeAnimationId = null;
      }
    }

    function stepSnakeMovement() {
      if (snakeState.mode === 'NOT_ME') {
        stepAiOnlyMovement();
        return;
      }

      if (snakeState.inputQueue.length > 0) {
        snakeState.direction = snakeState.inputQueue.shift();
      }

      // Capture the state BEFORE this move, for experience recording below
      // (spec PART 12). Only relevant in "Me" mode; cheap enough to always
      // compute here since encodeSnakeState is a small pure function.
      const stateBeforeMove = encodeSnakeState({
        snakeBody: snakeState.snake,
        food: snakeState.food,
        direction: snakeState.direction,
        gridSize: SNAKE_CONFIG.GRID_SIZE
      });
      const actionTaken = snakeState.direction;

      const head = snakeState.snake[0];
      const newHead = {
        x: head.x + snakeState.direction.x,
        y: head.y + snakeState.direction.y
      };

      if (
        newHead.x < 0 || newHead.x >= SNAKE_CONFIG.GRID_SIZE ||
        newHead.y < 0 || newHead.y >= SNAKE_CONFIG.GRID_SIZE
      ) {
        recordSnakeExperience(stateBeforeMove, actionTaken, stateBeforeMove, -10, true);
        triggerSnakeGameOver();
        return;
      }

      const willEatFood = (newHead.x === snakeState.food.x && newHead.y === snakeState.food.y);
      const bodyCheckLength = willEatFood ? snakeState.snake.length : snakeState.snake.length - 1;

      for (let i = 0; i < bodyCheckLength; i++) {
        if (newHead.x === snakeState.snake[i].x && newHead.y === snakeState.snake[i].y) {
          recordSnakeExperience(stateBeforeMove, actionTaken, stateBeforeMove, -10, true);
          triggerSnakeGameOver();
          return;
        }
      }

      // Death Zone collision (spec PART 8): eating the apple at this exact
      // cell always wins -- landing on food immediately clears the Death
      // Zone (PART 4/17), so a head that reaches the apple is never killed
      // for stepping into a hazardous column on that same move.
      if (!willEatFood && isDeathZoneColumn(newHead.x)) {
        recordSnakeExperience(stateBeforeMove, actionTaken, stateBeforeMove, -10, true);
        triggerSnakeGameOver();
        return;
      }

      snakeState.snake.unshift(newHead);

      if (willEatFood) {
        snakeState.score += 1;
        snakeState.foodEatenAnim = 10;
        
        if (snakeState.bestScore > 0 && snakeState.score > snakeState.bestScore && !snakeState.hasBeatenBestThisRun) {
          snakeState.hasBeatenBestThisRun = true;
          TTBAudio.playNewBest();
        } else if (snakeState.score % 10 === 0) {
          TTBAudio.playMilestone();
        } else {
          TTBAudio.playFood();
        }

        snakeState.moveInterval = Math.max(
          SNAKE_CONFIG.MIN_INTERVAL,
          SNAKE_CONFIG.INITIAL_INTERVAL - (snakeState.score * SNAKE_CONFIG.SPEED_DECREMENT)
        );

        saveSnakeHighScore();
        spawnFood();
        resetAppleTimeout();
        updateSnakeScoresUI();
      } else {
        snakeState.snake.pop();
      }

      const stateAfterMove = encodeSnakeState({
        snakeBody: snakeState.snake,
        food: snakeState.food,
        direction: snakeState.direction,
        gridSize: SNAKE_CONFIG.GRID_SIZE
      });
      recordSnakeExperience(stateBeforeMove, actionTaken, stateAfterMove, willEatFood ? 10 : 0, false);
    }

    /**
     * Records one (state, action, nextState, reward, done) experience tuple
     * from a "Me" run, per spec PART 12. This buffer is prepared for future
     * AI training but nothing currently consumes it -- the AI's model is
     * never modified mid-run, and no training is triggered from here. It's
     * simply collected in a clean structure so a future training step can
     * use it without needing a new data pipeline.
     */
    function recordSnakeExperience(state, action, nextState, reward, done) {
      if (snakeState.mode !== 'ME') return;

      snakeExperienceBuffer.push({ state, action, nextState, reward, done });

      // Cap the buffer so a very long run doesn't grow memory unbounded.
      if (snakeExperienceBuffer.length > SNAKE_CONFIG.MAX_EXPERIENCE_BUFFER) {
        snakeExperienceBuffer.shift();
      }
    }

    function triggerSnakeGameOver() {
      TTBAudio.playGameOver();
      snakeState.status = 'GAME_OVER';
      saveSnakeHighScore();

      document.getElementById('snakeFinalScore').innerText = snakeState.score;
      document.getElementById('snakeFinalBest').innerText = snakeState.bestScore;

      if (snakeState.mode === 'NOT_ME') {
        snakeConsecutiveAiDeaths += 1;

        // Priority: repeated failures is the strongest signal (the AI
        // noticing its own pattern), then score-vs-best commentary, then
        // the plain game-over reaction as a fallback.
        if (snakeConsecutiveAiDeaths >= 2) {
          setSnakeAiDialogue(Dialogue.pick(SNAKE_AI_DIALOGUE.repeatedFailures, 'snake.repeatedFailures'));
        } else if (snakeState.bestScore > 0 && snakeState.score >= snakeState.bestScore) {
          setSnakeAiDialogue(Dialogue.pick(SNAKE_AI_DIALOGUE.beatingPlayerBest, 'snake.beatingBest'));
        } else if (snakeState.bestScore > 0) {
          setSnakeAiDialogue(Dialogue.pick(SNAKE_AI_DIALOGUE.strugglingVsPlayerBest, 'snake.strugglingBest'));
        } else {
          setSnakeAiDialogue(Dialogue.pick(SNAKE_AI_DIALOGUE.gameOver, 'snake.gameOver'));
        }
      }

      showSnakeOverlay('GAME_OVER');
      updateSnakeScoresUI();
    }

    /* =====================================================================
       NOT_ME MODE — AI plays the single Snake by itself
       =====================================================================
       Exactly one Snake exists, exactly as in ME mode -- the difference is
       only WHO decides the next direction each tick. No second snake, no
       cross-snake collision, no match/versus logic of any kind.
       ===================================================================== */

    function stepAiOnlyMovement() {
      if (snakeAiBrain) {
        const aiInput = encodeSnakeState({
          snakeBody: snakeState.snake,
          food: snakeState.food,
          direction: snakeState.direction,
          gridSize: SNAKE_CONFIG.GRID_SIZE
        });
        const aiOutput = snakeAiBrain.predict(aiInput);
        snakeState.direction = decodeSnakeAction(aiOutput, snakeState.direction);
      }

      const head = snakeState.snake[0];
      const newHead = {
        x: head.x + snakeState.direction.x,
        y: head.y + snakeState.direction.y
      };

      if (
        newHead.x < 0 || newHead.x >= SNAKE_CONFIG.GRID_SIZE ||
        newHead.y < 0 || newHead.y >= SNAKE_CONFIG.GRID_SIZE
      ) {
        triggerSnakeGameOver();
        return;
      }

      const willEatFood = (newHead.x === snakeState.food.x && newHead.y === snakeState.food.y);
      const bodyCheckLength = willEatFood ? snakeState.snake.length : snakeState.snake.length - 1;

      for (let i = 0; i < bodyCheckLength; i++) {
        if (newHead.x === snakeState.snake[i].x && newHead.y === snakeState.snake[i].y) {
          triggerSnakeGameOver();
          return;
        }
      }

      // Death Zone collision -- same rule as "Me" mode, no AI immunity
      // (spec PART 12: the AI must not be allowed to ignore the Death Zone).
      if (!willEatFood && isDeathZoneColumn(newHead.x)) {
        triggerSnakeGameOver();
        return;
      }

      snakeState.snake.unshift(newHead);

      if (willEatFood) {
        snakeState.score += 1;
        snakeState.foodEatenAnim = 10;
        TTBAudio.playFood();
        snakeConsecutiveAiDeaths = 0; // a successful bite breaks any death streak

        // Detect a near-death escape BEFORE resetAppleTimeout() clears the
        // relevant state -- eating while the Death Zone was already active,
        // or very late in the countdown, counts as a close call worth
        // commenting on.
        const wasNearDeath = snakeState.deathZoneActive ||
          (snakeState.warningStage === 'COUNTDOWN' && snakeState.countdownValue !== null && snakeState.countdownValue <= 3);

        snakeState.moveInterval = Math.max(
          SNAKE_CONFIG.MIN_INTERVAL,
          SNAKE_CONFIG.INITIAL_INTERVAL - (snakeState.score * SNAKE_CONFIG.SPEED_DECREMENT)
        );

        saveSnakeHighScore();
        spawnFood();
        resetAppleTimeout();
        updateSnakeScoresUI();

        // Occasionally yap about how the AI's own run is going (spec PART 13),
        // kept infrequent so it doesn't spam a line every single food eaten.
        // This runs AFTER resetAppleTimeout() so the milestone/near-death
        // line isn't immediately cleared by the timeout reset. Near-death
        // takes priority over the plain milestone since it's a stronger,
        // more specific moment worth reacting to.
        if (wasNearDeath) {
          setSnakeAiDialogue(Dialogue.pick(SNAKE_AI_DIALOGUE.nearDeathEscape, 'snake.nearDeath'));
        } else if (snakeState.score % 5 === 0) {
          setSnakeAiDialogue(Dialogue.pick(SNAKE_AI_DIALOGUE.milestone, 'snake.milestone'));
        }
      } else {
        snakeState.snake.pop();
      }
    }

    /**
     * Draws the Death Zone as a simple darkened/danger-colored overlay
     * across its currently-dangerous columns (spec PART 9: keep the visual
     * simple, no heavy effects). A subtle pulsing alpha makes it read as
     * "active hazard" rather than a static decoration.
     */
    function drawDeathZone(cellSize, height) {
      if (!snakeState.deathZoneActive) return;

      const dangerousColumns = Math.min(
        SNAKE_CONFIG.GRID_SIZE,
        Math.floor(snakeState.deathZoneElapsedSeconds * SNAKE_CONFIG.DEATH_ZONE_COLUMNS_PER_SECOND)
      );
      if (dangerousColumns <= 0) return;

      const pulse = 0.12 + 0.06 * Math.sin(performance.now() / 200);
      snakeCtx.fillStyle = `rgba(220, 38, 38, ${0.35 + pulse})`;
      snakeCtx.fillRect(0, 0, dangerousColumns * cellSize, height);

      // A brighter leading edge so the current danger boundary is obvious.
      snakeCtx.fillStyle = 'rgba(248, 113, 113, 0.6)';
      snakeCtx.fillRect(Math.max(0, dangerousColumns * cellSize - 3), 0, 3, height);
    }

    function drawSnakeBoard() {
      if (!snakeCtx || !snakeCanvas) return;

      const width = snakeCanvas.width;
      const height = snakeCanvas.height;
      const cellSize = width / SNAKE_CONFIG.GRID_SIZE;

      snakeCtx.fillStyle = '#0f172a';
      snakeCtx.fillRect(0, 0, width, height);

      snakeCtx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      snakeCtx.lineWidth = 1;

      for (let i = 0; i <= SNAKE_CONFIG.GRID_SIZE; i++) {
        const pos = Math.floor(i * cellSize);
        
        snakeCtx.beginPath();
        snakeCtx.moveTo(pos, 0);
        snakeCtx.lineTo(pos, height);
        snakeCtx.stroke();

        snakeCtx.beginPath();
        snakeCtx.moveTo(0, pos);
        snakeCtx.lineTo(width, pos);
        snakeCtx.stroke();
      }

      drawDeathZone(cellSize, height);

      const fx = (snakeState.food.x + 0.5) * cellSize;
      const fy = (snakeState.food.y + 0.5) * cellSize;
      const foodRadius = (cellSize / 2) * 0.75;

      snakeCtx.fillStyle = 'rgba(244, 63, 94, 0.25)';
      snakeCtx.beginPath();
      snakeCtx.arc(fx, fy, foodRadius * 1.4, 0, Math.PI * 2);
      snakeCtx.fill();

      snakeCtx.fillStyle = '#f43f5e';
      snakeCtx.beginPath();
      snakeCtx.arc(fx, fy, foodRadius, 0, Math.PI * 2);
      snakeCtx.fill();

      snakeCtx.fillStyle = '#fda4af';
      snakeCtx.beginPath();
      snakeCtx.arc(fx - foodRadius * 0.3, fy - foodRadius * 0.3, foodRadius * 0.3, 0, Math.PI * 2);
      snakeCtx.fill();

      const bodyLen = snakeState.snake.length;
      drawSnakeBody(snakeState.snake, snakeState.direction, {
        headColor: snakeState.mode === 'NOT_ME' ? '#f43f5e' : '#10b981',
        bodyColorRGB: snakeState.mode === 'NOT_ME' ? '244, 63, 94' : '16, 185, 129'
      });

      if (snakeState.foodEatenAnim > 0) {
        snakeState.foodEatenAnim--;
        snakeCtx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
        snakeCtx.lineWidth = 3;
        snakeCtx.beginPath();
        snakeCtx.arc(fx, fy, foodRadius * (2 - snakeState.foodEatenAnim / 10), 0, Math.PI * 2);
        snakeCtx.stroke();
      }
    }

    /**
     * Draws the snake's body onto the shared canvas/cellSize context.
     * Colors are chosen by the caller based on the current mode (green for
     * "Me", red for "Not me") so the player can tell at a glance who's
     * currently in control.
     */
    function drawSnakeBody(body, direction, colorScheme) {
      const cellSize = snakeCanvas.width / SNAKE_CONFIG.GRID_SIZE;
      const bodyLen = body.length;

      body.forEach((segment, index) => {
        const x = segment.x * cellSize;
        const y = segment.y * cellSize;
        const pad = 2;
        const size = cellSize - pad * 2;

        if (index === 0) {
          snakeCtx.fillStyle = colorScheme.headColor;
          if (snakeCtx.roundRect) {
            snakeCtx.beginPath();
            snakeCtx.roundRect(x + pad, y + pad, size, size, 8);
            snakeCtx.fill();
          } else {
            snakeCtx.fillRect(x + pad, y + pad, size, size);
          }

          snakeCtx.fillStyle = '#0f172a';
          const dir = direction;
          let eye1X, eye1Y, eye2X, eye2Y;
          const eyeR = size * 0.12;

          if (dir === DIRECTIONS.RIGHT) {
            eye1X = x + size * 0.7; eye1Y = y + size * 0.3;
            eye2X = x + size * 0.7; eye2Y = y + size * 0.7;
          } else if (dir === DIRECTIONS.LEFT) {
            eye1X = x + size * 0.3; eye1Y = y + size * 0.3;
            eye2X = x + size * 0.3; eye2Y = y + size * 0.7;
          } else if (dir === DIRECTIONS.UP) {
            eye1X = x + size * 0.3; eye1Y = y + size * 0.3;
            eye2X = x + size * 0.7; eye2Y = y + size * 0.3;
          } else {
            eye1X = x + size * 0.3; eye1Y = y + size * 0.7;
            eye2X = x + size * 0.7; eye2Y = y + size * 0.7;
          }

          snakeCtx.beginPath();
          snakeCtx.arc(eye1X, eye1Y, eyeR, 0, Math.PI * 2);
          snakeCtx.arc(eye2X, eye2Y, eyeR, 0, Math.PI * 2);
          snakeCtx.fill();

        } else {
          const alpha = 1 - (index / bodyLen) * 0.45;
          snakeCtx.fillStyle = `rgba(${colorScheme.bodyColorRGB}, ${alpha})`;
          if (snakeCtx.roundRect) {
            snakeCtx.beginPath();
            snakeCtx.roundRect(x + pad + 1, y + pad + 1, size - 2, size - 2, 5);
            snakeCtx.fill();
          } else {
            snakeCtx.fillRect(x + pad + 1, y + pad + 1, size - 2, size - 2);
          }
        }
      });
    }

    function queueDirection(newDir) {
      if (snakeState.status !== 'PLAYING') return;
      if (snakeState.mode === 'NOT_ME') return; // AI controls movement in this mode, not the player

      const lastDir = (snakeState.inputQueue.length > 0) 
        ? snakeState.inputQueue[snakeState.inputQueue.length - 1] 
        : snakeState.direction;

      if (newDir.x === -lastDir.x && newDir.y === -lastDir.y) return;
      if (newDir.x === lastDir.x && newDir.y === lastDir.y) return;

      if (snakeState.inputQueue.length < 2) {
        snakeState.inputQueue.push(newDir);
      }
    }

    window.addEventListener('keydown', (e) => {
      if (currentActiveGame !== 'snake') return;

      switch (e.key) {
        case 'ArrowUp': case 'w': case 'W':
          queueDirection(DIRECTIONS.UP);
          if (snakeState.status === 'PLAYING') e.preventDefault();
          break;
        case 'ArrowDown': case 's': case 'S':
          queueDirection(DIRECTIONS.DOWN);
          if (snakeState.status === 'PLAYING') e.preventDefault();
          break;
        case 'ArrowLeft': case 'a': case 'A':
          queueDirection(DIRECTIONS.LEFT);
          if (snakeState.status === 'PLAYING') e.preventDefault();
          break;
        case 'ArrowRight': case 'd': case 'D':
          queueDirection(DIRECTIONS.RIGHT);
          if (snakeState.status === 'PLAYING') e.preventDefault();
          break;
        case 'p': case 'P': case ' ':
          if (snakeState.status === 'PLAYING' || snakeState.status === 'PAUSED') {
            toggleSnakePause();
            e.preventDefault();
          }
          break;
      }
    });

    let touchStartX = 0;
    let touchStartY = 0;
    const MIN_SWIPE_DISTANCE = 20;

    const boardContainer = document.getElementById('snakeBoardContainer');

    boardContainer.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    boardContainer.addEventListener('touchmove', (e) => {
      if (snakeState.status === 'PLAYING') e.preventDefault();
    }, { passive: false });

    boardContainer.addEventListener('touchend', (e) => {
      if (snakeState.status !== 'PLAYING') return;
      if (!e.changedTouches || e.changedTouches.length === 0) return;

      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;

      if (Math.hypot(dx, dy) >= MIN_SWIPE_DISTANCE) {
        if (Math.abs(dx) > Math.abs(dy)) {
          queueDirection(dx > 0 ? DIRECTIONS.RIGHT : DIRECTIONS.LEFT);
        } else {
          queueDirection(dy > 0 ? DIRECTIONS.DOWN : DIRECTIONS.UP);
        }
      }
    }, { passive: true });

    /* =====================================================================
       SNAKE AI — dialogue, bootstrap training, persistence, and debug panel
       =====================================================================
       This section is deliberately separate from the pure gameplay code
       above. Per spec PART 18, dialogue/personality logic never lives
       inside the Neural Network -- it only reacts to match results here.
       ===================================================================== */

    /* --- 13. AI DIALOGUE --- */
    // Personality/content lives in js/dialogue/snake-dialogue.js (SNAKE_AI_DIALOGUE,
    // SNAKE_SYSTEM_DIALOGUE). Selection goes through the shared Dialogue
    // utility (js/core/dialogue.js). This section only decides WHICH pool
    // applies and displays the result -- no line text belongs here.
    // The Neural Network never sees or influences any of this; it only ever
    // decides movement (encodeSnakeState -> predict -> decodeSnakeAction).

    function setSnakeAiDialogue(line) {
      const el = document.getElementById('snakeAiDialogue');
      el.style.display = 'block';
      el.innerText = `"${line}"`;
    }

    /**
     * Countdown numbers themselves ARE the message most of the time (per
     * spec example: "10...","9...","8..." etc.), with an occasional flavor
     * line mixed in at specific points, and a distinct final beat at 1.
     */
    function pickSnakeCountdownLine(remaining) {
      if (remaining === 7) return Dialogue.pick(SNAKE_SYSTEM_DIALOGUE.countdownHigh, 'snake.countdownHigh');
      if (remaining === 4) return Dialogue.pick(SNAKE_SYSTEM_DIALOGUE.countdownLow, 'snake.countdownLow');
      if (remaining === 1) return "💀";
      return `${remaining}...`;
    }

    function setSnakeSystemMessage(line) {
      const el = document.getElementById('snakeAiDialogue');
      el.style.display = 'block';
      el.innerText = `"${line}"`;
    }

    function clearSnakeSystemMessage() {
      // Only hide the dialogue box if there's no AI yapping that should
      // still be showing (Not me mode keeps its own opening/milestone
      // lines visible outside of warning windows).
      if (snakeState.mode !== 'NOT_ME') {
        document.getElementById('snakeAiDialogue').style.display = 'none';
      }
    }

    /* --- Persistence: load a brain from checkpoint, or bootstrap-train one --- */
    // Incremented every time a new training run starts (bootstrap, manual,
    // or re-bootstrap after reset). Each training run's callbacks capture
    // the token value at the time they were scheduled and check it before
    // writing to snakeAiStatus/snakeAiBrain -- this prevents a stale,
    // still-running training session (e.g. one interrupted by Reset AI)
    // from overwriting state that a newer session (or a reset) has since
    // replaced.
    let snakeAiTrainingToken = 0;

    function loadOrBootstrapSnakeAi() {
      const checkpoint = loadAiCheckpoint();

      if (checkpoint && checkpoint.currentModelWeights) {
        snakeAiBrain = NeuralNetwork.fromJSON(checkpoint.currentModelWeights);
        snakeAiStatus = {
          state: 'Ready',
          generation: checkpoint.generation,
          gamesTrained: checkpoint.gamesTrained,
          bestScore: checkpoint.bestScore,
          bestFitness: checkpoint.bestFitness
        };
        console.log(`[Snake AI] Loaded checkpoint: generation ${checkpoint.generation}, bestScore ${checkpoint.bestScore}`);
        updateSnakeAiDebugPanelUI();
        return;
      }

      // No checkpoint yet: bootstrap-train a basic model in the background.
      // This does NOT block gameplay -- the player can still play "Me"
      // immediately. If they pick "Not me" before this finishes, a simple
      // untrained fallback brain is used (see snakeAiBrain default below).
      snakeAiBrain = createSnakeBrain(); // fallback brain, used until bootstrap finishes
      snakeAiStatus.state = 'Bootstrapping';
      updateSnakeAiDebugPanelUI();
      console.log('[Snake AI] No checkpoint found. Starting background bootstrap training...');

      const myToken = ++snakeAiTrainingToken;

      runTraining({
        generations: SNAKE_CONFIG.AI_BOOTSTRAP_GENERATIONS,
        onGenerationComplete: ({ generation, bestFitness, bestScore }) => {
          if (myToken !== snakeAiTrainingToken) return; // superseded by a reset/newer run; ignore
          snakeAiStatus.generation = generation;
          snakeAiStatus.gamesTrained += NEUROEVOLUTION_CONFIG.POPULATION_SIZE;
          if (bestFitness > snakeAiStatus.bestFitness) {
            snakeAiStatus.bestFitness = bestFitness;
            snakeAiStatus.bestScore = bestScore;
          }
          if (generation % 20 === 0) updateSnakeAiDebugPanelUI();
        }
      }).then(result => {
        if (myToken !== snakeAiTrainingToken) return; // superseded; discard this result entirely

        snakeAiBrain = result.bestBrain;
        snakeAiStatus.state = 'Ready';
        snakeAiStatus.bestScore = result.bestScore;
        snakeAiStatus.bestFitness = result.bestFitness;

        saveAiCheckpoint({
          generation: snakeAiStatus.generation,
          gamesTrained: snakeAiStatus.gamesTrained,
          bestScore: snakeAiStatus.bestScore,
          bestFitness: snakeAiStatus.bestFitness,
          currentModelWeights: result.bestBrain.toJSON(),
          bestModelWeights: result.bestBrain.toJSON(),
          trainingStats: {}
        });

        console.log(`[Snake AI] Bootstrap training complete. Best score: ${result.bestScore}`);
        updateSnakeAiDebugPanelUI();
      });
    }

    /* --- Debug panel (spec PART 20): hidden by default, toggled by the player --- */
    function toggleSnakeAiDebugPanel() {
      const panel = document.getElementById('snakeAiDebugPanel');
      const isOpen = panel.style.display === 'flex';
      panel.style.display = isOpen ? 'none' : 'flex';
      if (!isOpen) updateSnakeAiDebugPanelUI();
    }

    function updateSnakeAiDebugPanelUI() {
      const statusEl = document.getElementById('snakeAiDebugStatus');
      if (!statusEl) return; // panel not in DOM yet (shouldn't happen, but stay safe)

      document.getElementById('snakeAiDebugStatus').innerText = snakeAiStatus.state;
      document.getElementById('snakeAiDebugGeneration').innerText = snakeAiStatus.generation;
      document.getElementById('snakeAiDebugGames').innerText = snakeAiStatus.gamesTrained;
      document.getElementById('snakeAiDebugBestScore').innerText = snakeAiStatus.bestScore;
      document.getElementById('snakeAiDebugBestFitness').innerText = snakeAiStatus.bestFitness.toFixed(1);
      document.getElementById('snakeAiDebugVersion').innerText = AI_STORAGE_CONFIG.MODEL_VERSION;
    }

    /* --- Debug panel actions: manual training, save, reset (spec PART 15) --- */
    function debugTrainSnakeAi(generationCount) {
      snakeAiStatus.state = 'Training';
      updateSnakeAiDebugPanelUI();
      console.log(`[Snake AI] Manual training: +${generationCount} generations...`);

      const myToken = ++snakeAiTrainingToken; // supersede any still-running training session

      runTraining({
        generations: generationCount,
        initialPopulation: null, // manual training starts a fresh population each time, kept simple per spec ("do not over-engineer")
        onGenerationComplete: ({ generation }) => {
          if (myToken !== snakeAiTrainingToken) return;
          snakeAiStatus.gamesTrained += NEUROEVOLUTION_CONFIG.POPULATION_SIZE;
        }
      }).then(result => {
        if (myToken !== snakeAiTrainingToken) return; // superseded; discard

        // Per spec PART 14: only replace the current model if the new
        // result is actually better than what we already have.
        if (result.bestFitness > snakeAiStatus.bestFitness) {
          snakeAiBrain = result.bestBrain;
          snakeAiStatus.bestFitness = result.bestFitness;
          snakeAiStatus.bestScore = result.bestScore;
          console.log('[Snake AI] Manual training improved the model.');
        } else {
          console.log('[Snake AI] Manual training did not beat the existing best model; keeping current model.');
        }
        snakeAiStatus.generation += generationCount;
        snakeAiStatus.state = 'Ready';
        updateSnakeAiDebugPanelUI();
      });
    }

    function debugSaveSnakeAiCheckpoint() {
      saveAiCheckpoint({
        generation: snakeAiStatus.generation,
        gamesTrained: snakeAiStatus.gamesTrained,
        bestScore: snakeAiStatus.bestScore,
        bestFitness: snakeAiStatus.bestFitness,
        currentModelWeights: snakeAiBrain.toJSON(),
        bestModelWeights: snakeAiBrain.toJSON(),
        trainingStats: {}
      });
      updateSnakeAiDebugPanelUI();
    }

    function debugResetSnakeAi() {
      if (!confirm('Reset everything the AI has learned?')) return;

      snakeAiTrainingToken++; // supersede any in-flight training so it can't overwrite the reset

      resetAiCheckpoint();
      snakeAiBrain = createSnakeBrain();
      snakeAiStatus = {
        state: 'Idle',
        generation: 0,
        gamesTrained: 0,
        bestScore: 0,
        bestFitness: 0
      };
      updateSnakeAiDebugPanelUI();
      console.log('[Snake AI] AI has been reset.');

      // Re-bootstrap immediately so the AI isn't left with a useless random
      // brain until the player happens to reopen the debug panel.
      loadOrBootstrapSnakeAi();
    }

    // Load (or bootstrap-train) the AI's brain once when this script loads,
    // not every time the player enters the Snake view -- this matches the
    // "persistent, not reset automatically" requirement (spec PART 12) and
    // avoids re-triggering bootstrap training on every visit.
    loadOrBootstrapSnakeAi();

