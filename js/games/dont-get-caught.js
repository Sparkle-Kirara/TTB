    const DGC_CONFIG = {
      STORAGE_KEY: 'ttb_dgc_level_highscore'
    };

    let dgcState = {
      status: 'READY', // 'READY', 'PLAYING', 'LEVEL_COMPLETE', 'GAME_OVER'
      level: 0,
      gridSize: 7,
      player: { x: 0, y: 0 },
      ai: { x: 0, y: 0 },
      goal: { x: 0, y: 0 },
      obstacles: new Set(),
      turns: 0,
      bestLevel: 0,
      playerHistory: [], // Stores recent dx, dy vectors
      renderPlayer: { x: 0, y: 0 },
      renderAi: { x: 0, y: 0 },
      // --- Behavior tracking for dialogue only (spec PART 8) -- none of
      // this affects the AI's chase logic, only what it says. ---
      consecutiveWins: 0,
      consecutiveLosses: 0,
      consecutiveEscapes: 0,   // successful escapes from a near-miss, this run
      hadNearMissThisLevel: false,
      wasEverAdjacentThisLevel: false
    };

    let dgcCanvas, dgcCtx;
    let dgcAnimationId = null;

    function startDgcGame() {
      TTBAudio.playStart();
      showView('dgcView');
      initDgcCanvas();
      loadDgcHighScore();
      dgcState.level = 0;
      dgcState.consecutiveWins = 0;
      dgcState.consecutiveLosses = 0;
      generateDgcLevel(0);
      showDgcOverlay('READY');
    }

    function startDgcLoop() {
      if (!dgcAnimationId) {
        dgcAnimationId = requestAnimationFrame(dgcGameLoop);
      }
    }

    function initDgcCanvas() {
      dgcCanvas = document.getElementById('dgcCanvas');
      if (!dgcCanvas) return;
      dgcCtx = dgcCanvas.getContext('2d');

      const container = document.getElementById('dgcBoardContainer');
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const size = Math.floor(rect.width * dpr);

      if (dgcCanvas.width !== size) {
        dgcCanvas.width = size;
        dgcCanvas.height = size;
      }
    }

    window.addEventListener('resize', () => {
      if (currentActiveGame === 'dgc' && dgcCanvas) {
        initDgcCanvas();
        drawDgcBoard();
      }
    });

    function loadDgcHighScore() {
      const saved = localStorage.getItem(DGC_CONFIG.STORAGE_KEY);
      dgcState.bestLevel = saved ? parseInt(saved, 10) : 0;
      document.getElementById('dgcBestDisplay').innerText = dgcState.bestLevel;
    }

    function saveDgcHighScore() {
      if (dgcState.level > dgcState.bestLevel) {
        dgcState.bestLevel = dgcState.level;
        localStorage.setItem(DGC_CONFIG.STORAGE_KEY, dgcState.bestLevel.toString());
        document.getElementById('dgcBestDisplay').innerText = dgcState.bestLevel;
      }
    }

    function getDgcLevelConfig(level) {
      const size = Math.min(11, 7 + level);
      let obstacleCount = 0;
      if (level === 1) obstacleCount = 3;
      else if (level === 2) obstacleCount = 6;
      else if (level === 3) obstacleCount = 10;
      else if (level >= 4) obstacleCount = Math.min(22, 12 + (level - 4) * 3);

      return { size, obstacleCount };
    }

    function generateDgcLevel(level) {
      const config = getDgcLevelConfig(level);
      dgcState.gridSize = config.size;
      dgcState.turns = 0;
      dgcState.playerHistory = [];
      dgcState.hadNearMissThisLevel = false;
      dgcState.wasEverAdjacentThisLevel = false;
      dgcState.consecutiveEscapes = 0;

      let validMapFound = false;
      let attempts = 0;

      while (!validMapFound && attempts < 100) {
        attempts++;
        dgcState.obstacles = new Set();

        // 1. Set Player start (bottom-left area)
        dgcState.player = { x: 1, y: config.size - 2 };
        dgcState.renderPlayer = { x: 1, y: config.size - 2 };

        // 2. Set Goal start (top-right area)
        dgcState.goal = { x: config.size - 2, y: 1 };

        // 3. Set AI start (far edge from player, e.g., top-left or bottom-right)
        dgcState.ai = { x: config.size - 2, y: config.size - 2 };
        dgcState.renderAi = { x: config.size - 2, y: config.size - 2 };

        // 4. Place Obstacles
        if (config.obstacleCount > 0) {
          let placed = 0;
          while (placed < config.obstacleCount) {
            const ox = Math.floor(Math.random() * config.size);
            const oy = Math.floor(Math.random() * config.size);
            const key = `${ox},${oy}`;

            // Exclude Player, Goal, AI, and immediate surrounding cells of Player
            const isPlayerZone = Math.abs(ox - dgcState.player.x) <= 1 && Math.abs(oy - dgcState.player.y) <= 1;
            const isGoalZone = (ox === dgcState.goal.x && oy === dgcState.goal.y);
            const isAiZone = (ox === dgcState.ai.x && oy === dgcState.ai.y);

            if (!dgcState.obstacles.has(key) && !isPlayerZone && !isGoalZone && !isAiZone) {
              dgcState.obstacles.add(key);
              placed++;
            }
          }
        }

        // 5. Verify Reachability (Player -> Goal & AI -> Player)
        const playerToGoalPath = findBfsPath(dgcState.player, dgcState.goal, dgcState.obstacles, dgcState.gridSize);
        const aiToPlayerPath = findBfsPath(dgcState.ai, dgcState.player, dgcState.obstacles, dgcState.gridSize);

        // 6. Fairness Check: the player needs a real escape window, not just
        // "a path exists". Reject maps where the AI starts close enough to
        // the player to threaten an almost-immediate catch.
        //
        // Note: with this game's corner-to-corner spawn layout (player and
        // goal are diagonal, AI shares an edge with the player), AI->player
        // distance is naturally much shorter than player->goal distance —
        // comparing the two directly would reject nearly every map. Instead,
        // require the AI to need a minimum number of turns to reach the
        // player's start position, which is a direct, reliable proxy for
        // "the player isn't cornered on turn one".
        const hasPaths = playerToGoalPath.length > 0 && aiToPlayerPath.length > 0;
        const minAiStartDistance = 3;

        if (hasPaths && aiToPlayerPath.length >= minAiStartDistance) {
          validMapFound = true;
        }
      }

      updateDgcScoresUI();
    }

    // BFS Pathfinding Utility.
    // `preferredDirs`, if given, reorders direction expansion so that among
    // multiple equally-short paths, the one starting along the given axis
    // priority is found first. This matters because plain BFS with a fixed
    // direction order (e.g. always trying UP before LEFT) silently biases
    // the very first step toward one axis regardless of which axis actually
    // has the larger gap — which is what made the AI look like it was just
    // copying the player's last direction instead of chasing their position.
    function findBfsPath(start, target, obstacles, gridSize, preferredDirs) {
      if (start.x === target.x && start.y === target.y) return [];

      const queue = [[start]];
      const visited = new Set([`${start.x},${start.y}`]);
      const dirs = preferredDirs || [{x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0}];

      while (queue.length > 0) {
        const path = queue.shift();
        const curr = path[path.length - 1];

        if (curr.x === target.x && curr.y === target.y) {
          return path.slice(1); // Return path excluding starting position
        }

        for (const d of dirs) {
          const nx = curr.x + d.x;
          const ny = curr.y + d.y;
          const key = `${nx},${ny}`;

          if (
            nx >= 0 && nx < gridSize &&
            ny >= 0 && ny < gridSize &&
            !obstacles.has(key) &&
            !visited.has(key)
          ) {
            visited.add(key);
            queue.push([...path, { x: nx, y: ny }]);
          }
        }
      }

      return []; // No path found
    }

    function updateDgcScoresUI() {
      document.getElementById('dgcTurnDisplay').innerText = dgcState.turns;
      document.getElementById('dgcBestDisplay').innerText = dgcState.bestLevel;
      document.getElementById('dgcLevelDisplay').innerText = `LEVEL ${dgcState.level}`;
    }

    function showDgcOverlay(type) {
      document.getElementById('dgcOverlayReady').style.display = (type === 'READY') ? 'flex' : 'none';
      document.getElementById('dgcOverlayLevelComplete').style.display = (type === 'LEVEL_COMPLETE') ? 'flex' : 'none';
      document.getElementById('dgcOverlayGameOver').style.display = (type === 'GAME_OVER') ? 'flex' : 'none';
    }

    function dgcStartRun() {
      TTBAudio.playStart();
      dgcState.status = 'PLAYING';
      showDgcOverlay('NONE');
      updateDgcScoresUI();
    }

    function dgcNextLevelRun() {
      TTBAudio.playStart();
      dgcState.level += 1;
      saveDgcHighScore();
      generateDgcLevel(dgcState.level);
      dgcState.status = 'PLAYING';
      showDgcOverlay('NONE');
      updateDgcScoresUI();
    }

    function dgcRetryRun() {
      TTBAudio.playStart();
      generateDgcLevel(dgcState.level);
      dgcState.status = 'PLAYING';
      showDgcOverlay('NONE');
      updateDgcScoresUI();
    }

    function executeDgcTurn(dx, dy) {
      if (dgcState.status !== 'PLAYING') return;

      const newPx = dgcState.player.x + dx;
      const newPy = dgcState.player.y + dy;

      // 1. VALIDATE PLAYER BOUNDS & OBSTACLES
      if (
        newPx < 0 || newPx >= dgcState.gridSize ||
        newPy < 0 || newPy >= dgcState.gridSize ||
        dgcState.obstacles.has(`${newPx},${newPy}`)
      ) {
        return;
      }

      const wasFirstMoveThisLevel = (dgcState.turns === 0);
      const distBeforeMove = Math.abs(dgcState.player.x - dgcState.ai.x) + Math.abs(dgcState.player.y - dgcState.ai.y);
      const goalDistBefore = Math.abs(dgcState.player.x - dgcState.goal.x) + Math.abs(dgcState.player.y - dgcState.goal.y);

      // 2. PLAYER MOVES
      dgcState.player.x = newPx;
      dgcState.player.y = newPy;
      dgcState.turns += 1;
      TTBAudio.playSelect();

      // Record Player Movement Vector
      dgcState.playerHistory.push({ dx, dy });
      if (dgcState.playerHistory.length > 4) dgcState.playerHistory.shift();

      const goalDistAfter = Math.abs(dgcState.player.x - dgcState.goal.x) + Math.abs(dgcState.player.y - dgcState.goal.y);
      const distAfterPlayerMove = Math.abs(dgcState.player.x - dgcState.ai.x) + Math.abs(dgcState.player.y - dgcState.ai.y);

      // A "near miss" is the player having been directly adjacent to the AI
      // (one step from being caught) at some point this level -- tracked so
      // an eventual escape/goal can reference it.
      if (distAfterPlayerMove === 1) {
        dgcState.hadNearMissThisLevel = true;
        dgcState.wasEverAdjacentThisLevel = true;
      }

      // 3. CHECK GOAL REACHED
      if (dgcState.player.x === dgcState.goal.x && dgcState.player.y === dgcState.goal.y) {
        triggerDgcLevelComplete();
        return;
      }

      // 4. CHECK IF PLAYER DIRECTLY WALKED INTO AI
      if (dgcState.player.x === dgcState.ai.x && dgcState.player.y === dgcState.ai.y) {
        triggerDgcGameOver();
        return;
      }

      // 5. AI STRATEGIC MOVE
      computeAndApplyAiMove();

      // 6. CHECK IF AI CAUGHT PLAYER AFTER AI STEP
      if (dgcState.ai.x === dgcState.player.x && dgcState.ai.y === dgcState.player.y) {
        triggerDgcGameOver();
        return;
      }

      const distAfterAiMove = Math.abs(dgcState.player.x - dgcState.ai.x) + Math.abs(dgcState.player.y - dgcState.ai.y);

      maybeSpeakDgcMoveEvent({
        wasFirstMoveThisLevel,
        goalDistBefore,
        goalDistAfter,
        distBeforeMove,
        distAfterAiMove
      });

      updateDgcScoresUI();
    }

    /**
     * Decides whether to say anything after a normal (non-terminal) turn,
     * and which pool to pick from if so. Kept deliberately low-frequency --
     * per-turn commentary on every single move would be noisy, so most
     * turns say nothing at all. Priority order roughly follows spec section
     * 9's Reactive > Behavioral > Personality organization, biased toward
     * the most specific/interesting signal available this turn.
     */
    function maybeSpeakDgcMoveEvent({ wasFirstMoveThisLevel, goalDistBefore, goalDistAfter, distBeforeMove, distAfterAiMove }) {
      if (wasFirstMoveThisLevel) {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.playerStartsMoving, 'dgc.startMoving'));
        return;
      }

      // Near miss: AI is now adjacent to the player (one step from a catch).
      if (distAfterAiMove === 1) {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.nearMiss, 'dgc.nearMiss'));
        return;
      }

      // Escape: the AI was adjacent last turn but the gap just widened --
      // the player got away from an immediate-catch situation.
      if (distBeforeMove === 1 && distAfterAiMove > 1) {
        dgcState.consecutiveEscapes += 1;
        if (dgcState.consecutiveEscapes >= 2) {
          setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.playerEscapesRepeatedly, 'dgc.escapesRepeated'));
        } else {
          setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.playerEscapes, 'dgc.escapes'));
        }
        return;
      }

      // Sudden direction change vs. repeated movement -- checked from the
      // player's recent history (spec PART 8).
      const pattern = detectDgcMovementPattern();
      if (pattern === 'REPEATED' && Math.random() < 0.4) {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.playerRepeatsMovement, 'dgc.repeatsMovement'));
        return;
      }
      if (pattern === 'SUDDEN_CHANGE' && Math.random() < 0.4) {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.playerSuddenDirectionChange, 'dgc.suddenChange'));
        return;
      }

      // AI closing in, vs. player making progress toward the goal -- lower
      // priority flavor commentary, said only occasionally.
      if (distAfterAiMove <= 2 && Math.random() < 0.25) {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.aiGetsClose, 'dgc.aiClose'));
        return;
      }
      if (goalDistAfter < goalDistBefore && Math.random() < 0.15) {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.playerMovesTowardGoal, 'dgc.towardGoal'));
        return;
      }
      if (goalDistAfter > goalDistBefore && Math.random() < 0.15) {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.playerMovesAwayFromGoal, 'dgc.awayGoal'));
        return;
      }

      // Long survival: an occasional check-in if the level has gone on a while.
      if (dgcState.turns > 20 && Math.random() < 0.1) {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.playerSurvivesLong, 'dgc.survivesLong'));
      }
    }

    /** Looks at the last 3-4 recorded movement vectors for a simple repeated-direction or sudden-change signal. */
    function detectDgcMovementPattern() {
      const h = dgcState.playerHistory;
      if (h.length < 3) return null;

      const last3 = h.slice(-3);
      const allSame = last3.every(v => v.dx === last3[0].dx && v.dy === last3[0].dy);
      if (allSame) return 'REPEATED';

      if (h.length >= 4) {
        const older = h[h.length - 4];
        const newest = h[h.length - 1];
        const wasConsistent = h.slice(-4, -1).every(v => v.dx === older.dx && v.dy === older.dy);
        const reversed = (newest.dx === -older.dx && newest.dy === -older.dy);
        if (wasConsistent && reversed) return 'SUDDEN_CHANGE';
      }

      return null;
    }

    function setDgcDialogue(line) {
      const el = document.getElementById('dgcDialogue');
      if (!el) return;
      el.style.display = 'block';
      el.innerText = `"${line}"`;
    }

    // Builds a direction-priority list for BFS so the first move found among
    // equally-short paths favors whichever axis (x or y) currently has the
    // larger gap between the AI and its target — matching the "chase the
    // player's actual position, prioritize the farther axis" rule.
    function getAxisPriorityDirs(fromPos, toPos) {
      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const horizontal = { x: dx >= 0 ? 1 : -1, y: 0 };
      const vertical = { x: 0, y: dy >= 0 ? 1 : -1 };
      const horizontalOpp = { x: -horizontal.x, y: 0 };
      const verticalOpp = { x: 0, y: -vertical.y };

      if (Math.abs(dx) >= Math.abs(dy)) {
        return [horizontal, vertical, verticalOpp, horizontalOpp];
      }
      return [vertical, horizontal, horizontalOpp, verticalOpp];
    }

    // Chance the AI takes a suboptimal-but-valid step instead of the best
    // BFS move, so it never feels like a perfect, unbeatable interceptor.
    // Decreases with level: very forgiving early on, mostly optimal later.
    function getDgcImperfectionChance(level) {
      if (level <= 0) return 0.35;
      if (level === 1) return 0.22;
      if (level === 2) return 0.12;
      if (level === 3) return 0.06;
      return 0.03; // level 4+: small residual imperfection, never zero
    }

    function computeAndApplyAiMove() {
      const level = dgcState.level;
      const pHistory = dgcState.playerHistory;

      // Rule 1: Immediate Catch Check — always applies, no imperfection here,
      // otherwise the AI would feel broken (standing next to the player and
      // "missing" makes no sense).
      const directDist = Math.abs(dgcState.ai.x - dgcState.player.x) + Math.abs(dgcState.ai.y - dgcState.player.y);
      if (directDist === 1) {
        dgcState.ai.x = dgcState.player.x;
        dgcState.ai.y = dgcState.player.y;
        return;
      }

      // Rule 2: Base target is always the player's ACTUAL position. This is
      // the primary chase signal (spec priority #1: spatial relationship).
      let targetPos = { x: dgcState.player.x, y: dgcState.player.y };

      // Rule 3: Prediction is a SECONDARY, blended signal — not a replacement
      // for chasing the real position. Instead of teleporting the target to
      // a projected point (which made the AI look like it was "copying" the
      // player's last direction), nudge the target a little ahead along the
      // player's recent direction. BFS still paths toward a point close to
      // the player, so whichever axis has the larger real gap still tends to
      // dominate the AI's first move.
      if (level >= 1) {
        let isPredictableDirection = false;
        let lastDx = 0, lastDy = 0;

        if (pHistory.length >= 2) {
          const h1 = pHistory[pHistory.length - 1];
          const h2 = pHistory[pHistory.length - 2];
          if (h1.dx === h2.dx && h1.dy === h2.dy) {
            isPredictableDirection = true;
            lastDx = h1.dx;
            lastDy = h1.dy;
          }
        }

        if (isPredictableDirection) {
          // Small lead nudge, not a full projection — keeps prediction as a
          // minor influence rather than the deciding factor.
          const leadSteps = 1;
          const nudgeX = Math.max(0, Math.min(dgcState.gridSize - 1, dgcState.player.x + lastDx * leadSteps));
          const nudgeY = Math.max(0, Math.min(dgcState.gridSize - 1, dgcState.player.y + lastDy * leadSteps));

          if (!dgcState.obstacles.has(`${nudgeX},${nudgeY}`)) {
            targetPos = { x: nudgeX, y: nudgeY };
          }
        } else if (level >= 3) {
          // Goal-aware route interception: bias toward the midpoint between
          // Player and Goal, but only when it doesn't overshoot the real
          // distance (keeps this from overpowering direct chasing at range).
          const midX = Math.round((dgcState.player.x + dgcState.goal.x) / 2);
          const midY = Math.round((dgcState.player.y + dgcState.goal.y) / 2);
          if (!dgcState.obstacles.has(`${midX},${midY}`)) {
            targetPos = { x: midX, y: midY };
          }
        }
      }

      // Calculate path from AI -> Target via BFS, prioritizing whichever
      // axis (horizontal/vertical) has the larger real gap to the PLAYER
      // (not the possibly-nudged targetPos) — this is what keeps axis
      // priority (spec priority #1) in control even when prediction (#5)
      // has shifted the target slightly.
      const axisDirs = getAxisPriorityDirs(dgcState.ai, dgcState.player);
      let path = findBfsPath(dgcState.ai, targetPos, dgcState.obstacles, dgcState.gridSize, axisDirs);

      // Fallback to direct Player path if predicted path is blocked/empty
      if (path.length === 0) {
        path = findBfsPath(dgcState.ai, dgcState.player, dgcState.obstacles, dgcState.gridSize, axisDirs);
      }

      if (path.length === 0) return; // AI is fully boxed in, stay put

      // Rule 4: Controlled Imperfection. Occasionally take a different valid
      // step instead of the optimal BFS move, so the AI doesn't play like a
      // flawless solver. The alternative must still be a legal, in-bounds,
      // non-obstacle cell — never a random wander into a wall.
      const bestStep = path[0];
      const imperfectionChance = getDgcImperfectionChance(level);

      if (Math.random() < imperfectionChance) {
        const alternatives = [
          { x: dgcState.ai.x, y: dgcState.ai.y - 1 },
          { x: dgcState.ai.x, y: dgcState.ai.y + 1 },
          { x: dgcState.ai.x - 1, y: dgcState.ai.y },
          { x: dgcState.ai.x + 1, y: dgcState.ai.y }
        ].filter(m =>
          m.x >= 0 && m.x < dgcState.gridSize &&
          m.y >= 0 && m.y < dgcState.gridSize &&
          !dgcState.obstacles.has(`${m.x},${m.y}`) &&
          !(m.x === bestStep.x && m.y === bestStep.y)
        );

        if (alternatives.length > 0) {
          // Prefer the least-bad alternative (still generally closes distance)
          // rather than a fully random valid move, so it stays "trying to
          // catch me" instead of "wandering".
          alternatives.sort((a, b) => {
            const da = Math.abs(a.x - dgcState.player.x) + Math.abs(a.y - dgcState.player.y);
            const db = Math.abs(b.x - dgcState.player.x) + Math.abs(b.y - dgcState.player.y);
            return da - db;
          });
          const pick = alternatives[0];
          dgcState.ai.x = pick.x;
          dgcState.ai.y = pick.y;
          return;
        }
      }

      // Apply the optimal BFS step
      dgcState.ai.x = bestStep.x;
      dgcState.ai.y = bestStep.y;
    }

    function triggerDgcLevelComplete() {
      TTBAudio.playLevelUp();
      dgcState.status = 'LEVEL_COMPLETE';
      saveDgcHighScore();

      const turnsThisLevel = dgcState.turns;

      document.getElementById('dgcCompletedLevel').innerText = dgcState.level;
      document.getElementById('dgcLevelTurns').innerText = dgcState.turns;

      dgcState.consecutiveWins += 1;
      dgcState.consecutiveLosses = 0;
      dgcState.consecutiveEscapes = 0;

      // Priority: streak > notable pace (fast/slow) > plain goal-reached
      // reaction. A "fast" completion is judged relative to the shortest
      // possible distance for this level (gridSize is a reasonable proxy
      // since exact shortest-path isn't tracked for dialogue purposes).
      if (dgcState.consecutiveWins >= 3) {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.playerWinStreak, 'dgc.winStreak'));
      } else if (turnsThisLevel <= dgcState.gridSize) {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.playerReachesGoalFast, 'dgc.goalFast'));
      } else if (turnsThisLevel >= dgcState.gridSize * 3) {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.playerReachesGoalSlow, 'dgc.goalSlow'));
      } else {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.playerReachesGoal, 'dgc.goal'));
      }

      showDgcOverlay('LEVEL_COMPLETE');
      updateDgcScoresUI();
    }

    function triggerDgcGameOver() {
      TTBAudio.playGameOver();
      dgcState.status = 'GAME_OVER';

      document.getElementById('dgcFailedLevel').innerText = dgcState.level;
      document.getElementById('dgcFinalBest').innerText = dgcState.bestLevel;

      dgcState.consecutiveLosses += 1;
      dgcState.consecutiveWins = 0;
      dgcState.consecutiveEscapes = 0;

      if (dgcState.consecutiveLosses >= 3) {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.playerLossStreak, 'dgc.lossStreak'));
      } else {
        setDgcDialogue(Dialogue.pick(GAME4_DIALOGUE.aiCatchesPlayer, 'dgc.catches'));
      }

      showDgcOverlay('GAME_OVER');
      updateDgcScoresUI();
    }

    function dgcGameLoop() {
      if (currentActiveGame === 'dgc') {
        // Smooth position interpolation
        const lerpSpeed = 0.35;
        dgcState.renderPlayer.x += (dgcState.player.x - dgcState.renderPlayer.x) * lerpSpeed;
        dgcState.renderPlayer.y += (dgcState.player.y - dgcState.renderPlayer.y) * lerpSpeed;

        dgcState.renderAi.x += (dgcState.ai.x - dgcState.renderAi.x) * lerpSpeed;
        dgcState.renderAi.y += (dgcState.ai.y - dgcState.renderAi.y) * lerpSpeed;

        drawDgcBoard();
        dgcAnimationId = requestAnimationFrame(dgcGameLoop);
      } else {
        dgcAnimationId = null;
      }
    }

    function drawDgcBoard() {
      if (!dgcCtx || !dgcCanvas) return;

      const width = dgcCanvas.width;
      const height = dgcCanvas.height;
      const cellSize = width / dgcState.gridSize;

      dgcCtx.fillStyle = '#0f172a';
      dgcCtx.fillRect(0, 0, width, height);

      // Draw Grid Tiles & Obstacles
      for (let x = 0; x < dgcState.gridSize; x++) {
        for (let y = 0; y < dgcState.gridSize; y++) {
          const posX = x * cellSize;
          const posY = y * cellSize;
          const key = `${x},${y}`;

          if (dgcState.obstacles.has(key)) {
            // Wall / Obstacle (⬛)
            dgcCtx.fillStyle = '#334155';
            if (dgcCtx.roundRect) {
              dgcCtx.beginPath();
              dgcCtx.roundRect(posX + 1, posY + 1, cellSize - 2, cellSize - 2, 6);
              dgcCtx.fill();
            } else {
              dgcCtx.fillRect(posX + 1, posY + 1, cellSize - 2, cellSize - 2);
            }
            dgcCtx.strokeStyle = '#475569';
            dgcCtx.lineWidth = 1;
            dgcCtx.strokeRect(posX + 1, posY + 1, cellSize - 2, cellSize - 2);
          } else {
            // Normal Grid Tile
            dgcCtx.fillStyle = (x + y) % 2 === 0 ? '#1e293b' : '#182232';
            dgcCtx.fillRect(posX, posY, cellSize, cellSize);

            dgcCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
            dgcCtx.lineWidth = 1;
            dgcCtx.strokeRect(posX, posY, cellSize, cellSize);

            // Highlight adjacent orthogonal targets
            if (dgcState.status === 'PLAYING') {
              const isAdjacent = Math.abs(x - dgcState.player.x) + Math.abs(y - dgcState.player.y) === 1;
              if (isAdjacent) {
                dgcCtx.fillStyle = 'rgba(99, 102, 241, 0.12)';
                dgcCtx.fillRect(posX + 2, posY + 2, cellSize - 4, cellSize - 4);
              }
            }
          }
        }
      }

      // Draw Goal (⭐)
      const gx = (dgcState.goal.x + 0.5) * cellSize;
      const gy = (dgcState.goal.y + 0.5) * cellSize;
      
      dgcCtx.fillStyle = 'rgba(245, 158, 11, 0.25)';
      dgcCtx.beginPath();
      dgcCtx.arc(gx, gy, cellSize * 0.38, 0, Math.PI * 2);
      dgcCtx.fill();

      dgcCtx.font = `${cellSize * 0.55}px system-ui`;
      dgcCtx.textAlign = 'center';
      dgcCtx.textBaseline = 'middle';
      dgcCtx.fillText('⭐', gx, gy);

      // Draw Player Token (🔵)
      const px = (dgcState.renderPlayer.x + 0.5) * cellSize;
      const py = (dgcState.renderPlayer.y + 0.5) * cellSize;
      const playerR = cellSize * 0.32;

      dgcCtx.fillStyle = 'rgba(99, 102, 241, 0.3)';
      dgcCtx.beginPath();
      dgcCtx.arc(px, py, playerR * 1.3, 0, Math.PI * 2);
      dgcCtx.fill();

      dgcCtx.fillStyle = '#6366f1';
      dgcCtx.beginPath();
      dgcCtx.arc(px, py, playerR, 0, Math.PI * 2);
      dgcCtx.fill();

      dgcCtx.fillStyle = '#a5b4fc';
      dgcCtx.beginPath();
      dgcCtx.arc(px - playerR * 0.3, py - playerR * 0.3, playerR * 0.3, 0, Math.PI * 2);
      dgcCtx.fill();

      // Draw AI Hunter Token (🔴)
      const ax = (dgcState.renderAi.x + 0.5) * cellSize;
      const ay = (dgcState.renderAi.y + 0.5) * cellSize;
      const aiR = cellSize * 0.32;

      dgcCtx.fillStyle = 'rgba(244, 63, 94, 0.3)';
      dgcCtx.beginPath();
      dgcCtx.arc(ax, ay, aiR * 1.3, 0, Math.PI * 2);
      dgcCtx.fill();

      dgcCtx.fillStyle = '#f43f5e';
      dgcCtx.beginPath();
      dgcCtx.arc(ax, ay, aiR, 0, Math.PI * 2);
      dgcCtx.fill();

      dgcCtx.fillStyle = '#fda4af';
      dgcCtx.beginPath();
      dgcCtx.arc(ax - aiR * 0.3, ay - aiR * 0.3, aiR * 0.3, 0, Math.PI * 2);
      dgcCtx.fill();
    }

    // Keyboard Directional Handling
    window.addEventListener('keydown', (e) => {
      if (currentActiveGame !== 'dgc') return;

      switch (e.key) {
        case 'ArrowUp': case 'w': case 'W':
          executeDgcTurn(0, -1);
          e.preventDefault();
          break;
        case 'ArrowDown': case 's': case 'S':
          executeDgcTurn(0, 1);
          e.preventDefault();
          break;
        case 'ArrowLeft': case 'a': case 'A':
          executeDgcTurn(-1, 0);
          e.preventDefault();
          break;
        case 'ArrowRight': case 'd': case 'D':
          executeDgcTurn(1, 0);
          e.preventDefault();
          break;
      }
    });

    const dgcBoardContainer = document.getElementById('dgcBoardContainer');

    function handleDgcCellClick(clientX, clientY) {
      if (dgcState.status !== 'PLAYING') return;

      const rect = dgcCanvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const clickX = (clientX - rect.left) * dpr;
      const clickY = (clientY - rect.top) * dpr;

      const cellSize = dgcCanvas.width / dgcState.gridSize;
      const gridX = Math.floor(clickX / cellSize);
      const gridY = Math.floor(clickY / cellSize);

      const dx = gridX - dgcState.player.x;
      const dy = gridY - dgcState.player.y;

      if (Math.abs(dx) + Math.abs(dy) === 1) {
        executeDgcTurn(dx, dy);
      }
    }

    dgcBoardContainer.addEventListener('click', (e) => {
      if (currentActiveGame === 'dgc') {
        handleDgcCellClick(e.clientX, e.clientY);
      }
    });

    let dgcTouchStartX = 0;
    let dgcTouchStartY = 0;

    dgcBoardContainer.addEventListener('touchstart', (e) => {
      if (currentActiveGame === 'dgc' && e.touches.length === 1) {
        dgcTouchStartX = e.touches[0].clientX;
        dgcTouchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    dgcBoardContainer.addEventListener('touchend', (e) => {
      if (currentActiveGame !== 'dgc' || dgcState.status !== 'PLAYING') return;
      if (!e.changedTouches || e.changedTouches.length === 0) return;

      const dx = e.changedTouches[0].clientX - dgcTouchStartX;
      const dy = e.changedTouches[0].clientY - dgcTouchStartY;
      const dist = Math.hypot(dx, dy);

      if (dist >= 20) {
        if (Math.abs(dx) > Math.abs(dy)) {
          executeDgcTurn(dx > 0 ? 1 : -1, 0);
        } else {
          executeDgcTurn(0, dy > 0 ? 1 : -1);
        }
      } else {
        handleDgcCellClick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      }
    }, { passive: true });

    /* =====================================================================
       GAME 05: "TRUST ME" — NUMBER GUESSING WITH AI PERSONALITY
       ===================================================================== */

    /* --- 5.1 STATE --- */
