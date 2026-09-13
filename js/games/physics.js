/* =====================================================================
   PHYSICS.JS — Game #11: "Don't Drop It" (physics-based vertical bouncer)
   =====================================================================
   Core loop (spec section 1):
     move -> physics reacts -> avoid gap / land on platform -> continue ->
     difficulty increases -> eventually fall -> game over -> instant retry

   PHYSICS MODEL (spec section 3): the player only controls HORIZONTAL
   acceleration (A/D, arrows, or touch left/right -- no jump input exists
   per spec's own control list). Landing on a platform automatically
   bounces the player upward; gravity pulls them back down. This keeps
   the player's whole job "positioning", with real inertia: releasing
   input does not stop movement instantly, friction decays velocity
   exponentially over time rather than being zeroed per frame.

   FAIRNESS (spec section 5): platform horizontal gaps are bounded by a
   value DERIVED from PHYSICS_CONFIG itself (see maxHorizontalReachPx()),
   not a guessed constant -- a gap can never exceed what the player's own
   physics make achievable, with margin to spare (see PLATFORM_GAP_SAFETY_MARGIN).

   Distinct from Game #10: no lanes, no discrete obstacles approaching a
   fixed collision line -- continuous 2D physics and platform generation
   in world space, with the camera following the player upward.

   Lifecycle matches the requestAnimationFrame-loop convention already
   used by Snake/DGC/WhereIsIt/Runner (see game-manager.js): a module-
   level `physicsAnimationId`, `startPhysicsLoop()` called from showView,
   and `physicsStartRun()` as the restart entry point.
   ===================================================================== */

/** All tunable numbers live here -- nothing else in this file should
    have a magic physics/timing/probability constant. */
const PHYSICS_CONFIG = {
  gravity: 1400,           // px/s^2 downward
  bounceVelocity: 780,     // px/s upward, applied automatically on landing
  inputAccel: 1600,        // px/s^2 from held input
  frictionHalfLifeSec: 0.15, // seconds for horizontal velocity to decay to half with no input
  maxHorizontalSpeed: 480, // hard cap so input can't runaway-accelerate forever
  playerRadius: 14,
  platformWidth: 90,
  platformHeight: 14,
  platformGapMin: 90,      // min vertical gap between platforms
  platformGapMax: 150,     // max vertical gap, ramps toward this with difficulty
  platformGapSafetyMargin: 0.72, // fraction of the mathematically-derived max horizontal
                                  // reach that generation is allowed to use (spec section 5:
                                  // always leave real margin for reaction/imperfect play)
  difficultyRampSec: 90,   // seconds to go from easiest to hardest platform spacing
  behaviorWindowSize: 12,  // recent horizontal-direction samples kept for habit analysis
  aiRampStartSec: 15,
  aiRampFullSec: 55,
  dialogueMinGapMs: 3500
};

const PHYSICS_BEST_KEY = 'ttb_physics_best';

let physicsState = null;
let physicsAnimationId = null;
let physicsCtx = null;
let physicsRunToken = 0; // invalidates stray timer callbacks from a discarded run, same pattern as reflex.js/runner.js

/**
 * Derived, not guessed: the furthest horizontal distance a player can
 * possibly cover during one full bounce's airtime, starting from zero
 * horizontal velocity and holding a direction the whole time.
 *
 * IMPORTANT: this is computed by frame-stepping the SAME physics
 * integration used during real gameplay (updatePhysicsPlayerHorizontal),
 * not a closed-form shortcut. An earlier version used
 * `terminalVx * airtime`, which overestimates reachable distance by
 * ~25% because it assumes the player is already at terminal velocity for
 * the entire airtime -- in reality the player starts at vx=0 and spends
 * real time accelerating up to terminal velocity, covering less ground
 * during that ramp-up. That overestimate meant the "safety margin" was
 * actually consuming ~90% of the TRUE reachable distance instead of the
 * intended ~72%, producing gaps that were unfair in practice. Caught by
 * simulating full playthroughs with a bot and finding frequent early,
 * seemingly-inexplicable deaths, then directly comparing the closed-form
 * estimate against a frame-stepped simulation of the same physics.
 */
function maxHorizontalReachPx() {
  const decayRate = Math.log(2) / PHYSICS_CONFIG.frictionHalfLifeSec;
  const airtimeSec = (2 * PHYSICS_CONFIG.bounceVelocity) / PHYSICS_CONFIG.gravity;
  const dt = 1 / 60; // one simulated frame at a standard 60fps step

  let x = 0;
  let vx = 0;
  let t = 0;
  while (t < airtimeSec) {
    vx += PHYSICS_CONFIG.inputAccel * dt;
    vx *= Math.exp(-decayRate * dt);
    vx = Math.max(-PHYSICS_CONFIG.maxHorizontalSpeed, Math.min(PHYSICS_CONFIG.maxHorizontalSpeed, vx));
    x += vx * dt;
    t += dt;
  }
  return x;
}

function freshPhysicsState() {
  physicsRunToken += 1;
  return {
    status: 'READY', // 'READY' | 'PLAYING' | 'GAMEOVER'
    runToken: physicsRunToken,
    startedAt: 0,
    lastFrameTime: 0,
    cameraY: 0,        // world-space Y the camera is centered on; increases as player climbs (Y decreases)
    distanceM: 0,
    player: {
      x: 0, y: 0, vx: 0, vy: 0
    },
    platforms: [], // { id, x, y, width }
    platformSeq: 0,
    input: { left: false, right: false },
    behavior: {
      leftInputMs: 0,
      rightInputMs: 0,
      recentDirections: [],   // last N horizontal input directions (-1/0/1) sampled periodically
      lastSampleAt: 0,
      directionChanges: 0,
      panicCorrections: 0,     // rapid reversals while close to a platform edge
      lastVx: 0,
      lastDialogueAt: -99999,
      lastHabitAnnouncedAt: -99999
    }
  };
}

function startPhysicsGame() {
  TTBAudio.playStart();
  showView('physicsView');
  physicsState = freshPhysicsState();
  setupPhysicsCanvas();
  showPhysicsOverlay('READY');
  updatePhysicsBestDisplay();
  renderPhysicsFrame();
}

function physicsStartRun() {
  TTBAudio.playStart();
  physicsState = freshPhysicsState();
  physicsState.status = 'PLAYING';
  physicsState.startedAt = performance.now();
  physicsState.lastFrameTime = physicsState.startedAt;
  physicsState.behavior.lastSampleAt = physicsState.startedAt;

  const canvas = document.getElementById('physicsCanvas');
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;

  physicsState.player.x = w / 2;
  physicsState.player.y = h * 0.6;
  // Use the SAME bounce velocity as every normal landing, not a reduced
  // value -- platform vertical gaps are sized based on the full
  // bounceVelocity's airtime (see maxHorizontalReachPx() and
  // generateNextPhysicsPlatform()). A smaller "starting hop" was tried
  // for feel but left the very first real platform out of reach, causing
  // an unfair near-instant death; caught by simulating a full playthrough
  // and finding the player fell after ~0.67s, matching the shorter hop's
  // actual airtime exactly.
  physicsState.player.vy = -PHYSICS_CONFIG.bounceVelocity;
  physicsState.cameraY = 0;

  seedInitialPhysicsPlatforms(w, h);

  showPhysicsOverlay('NONE');
  setPhysicsAiLine(pickPhysicsLine('runStart'), true);
  updatePhysicsHud();
}

function showPhysicsOverlay(type) {
  document.getElementById('physicsOverlayReady').style.display = (type === 'READY') ? 'flex' : 'none';
  document.getElementById('physicsOverlayEnding').style.display = (type === 'ENDING') ? 'flex' : 'none';
}

/** Sizes the canvas's drawing buffer to match its actual CSS pixel size. */
function setupPhysicsCanvas() {
  const canvas = document.getElementById('physicsCanvas');
  const wrapper = document.getElementById('physicsBoardContainer');
  const dpr = window.devicePixelRatio || 1;
  const rect = wrapper.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  physicsCtx = canvas.getContext('2d');
  physicsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Called by game-manager.js's showView, matching the established startXLoop convention. */
function startPhysicsLoop() {
  if (physicsAnimationId) cancelAnimationFrame(physicsAnimationId);
  function frame(now) {
    physicsAnimationId = requestAnimationFrame(frame);
    if (physicsState && physicsState.status === 'PLAYING') {
      updatePhysics(now);
    }
    renderPhysicsFrame();
  }
  physicsAnimationId = requestAnimationFrame(frame);
}

/* physicsAnimationId is cancelled directly by game-manager.js's
   stopAllAnimationLoops(), matching the convention already used for
   snakeAnimationId/wiiAnimationId/dgcAnimationId/runnerAnimationId --
   no separate stop function is called externally for those either. */

/* ---------------------------------------------------------------------
   UPDATE — advances simulation state by one frame. No drawing here.
--------------------------------------------------------------------- */
function updatePhysics(now) {
  const dtMs = Math.min(now - physicsState.lastFrameTime, 50); // clamp to avoid huge jumps on tab-switch
  physicsState.lastFrameTime = now;
  const dtSec = dtMs / 1000;

  updatePhysicsPlayerHorizontal(dtSec);
  updatePhysicsPlayerVertical(dtSec);
  checkPhysicsPlatformCollisions();
  updatePhysicsCameraAndScore(dtSec);
  maybeGeneratePhysicsPlatforms();
  cullPhysicsPlatforms();
  samplePhysicsBehavior(now, dtMs);
  checkPhysicsGameOver();
  maybeSpeakPhysicsBehaviorLine(now);

  updatePhysicsHud();
}

function updatePhysicsPlayerHorizontal(dtSec) {
  const p = physicsState.player;
  const decayRate = Math.log(2) / PHYSICS_CONFIG.frictionHalfLifeSec;

  let ax = 0;
  if (physicsState.input.left) ax -= PHYSICS_CONFIG.inputAccel;
  if (physicsState.input.right) ax += PHYSICS_CONFIG.inputAccel;

  p.vx += ax * dtSec;
  // Exponential friction decay (continuous, frame-rate independent) --
  // this is what gives "releasing input does not immediately stop
  // movement" (spec section 3) without becoming floaty: it decays fast
  // (half-life 0.15s) rather than lingering.
  p.vx *= Math.exp(-decayRate * dtSec);

  const maxV = PHYSICS_CONFIG.maxHorizontalSpeed;
  p.vx = Math.max(-maxV, Math.min(maxV, p.vx));
  p.x += p.vx * dtSec;

  // Wrap horizontally at board edges (screen-wrap, not a wall) -- keeps
  // the fairness math simple (no "trapped against a wall" dead states)
  // and matches classic vertical-bouncer conventions.
  const canvas = document.getElementById('physicsCanvas');
  const w = canvas.getBoundingClientRect().width;
  if (p.x < -PHYSICS_CONFIG.playerRadius) p.x = w + PHYSICS_CONFIG.playerRadius;
  if (p.x > w + PHYSICS_CONFIG.playerRadius) p.x = -PHYSICS_CONFIG.playerRadius;
}

function updatePhysicsPlayerVertical(dtSec) {
  const p = physicsState.player;
  p.vy += PHYSICS_CONFIG.gravity * dtSec;
  p.y += p.vy * dtSec;
}

function checkPhysicsPlatformCollisions() {
  const p = physicsState.player;
  if (p.vy <= 0) return; // only land while falling, never while rising through a platform from below

  for (const plat of physicsState.platforms) {
    const withinX = p.x + PHYSICS_CONFIG.playerRadius > plat.x - plat.width / 2 &&
                    p.x - PHYSICS_CONFIG.playerRadius < plat.x + plat.width / 2;
    const withinY = p.y + PHYSICS_CONFIG.playerRadius >= plat.y &&
                    p.y + PHYSICS_CONFIG.playerRadius <= plat.y + PHYSICS_CONFIG.platformHeight + Math.abs(p.vy) * 0.02;
    if (withinX && withinY) {
      p.vy = -PHYSICS_CONFIG.bounceVelocity;
      TTBAudio.playSelect();
      maybeFlagPhysicsCloseCall(plat);
      return;
    }
  }
}

/** Flags a "close call" if the player landed very near a platform's edge (spec section 10 example). */
function maybeFlagPhysicsCloseCall(plat) {
  const p = physicsState.player;
  const edgeDistance = Math.min(
    Math.abs(p.x - (plat.x - plat.width / 2)),
    Math.abs(p.x - (plat.x + plat.width / 2))
  );
  if (edgeDistance < PHYSICS_CONFIG.playerRadius * 1.4) {
    physicsState._pendingCloseCall = true;
  }
}

function updatePhysicsCameraAndScore(dtSec) {
  const p = physicsState.player;
  const canvas = document.getElementById('physicsCanvas');
  const h = canvas.getBoundingClientRect().height;
  const followThreshold = h * 0.42;

  if (p.y < physicsState.cameraY + followThreshold) {
    const delta = (physicsState.cameraY + followThreshold) - p.y;
    physicsState.cameraY -= delta;
    physicsState.distanceM += delta * 0.04; // scale to readable meters, only counts genuine upward progress
  }
}

function maybeGeneratePhysicsPlatforms() {
  const canvas = document.getElementById('physicsCanvas');
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  const highestY = physicsState.platforms.reduce((min, pl) => Math.min(min, pl.y), physicsState.cameraY + h);

  // Keep generating upward until there's always a platform above the
  // visible top of the camera, with margin.
  while (highestY > physicsState.cameraY - h * 0.5) {
    generateNextPhysicsPlatform(w);
    return maybeGeneratePhysicsPlatforms(); // recompute highestY with the new platform included
  }
}

function generateNextPhysicsPlatform(boardWidth) {
  const elapsedSec = (performance.now() - physicsState.startedAt) / 1000;
  const rampT = Math.min(1, elapsedSec / PHYSICS_CONFIG.difficultyRampSec);
  const gapY = PHYSICS_CONFIG.platformGapMin + rampT * (PHYSICS_CONFIG.platformGapMax - PHYSICS_CONFIG.platformGapMin);

  const highest = physicsState.platforms.reduce(
    (top, pl) => (pl.y < top.y ? pl : top),
    { y: physicsState.player.y, x: physicsState.player.x }
  );

  const maxReach = maxHorizontalReachPx() * PHYSICS_CONFIG.platformGapSafetyMargin;
  const aiOffsetBiasPx = getPhysicsAiHorizontalBias(elapsedSec);

  // Base random offset within the fairness-bounded range, then nudged by
  // the (still bounded) AI bias -- clamped again afterward so the AI can
  // never push a gap past what's actually reachable (spec section 5/6).
  let offsetX = (Math.random() * 2 - 1) * maxReach * 0.75;
  offsetX += aiOffsetBiasPx;
  offsetX = Math.max(-maxReach, Math.min(maxReach, offsetX));

  let newX = highest.x + offsetX;
  const margin = PHYSICS_CONFIG.platformWidth / 2 + 10;
  newX = Math.max(margin, Math.min(boardWidth - margin, newX));

  physicsState.platforms.push({
    id: ++physicsState.platformSeq,
    x: newX,
    y: highest.y - gapY,
    width: PHYSICS_CONFIG.platformWidth
  });
}

function seedInitialPhysicsPlatforms(boardWidth, boardHeight) {
  // The starting platform AND a safety-net platform beneath it. Without
  // the safety net, a first landing that's even slightly off-target (the
  // player launches upward immediately, so their very first landing
  // attempt has had no chance yet to be corrected by watching feedback)
  // has nothing below to catch it -- instant, unrecoverable death with
  // zero margin, unlike every later bounce which always has prior
  // platforms below. Caught by tracing repeated fresh-run trials and
  // finding the player falling straight through empty space below the
  // single starting platform when their first landing attempt missed it.
  physicsState.platforms.push({
    id: ++physicsState.platformSeq,
    x: physicsState.player.x,
    y: physicsState.player.y + PHYSICS_CONFIG.playerRadius + 4,
    width: PHYSICS_CONFIG.platformWidth * 1.4 // a slightly generous starting platform
  });
  physicsState.platforms.push({
    id: ++physicsState.platformSeq,
    x: physicsState.player.x,
    y: physicsState.player.y + PHYSICS_CONFIG.playerRadius + 4 + PHYSICS_CONFIG.platformGapMin,
    width: boardWidth - 20 // spans nearly the full board -- impossible to miss, pure safety net
  });
  for (let i = 0; i < 8; i++) {
    generateNextPhysicsPlatform(boardWidth);
  }
}

function cullPhysicsPlatforms() {
  const canvas = document.getElementById('physicsCanvas');
  const h = canvas.getBoundingClientRect().height;
  const cullBelowY = physicsState.cameraY + h + 60;
  physicsState.platforms = physicsState.platforms.filter(pl => pl.y < cullBelowY);
}

function checkPhysicsGameOver() {
  const canvas = document.getElementById('physicsCanvas');
  const h = canvas.getBoundingClientRect().height;
  if (physicsState.player.y > physicsState.cameraY + h + PHYSICS_CONFIG.playerRadius * 3) {
    triggerPhysicsGameOver();
  }
}

function triggerPhysicsGameOver() {
  physicsState.status = 'GAMEOVER';
  const token = physicsState.runToken;
  TTBAudio.playGameOver();
  setPhysicsAiLine(pickPhysicsLine('death'), true);
  setTimeout(() => {
    if (physicsState && physicsState.runToken === token && physicsState.status === 'GAMEOVER') finishPhysicsRun();
  }, 700);
}

/* ---------------------------------------------------------------------
   PLAYER INPUT
--------------------------------------------------------------------- */
function physicsSetInput(direction, isDown) {
  if (!physicsState) return;
  if (direction === 'left') physicsState.input.left = isDown;
  else if (direction === 'right') physicsState.input.right = isDown;
}

function initPhysicsInput() {
  if (document.body.dataset.physicsInputBound) return; // idempotent, same pattern as reflex.js/runner.js
  document.body.dataset.physicsInputBound = 'true';

  window.addEventListener('keydown', (e) => {
    if (!physicsState || physicsState.status !== 'PLAYING') return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') physicsSetInput('left', true);
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') physicsSetInput('right', true);
  });
  window.addEventListener('keyup', (e) => {
    if (!physicsState) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') physicsSetInput('left', false);
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') physicsSetInput('right', false);
  });

  // Touch: press-and-hold left/right zones split down the middle of the
  // board, matching spec section 8's "touch left/right controls" choice
  // (a hold-based control maps onto continuous acceleration far more
  // naturally than a swipe gesture would for this game).
  const wrapper = document.getElementById('physicsBoardContainer');
  wrapper.addEventListener('touchstart', (e) => {
    e.preventDefault();
    handlePhysicsTouches(e.touches, wrapper);
  }, { passive: false });
  wrapper.addEventListener('touchmove', (e) => {
    e.preventDefault();
    handlePhysicsTouches(e.touches, wrapper);
  }, { passive: false });
  wrapper.addEventListener('touchend', (e) => {
    e.preventDefault();
    handlePhysicsTouches(e.touches, wrapper);
  }, { passive: false });
}

function handlePhysicsTouches(touches, wrapper) {
  const rect = wrapper.getBoundingClientRect();
  const midX = rect.left + rect.width / 2;
  let left = false, right = false;
  for (let i = 0; i < touches.length; i++) {
    if (touches[i].clientX < midX) left = true;
    else right = true;
  }
  physicsSetInput('left', left);
  physicsSetInput('right', right);
}

/* ---------------------------------------------------------------------
   BEHAVIOR TRACKING (spec section 6)
--------------------------------------------------------------------- */
function samplePhysicsBehavior(now, dtMs) {
  const b = physicsState.behavior;
  if (physicsState.input.left) b.leftInputMs += dtMs;
  if (physicsState.input.right) b.rightInputMs += dtMs;

  // Sample direction every ~150ms rather than every frame, keeping the
  // recent-direction window meaningful over a few seconds instead of a
  // few dozen milliseconds.
  if (now - b.lastSampleAt >= 150) {
    b.lastSampleAt = now;
    const vx = physicsState.player.vx;
    const dir = vx > 30 ? 1 : (vx < -30 ? -1 : 0);
    const lastDir = b.recentDirections[b.recentDirections.length - 1];
    if (lastDir !== undefined && dir !== 0 && lastDir !== 0 && dir !== lastDir) {
      b.directionChanges += 1;
      // A "panic correction": reversing hard while moving fast, i.e. a
      // sharp overcorrection rather than a gentle drift change.
      if (Math.abs(vx) > PHYSICS_CONFIG.maxHorizontalSpeed * 0.5 && Math.abs(b.lastVx) > PHYSICS_CONFIG.maxHorizontalSpeed * 0.5) {
        b.panicCorrections += 1;
      }
    }
    b.recentDirections.push(dir);
    if (b.recentDirections.length > PHYSICS_CONFIG.behaviorWindowSize) b.recentDirections.shift();
    b.lastVx = vx;
  }

  if (physicsState._pendingCloseCall) {
    physicsState._pendingCloseCall = false;
    if (now - b.lastDialogueAt > PHYSICS_CONFIG.dialogueMinGapMs) {
      setPhysicsAiLine(pickPhysicsLine('closeCall'), false, now);
    }
  }
}

/** Returns the player's dominant recent horizontal direction, or 0 if no clear lean. */
function getPhysicsPreferredDirection(behavior) {
  if (behavior.recentDirections.length < 6) return 0;
  const counts = { '-1': 0, '0': 0, '1': 0 };
  behavior.recentDirections.forEach(d => counts[d] += 1);
  if (counts['-1'] > behavior.recentDirections.length * 0.55) return -1;
  if (counts['1'] > behavior.recentDirections.length * 0.55) return 1;
  return 0;
}

/* ---------------------------------------------------------------------
   AI ADAPTATION (spec sections 6-7)
   Only ever biases platform placement, and always within the fairness-
   bounded reach clamp applied in generateNextPhysicsPlatform() -- the
   AI cannot create an unreachable gap no matter how strong its bias is.
--------------------------------------------------------------------- */
function getPhysicsAdaptationStrength(elapsedSec) {
  if (elapsedSec <= PHYSICS_CONFIG.aiRampStartSec) return 0;
  if (elapsedSec >= PHYSICS_CONFIG.aiRampFullSec) return 1;
  return (elapsedSec - PHYSICS_CONFIG.aiRampStartSec) / (PHYSICS_CONFIG.aiRampFullSec - PHYSICS_CONFIG.aiRampStartSec);
}

/**
 * Returns a horizontal bias (in px) to nudge the NEXT platform's offset
 * by. If the player strongly favors one side, bias new platforms toward
 * the OTHER side -- makes pure one-direction play gradually less optimal
 * (spec section 6's own example) without ever making a platform
 * unreachable (the caller clamps the final offset regardless).
 */
function getPhysicsAiHorizontalBias(elapsedSec) {
  const strength = getPhysicsAdaptationStrength(elapsedSec);
  if (strength <= 0) return 0;
  const behavior = physicsState.behavior;
  const preferredDir = getPhysicsPreferredDirection(behavior);
  if (preferredDir === 0) return 0;

  const maxReach = maxHorizontalReachPx() * PHYSICS_CONFIG.platformGapSafetyMargin;
  // Push future platforms toward the OPPOSITE side of the player's lean,
  // scaled by how strongly they lean and how ramped-in the AI currently is.
  return -preferredDir * maxReach * 0.35 * strength;
}

/* ---------------------------------------------------------------------
   BEHAVIOR-DRIVEN DIALOGUE (rate-limited, spec section 10)
--------------------------------------------------------------------- */
function maybeSpeakPhysicsBehaviorLine(now) {
  const b = physicsState.behavior;
  if (now - b.lastDialogueAt < PHYSICS_CONFIG.dialogueMinGapMs) return;

  if (Math.abs(physicsState.player.vx) > PHYSICS_CONFIG.maxHorizontalSpeed * 0.92 && Math.random() < 0.02) {
    setPhysicsAiLine(pickPhysicsLine('tooAggressive'), false, now);
    return;
  }

  if (b.directionChanges >= 6 && b.panicCorrections >= 2 && now - b.lastHabitAnnouncedAt > 12000) {
    b.lastHabitAnnouncedAt = now;
    setPhysicsAiLine(pickPhysicsLine('overCorrecting'), false, now);
    return;
  }

  const elapsedSec = (now - physicsState.startedAt) / 1000;
  if (elapsedSec > 45 && Math.random() < 0.04) {
    setPhysicsAiLine(pickPhysicsLine('longSurvival'), false, now);
  }
}

/* ---------------------------------------------------------------------
   HUD / DIALOGUE / SCORE
--------------------------------------------------------------------- */
function updatePhysicsHud() {
  document.getElementById('physicsDistance').innerText = Math.floor(physicsState.distanceM);
}

function setPhysicsAiLine(text, force, now) {
  if (!text) return;
  if (!force) {
    physicsState.behavior.lastDialogueAt = now || performance.now();
  }
  const aiBox = document.getElementById('physicsAiBox');
  const aiText = document.getElementById('physicsAiText');
  aiBox.style.display = 'flex';
  aiText.innerText = `"${text}"`;
  clearTimeout(physicsState.aiLineHideTimer);
  physicsState.aiLineHideTimer = setTimeout(() => { aiBox.style.display = 'none'; }, 2600);
}

function pickPhysicsLine(poolKey) {
  const pool = PHYSICS_DIALOGUE[poolKey];
  if (!pool || pool.length === 0) return '';
  if (typeof Dialogue !== 'undefined' && Dialogue.pick) {
    return Dialogue.pick(pool, 'physics_' + poolKey);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function getPhysicsBest() {
  const raw = localStorage.getItem(PHYSICS_BEST_KEY);
  const parsed = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function updatePhysicsBestDisplay() {
  document.getElementById('physicsBestReady').innerText = `Best: ${getPhysicsBest()}m`;
}

function finishPhysicsRun() {
  const finalDistance = Math.floor(physicsState.distanceM);
  const best = getPhysicsBest();
  const isNewBest = finalDistance > best;
  if (isNewBest) localStorage.setItem(PHYSICS_BEST_KEY, String(finalDistance));
  const displayBest = isNewBest ? finalDistance : best;

  let closing;
  if (isNewBest) closing = PHYSICS_ENDINGS.newBest;
  else if (best === 0) closing = PHYSICS_ENDINGS.first.replace('{distance}', finalDistance);
  else closing = PHYSICS_ENDINGS.normal.replace('{distance}', finalDistance).replace('{best}', displayBest);

  document.getElementById('physicsEndingText').innerText = closing;
  document.getElementById('physicsFinalDistance').innerText = finalDistance;
  document.getElementById('physicsFinalBest').innerText = displayBest;

  showPhysicsOverlay('ENDING');
}

/* ---------------------------------------------------------------------
   RENDER — Canvas 2D drawing only, no state mutation
--------------------------------------------------------------------- */
function renderPhysicsFrame() {
  if (!physicsCtx) return;
  const canvas = document.getElementById('physicsCanvas');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const ctx = physicsCtx;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  if (!physicsState) return;
  const camY = physicsState.cameraY;

  ctx.fillStyle = '#22c55e';
  physicsState.platforms.forEach(pl => {
    const screenY = pl.y - camY;
    if (screenY < -30 || screenY > h + 30) return;
    ctx.fillRect(pl.x - pl.width / 2, screenY, pl.width, PHYSICS_CONFIG.platformHeight);
  });

  const p = physicsState.player;
  ctx.fillStyle = physicsState.status === 'GAMEOVER' ? '#ef4444' : '#38bdf8';
  ctx.beginPath();
  ctx.arc(p.x, p.y - camY, PHYSICS_CONFIG.playerRadius, 0, Math.PI * 2);
  ctx.fill();
}

// Bind input once, at script load -- #physicsBoardContainer already
// exists in the DOM by this point since scripts load at the end of <body>.
initPhysicsInput();
