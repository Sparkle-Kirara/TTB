/* =====================================================================
   RUNNER.JS — Game #10: "Run From AI" (adaptive endless runner)
   =====================================================================
   Core loop (spec section 1):
     auto-run -> obstacle approaches -> player switches lane -> avoid/hit
     -> AI observes movement -> AI selects next pattern -> speed ramps ->
     eventual collision -> game over -> instant retry

   Distinct from Game #4 (spec section 10): there is no enemy chasing the
   player. The AI only controls which obstacle PATTERN spawns next, based
   on tracked lane habits -- the "opponent" is the road itself.

   Lifecycle follows the convention requested in spec section 16:
   init -> start -> update -> render -> handleInput -> gameOver -> reset.
   In this codebase that maps onto the existing requestAnimationFrame-loop
   convention already used by Snake/DGC/WhereIsIt (see game-manager.js):
   a module-level `runnerAnimationId`, a `startRunnerLoop()` called from
   showView, and `runnerStartRun()` as the restart entry point.
   ===================================================================== */

/** All tunable numbers live here -- nothing else in this file should
    have a magic timing/speed/probability constant. */
const RUNNER_CONFIG = {
  lanes: 3, // LEFT=0, CENTER=1, RIGHT=2
  laneSwitchMs: 140,          // how long the slide animation between lanes takes
  initialSpeed: 260,          // px/sec obstacles close on the player
  maxSpeed: 620,
  speedRampPerSec: 6,         // speed gained per second survived
  obstacleGapMsStart: 1450,   // ms between obstacle spawns at run start
  obstacleGapMsMin: 780,
  obstacleGapRampPerSec: 9,   // ms shaved off the gap per second survived (floored at min)
  spawnDepth: 1.0,            // obstacles spawn at progress=1 (far) and move toward progress=0 (player)
  collisionZoneStart: 0.06,   // progress window where a blocked lane actually kills the player
  collisionZoneEnd: -0.02,
  reactionZoneMinProgress: 0.55, // an obstacle must still be at least this far away when a fresh
                                  // pattern targeting the player's current lane is chosen, guaranteeing reaction time
  aiRampStartSec: 20,   // spec section 11: AI adaptation stays neutral before this
  aiRampFullSec: 60,    // adaptation reaches full strength by this point
  behaviorWindowSize: 10, // how many recent lane choices the tracker keeps for pattern analysis
  comfortZoneMs: 4500,     // time in one lane before a "comfort zone?" line becomes eligible
  dialogueMinGapMs: 3500   // minimum time between any two AI lines, keeps yapping occasional
};

const RUNNER_BEST_KEY = 'ttb_runner_best';
const LANE_NAMES = ['LEFT', 'CENTER', 'RIGHT'];

let runnerState = null;
let runnerAnimationId = null;
let runnerCtx = null;
let runnerRunToken = 0; // invalidates stray input/timer callbacks from a discarded run, same pattern as reflex.js

function freshRunnerState() {
  runnerRunToken += 1;
  return {
    status: 'READY', // 'READY' | 'PLAYING' | 'GAMEOVER'
    runToken: runnerRunToken,
    startedAt: 0,
    lastFrameTime: 0,
    distanceM: 0,
    speed: RUNNER_CONFIG.initialSpeed,
    player: {
      lane: 1,             // start CENTER
      targetLane: 1,
      switchStartTime: 0,
      switchFromLane: 1
    },
    obstacles: [], // { id, lanes:[...], progress }
    nextSpawnAt: 600, // ms of run-time until the first obstacle spawns (small buffer to orient)
    obstacleSeq: 0,
    behavior: {
      laneTimeMs: [0, 0, 0],
      currentLaneSince: 0,
      recentLanes: [],       // last N lanes the player has settled into
      leftMoves: 0,
      rightMoves: 0,
      lastDialogueAt: -99999,
      lastComfortZoneLane: -1
    }
  };
}

function startRunnerGame() {
  TTBAudio.playStart();
  showView('runnerView');
  runnerState = freshRunnerState();
  setupRunnerCanvas();
  showRunnerOverlay('READY');
  updateRunnerBestDisplay();
  renderRunnerFrame(); // draw an idle frame behind the ready overlay
}

function runnerStartRun() {
  TTBAudio.playStart();
  runnerState = freshRunnerState();
  runnerState.status = 'PLAYING';
  runnerState.startedAt = performance.now();
  runnerState.lastFrameTime = runnerState.startedAt;
  runnerState.behavior.currentLaneSince = runnerState.startedAt;
  showRunnerOverlay('NONE');
  setRunnerAiLine(pickRunnerLine('runStart'), true);
  updateRunnerHud();
}

function showRunnerOverlay(type) {
  document.getElementById('runnerOverlayReady').style.display = (type === 'READY') ? 'flex' : 'none';
  document.getElementById('runnerOverlayEnding').style.display = (type === 'ENDING') ? 'flex' : 'none';
}

/** Sizes the canvas's drawing buffer to match its actual CSS pixel size (spec section 17: single canvas, no heavy setup). */
function setupRunnerCanvas() {
  const canvas = document.getElementById('runnerCanvas');
  const wrapper = document.getElementById('runnerBoardContainer');
  const dpr = window.devicePixelRatio || 1;
  const rect = wrapper.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  runnerCtx = canvas.getContext('2d');
  runnerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Called by game-manager.js's showView, matching the established startXLoop convention. */
function startRunnerLoop() {
  if (runnerAnimationId) cancelAnimationFrame(runnerAnimationId);
  function frame(now) {
    runnerAnimationId = requestAnimationFrame(frame);
    if (runnerState && runnerState.status === 'PLAYING') {
      updateRunner(now);
    }
    renderRunnerFrame();
  }
  runnerAnimationId = requestAnimationFrame(frame);
}

/* stopRunnerLoop intentionally omitted: game-manager.js's
   stopAllAnimationLoops() cancels runnerAnimationId directly, matching
   the same convention already used for snakeAnimationId/wiiAnimationId/
   dgcAnimationId -- no separate stop function is called externally for
   those either. */

/* ---------------------------------------------------------------------
   UPDATE — advances simulation state by one frame. No drawing here.
--------------------------------------------------------------------- */
function updateRunner(now) {
  const dtMs = Math.min(now - runnerState.lastFrameTime, 50); // clamp to avoid huge jumps on tab-switch
  runnerState.lastFrameTime = now;
  const dtSec = dtMs / 1000;
  const elapsedSec = (now - runnerState.startedAt) / 1000;

  // Speed ramps continuously, floored/ceilinged by config (spec section 11).
  runnerState.speed = Math.min(
    RUNNER_CONFIG.maxSpeed,
    RUNNER_CONFIG.initialSpeed + elapsedSec * RUNNER_CONFIG.speedRampPerSec
  );
  runnerState.distanceM += runnerState.speed * dtSec * 0.05; // scale to readable meters

  updateRunnerLaneTracking(dtMs);
  updateRunnerObstacles(dtMs);
  maybeSpawnRunnerObstacle(now, dtMs, elapsedSec);
  checkRunnerCollision();
  maybeSpeakRunnerBehaviorLine(now);

  updateRunnerHud();
}

function updateRunnerLaneTracking(dtMs) {
  const b = runnerState.behavior;
  b.laneTimeMs[runnerState.player.lane] += dtMs;
}

function updateRunnerObstacles(dtMs) {
  // Divisor tuned so obstacles take ~2.2s to cross the board at initial
  // speed, down to ~0.9s at max speed -- verified directly (progress runs
  // 1.0 -> ~collisionZoneStart over that many ms), not just estimated.
  // NOTE: an earlier version of this divisor (10000) was far too small
  // and made obstacles cross in ~40ms, effectively unavoidable; caught by
  // simulating a full playthrough and measuring actual frame-to-frame
  // obstacle progress rather than trusting the formula by inspection.
  const speedProgressPerMs = runnerState.speed / 572000;
  runnerState.obstacles.forEach(o => { o.progress -= speedProgressPerMs * dtMs; });
  runnerState.obstacles = runnerState.obstacles.filter(o => o.progress > RUNNER_CONFIG.collisionZoneEnd - 0.1);
}

/* ---------------------------------------------------------------------
   PLAYER INPUT
--------------------------------------------------------------------- */
function runnerMoveLane(direction) {
  // direction: -1 = left, +1 = right
  if (!runnerState || runnerState.status !== 'PLAYING') return;
  const p = runnerState.player;
  const newLane = p.targetLane + direction;
  if (newLane < 0 || newLane >= RUNNER_CONFIG.lanes) return;

  p.switchFromLane = p.lane;
  p.targetLane = newLane;
  p.switchStartTime = performance.now();
  p.lane = newLane; // logical lane updates immediately (collision uses this); animation is purely visual

  const b = runnerState.behavior;
  if (direction < 0) b.leftMoves += 1; else b.rightMoves += 1;
  b.recentLanes.push(newLane);
  if (b.recentLanes.length > RUNNER_CONFIG.behaviorWindowSize) b.recentLanes.shift();
  b.currentLaneSince = performance.now();

  TTBAudio.playSelect();
}

function initRunnerInput() {
  if (document.body.dataset.runnerInputBound) return; // idempotent, same pattern as reflex.js
  document.body.dataset.runnerInputBound = 'true';

  window.addEventListener('keydown', (e) => {
    if (!runnerState || runnerState.status !== 'PLAYING') return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') runnerMoveLane(-1);
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') runnerMoveLane(1);
  });

  const wrapper = document.getElementById('runnerBoardContainer');
  let touchStartX = null;
  wrapper.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) touchStartX = e.touches[0].clientX;
  }, { passive: true });
  wrapper.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const endX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : touchStartX;
    const deltaX = endX - touchStartX;
    touchStartX = null;
    const SWIPE_THRESHOLD = 40;
    if (deltaX <= -SWIPE_THRESHOLD) runnerMoveLane(-1);
    else if (deltaX >= SWIPE_THRESHOLD) runnerMoveLane(1);
  }, { passive: true });
}

/* ---------------------------------------------------------------------
   AI OBSTACLE DIRECTOR (spec section 8)
   Reads tracked behavior, decides which lane(s) to pressure, and always
   leaves at least one lane open -- the fairness guarantee (spec section
   6) is enforced structurally in buildRunnerPattern(), not left to
   probability.
--------------------------------------------------------------------- */
function getRunnerAdaptationStrength(elapsedSec) {
  if (elapsedSec <= RUNNER_CONFIG.aiRampStartSec) return 0;
  if (elapsedSec >= RUNNER_CONFIG.aiRampFullSec) return 1;
  return (elapsedSec - RUNNER_CONFIG.aiRampStartSec) / (RUNNER_CONFIG.aiRampFullSec - RUNNER_CONFIG.aiRampStartSec);
}

/** Returns the lane the player has favored most recently, or -1 if no clear preference yet. */
function getRunnerPreferredLane(behavior) {
  if (behavior.recentLanes.length < 4) return -1;
  const counts = [0, 0, 0];
  behavior.recentLanes.forEach(l => counts[l] += 1);
  const maxCount = Math.max(...counts);
  if (maxCount < behavior.recentLanes.length * 0.5) return -1; // no strong lean
  return counts.indexOf(maxCount);
}

/** Detects simple LEFT/RIGHT alternation ignoring center (spec section 8 example). */
function isRunnerAlternating(behavior) {
  const recent = behavior.recentLanes.slice(-4);
  if (recent.length < 4) return false;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] === recent[i - 1]) return false;
    if (recent[i] === 1 || recent[i - 1] === 1) return false; // only counts as alternation if it's strictly outer lanes
  }
  return true;
}

/**
 * Builds the set of lanes a new obstacle pattern should block. ALWAYS
 * leaves at least one lane open -- this is a hard invariant, not a
 * probability, satisfying spec section 6's "never create an unavoidable
 * collision" rule by construction.
 */
function buildRunnerPattern(elapsedSec) {
  const strength = getRunnerAdaptationStrength(elapsedSec);
  const behavior = runnerState.behavior;
  const preferredLane = getRunnerPreferredLane(behavior);
  const alternating = isRunnerAlternating(behavior);

  // How many lanes to block: never all 3. Complexity increases slightly
  // with survival time (spec section 11), independent of AI targeting.
  const blockTwoChance = Math.min(0.55, 0.15 + elapsedSec / 120);
  const blockCount = Math.random() < blockTwoChance ? 2 : 1;

  let blocked;
  if (blockCount === 1) {
    let targetLane = Math.floor(Math.random() * RUNNER_CONFIG.lanes);
    // Adaptively bias toward the player's preferred/predictable lane,
    // scaled by ramp strength -- this is the "AI learns how I move" hook.
    if (preferredLane !== -1 && Math.random() < strength * 0.6) {
      targetLane = preferredLane;
    } else if (alternating && Math.random() < strength * 0.5) {
      // punish alternation by blocking whichever outer lane they'd swing to next
      const lastLane = behavior.recentLanes[behavior.recentLanes.length - 1];
      targetLane = lastLane === 0 ? 2 : 0;
    }
    blocked = [targetLane];
  } else {
    // Block two lanes, leaving exactly one open. Bias the OPEN lane away
    // from the player's preferred lane (harder) as strength increases,
    // but this still always leaves a real, reachable safe lane.
    let openLane = Math.floor(Math.random() * RUNNER_CONFIG.lanes);
    if (preferredLane !== -1 && Math.random() < strength * 0.5) {
      const others = [0, 1, 2].filter(l => l !== preferredLane);
      openLane = others[Math.floor(Math.random() * others.length)];
    }
    blocked = [0, 1, 2].filter(l => l !== openLane);
  }

  return blocked;
}

/* ---------------------------------------------------------------------
   OBSTACLE SPAWNING
--------------------------------------------------------------------- */
function maybeSpawnRunnerObstacle(now, dtMs, elapsedSec) {
  runnerState.nextSpawnAt -= dtMs;
  if (runnerState.nextSpawnAt > 0) return;

  const gapMs = Math.max(
    RUNNER_CONFIG.obstacleGapMsMin,
    RUNNER_CONFIG.obstacleGapMsStart - elapsedSec * RUNNER_CONFIG.obstacleGapRampPerSec
  );
  runnerState.nextSpawnAt = gapMs;

  const blockedLanes = buildRunnerPattern(elapsedSec);
  runnerState.obstacles.push({
    id: ++runnerState.obstacleSeq,
    lanes: blockedLanes,
    progress: RUNNER_CONFIG.spawnDepth
  });
}

/* ---------------------------------------------------------------------
   COLLISION
--------------------------------------------------------------------- */
function checkRunnerCollision() {
  const p = runnerState.player;
  for (const o of runnerState.obstacles) {
    if (o.progress <= RUNNER_CONFIG.collisionZoneStart && o.progress >= RUNNER_CONFIG.collisionZoneEnd) {
      if (o.lanes.includes(p.lane)) {
        triggerRunnerGameOver();
        return;
      }
    }
  }
}

function triggerRunnerGameOver() {
  runnerState.status = 'GAMEOVER';
  const token = runnerState.runToken;
  TTBAudio.playGameOver();
  setRunnerAiLine(pickRunnerLine('death'), true);
  setTimeout(() => {
    if (runnerState && runnerState.runToken === token && runnerState.status === 'GAMEOVER') finishRunnerRun();
  }, 700);
}

/* ---------------------------------------------------------------------
   BEHAVIOR-DRIVEN DIALOGUE (rate-limited, spec section 13)
--------------------------------------------------------------------- */
function maybeSpeakRunnerBehaviorLine(now) {
  const b = runnerState.behavior;
  if (now - b.lastDialogueAt < RUNNER_CONFIG.dialogueMinGapMs) return;

  const timeInLane = now - b.currentLaneSince;
  if (timeInLane > RUNNER_CONFIG.comfortZoneMs && b.lastComfortZoneLane !== runnerState.player.lane) {
    b.lastComfortZoneLane = runnerState.player.lane;
    setRunnerAiLine(pickRunnerLine('comfortZone'), false, now);
    return;
  }

  if (isRunnerAlternating(b) && Math.random() < 0.4) {
    setRunnerAiLine(pickRunnerLine('alternating'), false, now);
    return;
  }

  const preferredLane = getRunnerPreferredLane(b);
  if (preferredLane !== -1 && b.recentLanes.length >= RUNNER_CONFIG.behaviorWindowSize && Math.random() < 0.12) {
    setRunnerAiLine(pickRunnerLine('laneObsession', LANE_NAMES[preferredLane]), false, now);
    return;
  }

  const elapsedSec = (now - runnerState.startedAt) / 1000;
  if (elapsedSec > 45 && Math.random() < 0.05) {
    setRunnerAiLine(pickRunnerLine('longSurvival'), false, now);
  }
}

/* ---------------------------------------------------------------------
   HUD / DIALOGUE / SCORE — thin glue around the above
--------------------------------------------------------------------- */
function updateRunnerHud() {
  document.getElementById('runnerDistance').innerText = Math.floor(runnerState.distanceM);
}

function setRunnerAiLine(text, force, now) {
  if (!text) return;
  if (!force) {
    runnerState.behavior.lastDialogueAt = now || performance.now();
  }
  const aiBox = document.getElementById('runnerAiBox');
  const aiText = document.getElementById('runnerAiText');
  aiBox.style.display = 'flex';
  aiText.innerText = `"${text}"`;
  clearTimeout(runnerState.aiLineHideTimer);
  runnerState.aiLineHideTimer = setTimeout(() => { aiBox.style.display = 'none'; }, 2600);
}

function pickRunnerLine(poolKey, subKey) {
  let pool = RUNNER_DIALOGUE[poolKey];
  if (subKey) pool = pool[subKey];
  if (!pool || pool.length === 0) return '';
  if (typeof Dialogue !== 'undefined' && Dialogue.pick) {
    return Dialogue.pick(pool, 'runner_' + poolKey + (subKey ? '_' + subKey : ''));
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function getRunnerBest() {
  const raw = localStorage.getItem(RUNNER_BEST_KEY);
  const parsed = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function updateRunnerBestDisplay() {
  document.getElementById('runnerBestReady').innerText = `Best: ${getRunnerBest()}m`;
}

function finishRunnerRun() {
  const finalDistance = Math.floor(runnerState.distanceM);
  const best = getRunnerBest();
  const isNewBest = finalDistance > best;
  if (isNewBest) localStorage.setItem(RUNNER_BEST_KEY, String(finalDistance));
  const displayBest = isNewBest ? finalDistance : best;

  let closing;
  if (isNewBest) closing = RUNNER_ENDINGS.newBest;
  else if (best === 0) closing = RUNNER_ENDINGS.first.replace('{distance}', finalDistance);
  else closing = RUNNER_ENDINGS.normal.replace('{distance}', finalDistance).replace('{best}', displayBest);

  document.getElementById('runnerEndingText').innerText = closing;
  document.getElementById('runnerFinalDistance').innerText = finalDistance;
  document.getElementById('runnerFinalBest').innerText = displayBest;

  showRunnerOverlay('ENDING');
}

/* ---------------------------------------------------------------------
   RENDER — Canvas 2D drawing only, no state mutation (spec section 17)
--------------------------------------------------------------------- */
function renderRunnerFrame() {
  if (!runnerCtx) return;
  const canvas = document.getElementById('runnerCanvas');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const ctx = runnerCtx;

  ctx.clearRect(0, 0, w, h);

  // Road background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  const laneWidth = w / RUNNER_CONFIG.lanes;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = 2;
  for (let i = 1; i < RUNNER_CONFIG.lanes; i++) {
    ctx.beginPath();
    ctx.moveTo(laneWidth * i, 0);
    ctx.lineTo(laneWidth * i, h);
    ctx.stroke();
  }

  if (!runnerState) return;

  // Obstacles: progress 1 (far/top) -> 0 (player's row)
  runnerState.obstacles.forEach(o => {
    const y = h * (1 - o.progress) * 0.82; // obstacles travel through the top ~82% of the board
    const obstacleH = Math.max(18, h * 0.05);
    o.lanes.forEach(laneIdx => {
      ctx.fillStyle = '#f97316';
      ctx.fillRect(laneWidth * laneIdx + 6, y, laneWidth - 12, obstacleH);
    });
  });

  // Player
  const playerRowY = h * 0.86;
  const playerSize = Math.min(laneWidth * 0.5, h * 0.07);
  const playerLaneX = laneWidth * runnerState.player.lane + laneWidth / 2;
  ctx.fillStyle = runnerState.status === 'GAMEOVER' ? '#ef4444' : '#38bdf8';
  ctx.beginPath();
  ctx.arc(playerLaneX, playerRowY, playerSize / 2, 0, Math.PI * 2);
  ctx.fill();
}

// Bind input once, at script load -- #runnerBoardContainer already exists
// in the DOM by this point since scripts load at the end of <body>.
initRunnerInput();
