/* =====================================================================
   GAMES/AIM.JS — Game #12 "Outsmart the Target" (Phase 2: Adaptive AI)
   =====================================================================
   Fast arcade aim-and-shoot game. The target AI watches how the player
   aims and shoots (position habits, timing habits) and nudges future
   target spawns/movement away from those habits. It never reads the
   current shot or reacts after the fact -- see AIM_CONFIG / fairness
   notes below and the design spec for the full fairness rule.

   v2 (Phase 1) added precision-based scoring: score depends on HOW close
   the shot lands to the target's exact center, plus a combo multiplier.

   Phase 2 adds a proper behavioral profile + adaptation engine on top of
   the same foundation: a confidence-based classifier (aimBuildBehaviorProfile)
   reads the existing rolling history to detect tendencies (center/left/
   right/upper/lower bias, fast/patient/panic shooting, precision play),
   and a single bounded "fairness budget" (aimAdaptationStrength) scales
   how much aimChooseSpawn/aimChoosePattern react to them. The AI also
   detects when the player's dominant tendency changes (strategy
   counterplay) and can "back off" when recent accuracy is low.

   Structure inside this file:
     1. CONFIG              - all tunables in one place (scoring/combo/behavior/adaptation)
     2. Player behavior tracker (lightweight stats, not a general ML lib)
     2b. Precision scoring (v2) - pure distance -> score/tier function
     2c. Behavior classification (Phase 2) - confidence-based tendency detection
     3. Target AI (movement pattern + spawn position selection, adaptation-aware)
     4. Core game state + loop (spawn, update, render, hit detection)
     5. Input handling (mouse + touch -> crosshair position, shoot)
     6. Render (target rings, crosshair, shot markers, popups)
     7. Game loop
     8. Public start/stop functions wired into game-manager.js
     9. Input wiring
   ===================================================================== */

const AIM_CONFIG = {
  // Difficulty ramp (per target spawned, rounded down)
  targetsPerDifficultyStep: 4,
  baseTargetRadius: 34,
  minTargetRadius: 20,
  radiusShrinkPerStep: 1.5,

  baseTargetLifetimeMs: 2200,
  minTargetLifetimeMs: 1100,
  lifetimeShrinkPerStepMs: 90,

  baseTargetSpeed: 40,     // px/sec
  maxTargetSpeed: 170,
  speedGainPerStep: 8,

  // Movement pattern behavior
  directionChangeChance: 0.18,  // per-frame chance the AI re-picks a direction (drift/change patterns)
  accelerateChance: 0.12,       // per-frame chance of a brief speed burst
  accelerateMultiplier: 1.8,
  accelerateDurationMs: 350,

  // AI adaptation thresholds
  habitSampleMin: 4,           // need at least this many shots before adapting to a habit
  fastShotThresholdMs: 450,    // shots faster than this count as "fast reaction"
  slowShotThresholdMs: 1100,   // shots slower than this count as "patient"
  centerZoneRadiusFrac: 0.22,  // fraction of board's shorter side considered "center"
  sideZoneFrac: 0.32,          // normalized x/y distance from 0.5 beyond which a shot counts toward left/right/upper/lower
  recentHistoryLength: 8,

  // Phase 2: adaptive AI / player behavior profile. Kept in its own
  // sub-object so it's easy to see (and tune) everything that controls
  // "how much the AI is allowed to react to the player" in one place.
  behavior: {
    // Classification requires at least this many recent shots before the
    // AI will claim ANY tendency exists (spec §5: "do not classify after
    // only one or two shots").
    minSamplesToClassify: 6,
    // A tendency needs at least this fraction of the rolling window to be
    // considered "detected" at all (weak evidence -> no classification).
    weakEvidenceThreshold: 0.5,
    // A tendency at or above this fraction counts as a STRONG, high-confidence
    // pattern (used for stronger dialogue lines / stronger adaptation).
    strongEvidenceThreshold: 0.75,
    // Window used for "recent" classification (favors last N shots over
    // full-session history, per spec §3 "recent behavior matters more").
    recentWindow: 10
  },

  // Phase 2: fairness budget. adaptationStrength ramps from 0 toward this
  // ceiling as evidence accumulates -- it NEVER exceeds this value, so the
  // AI can never become overwhelming no matter how predictable the player
  // is (spec §10). Also modulated down when the player is struggling
  // (spec §12-13, "sometimes back off").
  adaptation: {
    maxStrength: 0.55,          // hard ceiling, 0..1
    rampShots: 20,              // shots needed to reach maxStrength from evidence alone
    lowAccuracyThreshold: 0.35, // recent accuracy below this triggers "back off"
    lowAccuracySampleMin: 6,
    backOffMultiplier: 0.4      // adaptationStrength is multiplied by this while backing off
  },

  // v2: precision-based scoring. Kept in its own sub-object so future modes
  // (Precision, Speed, ...) can override just this piece without touching
  // anything else. See aimComputePrecisionScore().
  scoring: {
    maxScore: 100,
    precisionPower: 2,        // score = maxScore * (1 - normalizedDistance) ^ precisionPower
    // Ring boundaries as a fraction of target radius, outside-in. Used for
    // both the visual rings and the HIT/GREAT/BULLSEYE feedback tier.
    greatThreshold: 0.55,     // normalizedDistance <= this -> "GREAT"
    bullseyeThreshold: 0.18   // normalizedDistance <= this -> "BULLSEYE"
  },

  // v2: combo multiplier. Every successful hit (any tier) extends the combo;
  // any miss resets it. Multiplier is a simple linear ramp, capped.
  combo: {
    multiplierStep: 0.1,      // +0.1x per combo step above 1
    maxMultiplier: 2.0
  },

  // Scoring / dialogue pacing
  missStreakForYap: 3,
  fastStreakForYap: 3,
  highAccuracySampleMin: 8,
  highAccuracyThreshold: 0.85,
  highComboThreshold: 5,
  dialogueCooldownMs: 2600,

  crosshairRadius: 16,
  hitFlashDurationMs: 220,
  scorePopupDurationMs: 700,
  shotMarkerDurationMs: 500
};

/* ---------------------------------------------------------------------
   2. PLAYER BEHAVIOR TRACKER
   Lightweight, game-specific stats. Not a general ML framework -- just
   running counters/averages plus small bounded history arrays.
   --------------------------------------------------------------------- */
function createAimPlayerModel() {
  return {
    shots: 0,
    hits: 0,
    misses: 0,
    totalReactionTime: 0,       // ms from target spawn to shot, summed
    totalShotInterval: 0,       // ms between consecutive shots, summed
    lastShotTime: null,
    recentAimPositions: [],     // last N crosshair positions at time of shot, normalized 0..1
    recentShotResults: [],      // last N booleans (true = hit)
    recentReactionTimes: [],    // last N reaction times in ms
    recentPrecisionScores: [],  // Phase 2: last N precision scores (0 for misses), for "precision player" detection
    missStreak: 0,
    fastShotStreak: 0,
    centerShotStreak: 0,
    // Phase 2: last detected dominant tendency, used to notice when the
    // player deliberately changes strategy (spec §17, "behavioral counterplay").
    lastDominantTendency: null
  };
}

function aimRecordShot(model, { normX, normY, reactionMs, hit, boardShorterSide, radiusFrac, precisionScore }) {
  model.shots++;
  if (hit) { model.hits++; model.missStreak = 0; } else { model.misses++; model.missStreak++; }

  model.totalReactionTime += reactionMs;
  aimPushCapped(model.recentReactionTimes, reactionMs, AIM_CONFIG.recentHistoryLength);
  aimPushCapped(model.recentPrecisionScores, hit ? (precisionScore || 0) : 0, AIM_CONFIG.recentHistoryLength);

  if (model.lastShotTime !== null) {
    model.totalShotInterval += (performance.now() - model.lastShotTime);
  }
  model.lastShotTime = performance.now();

  aimPushCapped(model.recentAimPositions, { x: normX, y: normY }, AIM_CONFIG.recentHistoryLength);
  aimPushCapped(model.recentShotResults, hit, AIM_CONFIG.recentHistoryLength);

  // Fast-shot streak (reacted quickly regardless of hit/miss)
  if (reactionMs < AIM_CONFIG.fastShotThresholdMs) model.fastShotStreak++;
  else model.fastShotStreak = 0;

  // Center-aim streak (aimed near board center regardless of hit/miss)
  const dx = normX - 0.5, dy = normY - 0.5;
  const distFromCenter = Math.sqrt(dx * dx + dy * dy);
  if (distFromCenter < AIM_CONFIG.centerZoneRadiusFrac) model.centerShotStreak++;
  else model.centerShotStreak = 0;
}

function aimPushCapped(arr, value, maxLen) {
  arr.push(value);
  if (arr.length > maxLen) arr.shift();
}

function aimAverage(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Average of recentAimPositions -- the "preferred aim position", normalized 0..1 on each axis. */
function aimPreferredPosition(model) {
  if (model.recentAimPositions.length === 0) return null;
  const avgX = aimAverage(model.recentAimPositions.map(p => p.x));
  const avgY = aimAverage(model.recentAimPositions.map(p => p.y));
  return { x: avgX, y: avgY };
}

function aimAccuracy(model) {
  return model.shots === 0 ? 0 : model.hits / model.shots;
}

/* ---------------------------------------------------------------------
   2c. PLAYER BEHAVIOR CLASSIFICATION (Phase 2)
   Pure, read-only functions over the rolling history already collected in
   aimRecordShot. No new tracking infrastructure -- just statistics over
   recentAimPositions / recentReactionTimes / recentShotResults /
   recentPrecisionScores, favoring recent shots over the whole session
   (spec §3). Nothing here mutates the model or influences the CURRENT
   shot's result -- only future spawns read this (see aimChooseSpawn /
   aimChoosePattern), preserving the fairness rule.
   --------------------------------------------------------------------- */

/** Fraction (0..1) of recent aim positions that fall in a named region: 'center'|'left'|'right'|'upper'|'lower'. */
function aimRegionFraction(model, region) {
  const recent = model.recentAimPositions.slice(-AIM_CONFIG.behavior.recentWindow);
  if (recent.length === 0) return 0;
  const cfg = AIM_CONFIG;
  let count = 0;
  for (const p of recent) {
    if (region === 'center') {
      const d = Math.hypot(p.x - 0.5, p.y - 0.5);
      if (d < cfg.centerZoneRadiusFrac) count++;
    } else if (region === 'left' && p.x < 0.5 - cfg.sideZoneFrac) count++;
    else if (region === 'right' && p.x > 0.5 + cfg.sideZoneFrac) count++;
    else if (region === 'upper' && p.y < 0.5 - cfg.sideZoneFrac) count++;
    else if (region === 'lower' && p.y > 0.5 + cfg.sideZoneFrac) count++;
  }
  return count / recent.length;
}

/** Fraction (0..1) of recent shots fired faster than fastShotThresholdMs. */
function aimFastShotFraction(model) {
  const recent = model.recentReactionTimes.slice(-AIM_CONFIG.behavior.recentWindow);
  if (recent.length === 0) return 0;
  return recent.filter(t => t < AIM_CONFIG.fastShotThresholdMs).length / recent.length;
}

/** Fraction (0..1) of recent shots slower than slowShotThresholdMs ("patient" shooting). */
function aimSlowShotFraction(model) {
  const recent = model.recentReactionTimes.slice(-AIM_CONFIG.behavior.recentWindow);
  if (recent.length === 0) return 0;
  return recent.filter(t => t > AIM_CONFIG.slowShotThresholdMs).length / recent.length;
}

/** Recent accuracy over the classification window (distinct from lifetime aimAccuracy). */
function aimRecentAccuracy(model) {
  const recent = model.recentShotResults.slice(-AIM_CONFIG.behavior.recentWindow);
  if (recent.length === 0) return 0;
  return recent.filter(Boolean).length / recent.length;
}

/** Recent average precision score (0..100) over hits in the window; misses count as 0, matching recentPrecisionScores' storage. */
function aimRecentPrecision(model) {
  const recent = model.recentPrecisionScores.slice(-AIM_CONFIG.behavior.recentWindow);
  if (recent.length === 0) return 0;
  return aimAverage(recent);
}

/**
 * Detects "panic shooting": a fast shot fired immediately after a miss.
 * Looked at over the recent window as a fraction, so a single instance
 * isn't over-read as a full-blown tendency (spec §5 "PANIC SHOOTER").
 */
function aimPanicShotFraction(model) {
  const results = model.recentShotResults.slice(-AIM_CONFIG.behavior.recentWindow);
  const reactions = model.recentReactionTimes.slice(-AIM_CONFIG.behavior.recentWindow);
  if (results.length < 2) return 0;
  let panicCount = 0, opportunities = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i - 1] === false) {
      opportunities++;
      if (reactions[i] < AIM_CONFIG.fastShotThresholdMs) panicCount++;
    }
  }
  return opportunities === 0 ? 0 : panicCount / opportunities;
}

/**
 * Builds the full behavior profile: one entry per tendency with its
 * observed fraction and a simple confidence label. Nothing here is
 * shown to the player directly -- aimChooseSpawn/aimChoosePattern read
 * it to decide adaptation, and the optional debug panel can display it.
 */
function aimBuildBehaviorProfile(model) {
  const cfg = AIM_CONFIG.behavior;
  const enoughSamples = model.shots >= cfg.minSamplesToClassify;

  const raw = {
    center: aimRegionFraction(model, 'center'),
    left: aimRegionFraction(model, 'left'),
    right: aimRegionFraction(model, 'right'),
    upper: aimRegionFraction(model, 'upper'),
    lower: aimRegionFraction(model, 'lower'),
    fastShot: aimFastShotFraction(model),
    slowShot: aimSlowShotFraction(model),
    panicShot: aimPanicShotFraction(model),
    precisionPlayer: model.shots >= cfg.minSamplesToClassify ? aimRecentPrecision(model) / 100 : 0
  };

  const confidenceOf = (fraction) => {
    if (!enoughSamples || fraction < cfg.weakEvidenceThreshold) return 'none';
    return fraction >= cfg.strongEvidenceThreshold ? 'strong' : 'weak';
  };

  const tendencies = {};
  for (const key of Object.keys(raw)) {
    tendencies[key] = { fraction: raw[key], confidence: confidenceOf(raw[key]) };
  }

  // The single dominant tendency (highest fraction among those with at
  // least weak evidence), used for strategy-change detection and dialogue.
  let dominant = null, dominantFraction = 0;
  for (const key of Object.keys(tendencies)) {
    const t = tendencies[key];
    if (t.confidence !== 'none' && t.fraction > dominantFraction) {
      dominant = key;
      dominantFraction = t.fraction;
    }
  }

  return { tendencies, dominant, enoughSamples, recentAccuracy: aimRecentAccuracy(model) };
}

/**
 * Fairness-budget adaptation strength (0..maxStrength). Ramps in with
 * total shots fired (more evidence -> more confidence -> more adaptation),
 * and is reduced ("backs off") when recent accuracy is low so a struggling
 * player gets room to recover, per spec §10/§12/§13.
 */
function aimAdaptationStrength(model) {
  const cfg = AIM_CONFIG.adaptation;
  const evidenceRamp = Math.min(1, model.shots / cfg.rampShots);
  let strength = cfg.maxStrength * evidenceRamp;

  if (model.shots >= cfg.lowAccuracySampleMin && aimRecentAccuracy(model) < cfg.lowAccuracyThreshold) {
    strength *= cfg.backOffMultiplier;
  }

  return strength;
}

/* ---------------------------------------------------------------------
   2b. PRECISION SCORING (v2)
   Pure function: given a shot distance and the target's radius, returns
   the future-proof shot-result data described in the v2 spec. Kept
   separate from aimFireShot so future modes can swap this formula (or
   the AIM_CONFIG.scoring values) without touching input/AI/render code.
   --------------------------------------------------------------------- */
function aimComputePrecisionScore(distance, targetRadius) {
  const cfg = AIM_CONFIG.scoring;
  const hit = distance <= targetRadius;
  const normalizedDistance = Math.min(1, distance / targetRadius);

  if (!hit) {
    return { hit: false, distance, normalizedDistance: Math.min(1, normalizedDistance), precisionScore: 0, tier: 'miss' };
  }

  const precisionScore = Math.max(0, cfg.maxScore * Math.pow(1 - normalizedDistance, cfg.precisionPower));

  let tier = 'hit';
  if (normalizedDistance <= cfg.bullseyeThreshold) tier = 'bullseye';
  else if (normalizedDistance <= cfg.greatThreshold) tier = 'great';

  return { hit: true, distance, normalizedDistance, precisionScore: Math.round(precisionScore), tier };
}

/** Combo multiplier for a given combo count (1-indexed: combo=1 is the first successful hit in a streak). */
function aimComboMultiplier(combo) {
  const cfg = AIM_CONFIG.combo;
  if (combo <= 1) return 1.0;
  return Math.min(cfg.maxMultiplier, 1.0 + (combo - 1) * cfg.multiplierStep);
}

/* ---------------------------------------------------------------------
   3. TARGET AI
   Decides where the next target spawns and which movement pattern it
   uses, based ONLY on the player model built from past shots. It never
   looks at the current in-flight shot or future input (fairness rule).

   Phase 2: spawn/pattern selection now reads the behavior profile
   (aimBuildBehaviorProfile) and a bounded adaptation strength
   (aimAdaptationStrength) instead of a handful of ad-hoc streak checks.
   Same fairness guarantee as Phase 1: both are pure functions of PAST
   shots only, called once per spawn, never touched mid-flight.
   --------------------------------------------------------------------- */
const AIM_PATTERNS = ['horizontal', 'vertical', 'diagonal', 'drift', 'directionChange'];

function aimChooseSpawn(model, boardW, boardH, radius) {
  const margin = radius * 1.4;
  let x = margin + Math.random() * (boardW - margin * 2);
  let y = margin + Math.random() * (boardH - margin * 2);

  // Only adapt once we have enough samples to trust the "habit".
  if (model.shots >= AIM_CONFIG.habitSampleMin) {
    const pref = aimPreferredPosition(model);
    const strength = aimAdaptationStrength(model);
    if (pref && strength > 0) {
      // Bias the spawn AWAY from the player's preferred aim position so
      // repeatedly camping one spot/area stops being free hits over time.
      // Bias magnitude is now driven by the shared, budget-capped
      // adaptationStrength rather than a separate local ramp -- this is
      // the single "fairness budget" the whole AI respects (spec §10).
      const pushX = (pref.x - 0.5);
      const pushY = (pref.y - 0.5);
      x -= pushX * boardW * strength;
      y -= pushY * boardH * strength;
      x = Math.max(margin, Math.min(boardW - margin, x));
      y = Math.max(margin, Math.min(boardH - margin, y));
    }
  }

  return { x, y };
}

function aimChoosePattern(model) {
  if (model.shots < AIM_CONFIG.habitSampleMin) {
    return AIM_PATTERNS[Math.floor(Math.random() * AIM_PATTERNS.length)];
  }

  const weights = { horizontal: 1, vertical: 1, diagonal: 1, drift: 1, directionChange: 1 };
  const strength = aimAdaptationStrength(model); // 0..adaptation.maxStrength, back-off aware
  const profile = aimBuildBehaviorProfile(model);
  const bump = (key, amount) => { weights[key] += amount * (1 + strength * 3); };

  // Fast shooter -> favor patterns that keep moving through the moment the
  // player's timer usually fires, instead of sitting still. This is a
  // movement CHOICE made before the shot, not a reaction to it.
  if (profile.tendencies.fastShot.confidence !== 'none') {
    bump('directionChange', 1.5);
    bump('diagonal', 1);
  }

  // Patient/slow shooter -> a late direction change tests whether they're
  // really tracking, since they have time to notice and adjust (fair --
  // they get to see and react to the new trajectory before shooting).
  if (profile.tendencies.slowShot.confidence !== 'none') {
    bump('directionChange', 1);
  }

  // Left/right bias -> favor patterns that sweep across that axis, so
  // camping one side stops being a free lane. Only ever a "challenge",
  // never full avoidance of that side (spec §7: don't invalidate the habit).
  if (profile.tendencies.left.confidence !== 'none' || profile.tendencies.right.confidence !== 'none') {
    bump('horizontal', 1);
  }
  if (profile.tendencies.upper.confidence !== 'none' || profile.tendencies.lower.confidence !== 'none') {
    bump('vertical', 1);
  }
  if (profile.tendencies.center.confidence !== 'none') {
    bump('horizontal', 0.5);
    bump('vertical', 0.5);
  }

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const pattern of AIM_PATTERNS) {
    roll -= weights[pattern];
    if (roll <= 0) return pattern;
  }
  return 'drift';
}

/** Whether this spawn should use a delayed-start "fake stillness" beat, for players who shoot the instant a target appears. */
function aimShouldDelayMovement(model) {
  if (model.shots < AIM_CONFIG.habitSampleMin) return false;
  const strength = aimAdaptationStrength(model);
  return aimFastShotFraction(model) >= AIM_CONFIG.behavior.weakEvidenceThreshold && Math.random() < strength;
}

/* ---------------------------------------------------------------------
   4. CORE GAME STATE + LOOP
   --------------------------------------------------------------------- */
let aimRunToken = 0;
let aimAnimationId = null;
let aimCanvas = null;
let aimCtx = null;

let aimState = null; // set in aimStartRun()
let aimPlayerModel = createAimPlayerModel();
let aimBestScore = Number(localStorage.getItem('ttb_aim_best') || 0);
let aimLastDialogueTime = 0;

function aimCreateFreshState() {
  return {
    running: false,
    score: 0,
    shotsFired: 0,
    hits: 0,
    startTime: 0,
    target: null,        // { x, y, radius, pattern, vx, vy, spawnTime, lifetimeMs, delayUntil, boostUntil }
    crosshair: { x: 0, y: 0 },
    hasPointer: false,
    effects: [],          // transient visuals: hit markers, miss X, score popups, shot markers
    difficultyStep: 0,
    combo: 0,
    bestCombo: 0,
    totalPrecision: 0,     // sum of (1 - normalizedDistance) over successful hits, for averagePrecision
    shotHistory: []        // bounded list of shotResult objects (future-proof data model, see spec §14)
  };
}

function aimBoardSize() {
  const rect = aimCanvas.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

function aimDifficultyStep(state) {
  return Math.floor(state.shotsFired / AIM_CONFIG.targetsPerDifficultyStep);
}

function aimCurrentRadius(step) {
  return Math.max(AIM_CONFIG.minTargetRadius, AIM_CONFIG.baseTargetRadius - step * AIM_CONFIG.radiusShrinkPerStep);
}
function aimCurrentLifetime(step) {
  return Math.max(AIM_CONFIG.minTargetLifetimeMs, AIM_CONFIG.baseTargetLifetimeMs - step * AIM_CONFIG.lifetimeShrinkPerStepMs);
}
function aimCurrentSpeed(step) {
  return Math.min(AIM_CONFIG.maxTargetSpeed, AIM_CONFIG.baseTargetSpeed + step * AIM_CONFIG.speedGainPerStep);
}

function aimSpawnTarget() {
  const { w, h } = aimBoardSize();
  const step = aimDifficultyStep(aimState);
  const radius = aimCurrentRadius(step);
  const speed = aimCurrentSpeed(step);
  const lifetimeMs = aimCurrentLifetime(step);

  const spawn = aimChooseSpawn(aimPlayerModel, w, h, radius);
  const pattern = aimChoosePattern(aimPlayerModel);
  const angle = Math.random() * Math.PI * 2;

  let vx = 0, vy = 0;
  if (pattern === 'horizontal') { vx = speed * (Math.random() < 0.5 ? 1 : -1); vy = 0; }
  else if (pattern === 'vertical') { vx = 0; vy = speed * (Math.random() < 0.5 ? 1 : -1); }
  else if (pattern === 'diagonal') { vx = speed * Math.cos(angle); vy = speed * Math.sin(angle); }
  else if (pattern === 'drift') { vx = speed * 0.35 * Math.cos(angle); vy = speed * 0.35 * Math.sin(angle); }
  else { vx = speed * Math.cos(angle); vy = speed * Math.sin(angle); } // directionChange: will re-roll periodically

  const delay = aimShouldDelayMovement(aimPlayerModel) ? 280 + Math.random() * 220 : 0;

  aimState.target = {
    x: spawn.x, y: spawn.y, radius,
    pattern, vx, vy,
    spawnTime: performance.now(),
    lifetimeMs,
    delayUntil: performance.now() + delay,
    boostUntil: 0
  };
}

function aimUpdateTarget(dtSec) {
  const t = aimState.target;
  if (!t) return;
  const now = performance.now();

  // Target expired without being hit -> counts as a miss opportunity lost,
  // just respawn (no penalty beyond not scoring).
  if (now - t.spawnTime > t.lifetimeMs) {
    aimSpawnTarget();
    return;
  }

  if (now < t.delayUntil) return; // brief fake-stillness beat, still fair (no cheating, just a pause)

  const { w, h } = aimBoardSize();

  // Movement pattern upkeep
  if (t.pattern === 'directionChange' && Math.random() < AIM_CONFIG.directionChangeChance) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.hypot(t.vx, t.vy) || aimCurrentSpeed(aimDifficultyStep(aimState));
    t.vx = speed * Math.cos(angle);
    t.vy = speed * Math.sin(angle);
  }

  // Brief acceleration burst
  if (now > t.boostUntil && Math.random() < AIM_CONFIG.accelerateChance * dtSec * 10) {
    t.boostUntil = now + AIM_CONFIG.accelerateDurationMs;
  }
  const boosting = now < t.boostUntil;
  const mult = boosting ? AIM_CONFIG.accelerateMultiplier : 1;

  t.x += t.vx * mult * dtSec;
  t.y += t.vy * mult * dtSec;

  // Bounce off board edges
  if (t.x - t.radius < 0) { t.x = t.radius; t.vx *= -1; }
  if (t.x + t.radius > w) { t.x = w - t.radius; t.vx *= -1; }
  if (t.y - t.radius < 0) { t.y = t.radius; t.vy *= -1; }
  if (t.y + t.radius > h) { t.y = h - t.radius; t.vy *= -1; }
}

/* ---------------------------------------------------------------------
   5. INPUT HANDLING
   --------------------------------------------------------------------- */
function aimPointerToCanvasPos(clientX, clientY) {
  const rect = aimCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, clientY - rect.top))
  };
}

function aimHandlePointerMove(clientX, clientY) {
  if (!aimState || !aimState.running) return;
  const pos = aimPointerToCanvasPos(clientX, clientY);
  aimState.crosshair.x = pos.x;
  aimState.crosshair.y = pos.y;
  aimState.hasPointer = true;
}

function aimHandleShoot(clientX, clientY, thisRunToken) {
  if (thisRunToken !== aimRunToken) return; // stale event from a previous run
  if (!aimState || !aimState.running) return;

  const pos = aimPointerToCanvasPos(clientX, clientY);
  aimState.crosshair.x = pos.x;
  aimState.crosshair.y = pos.y;
  aimState.hasPointer = true;

  aimFireShot(pos.x, pos.y);
}

function aimFireShot(x, y) {
  const { w, h } = aimBoardSize();
  const target = aimState.target;
  const now = performance.now();

  aimState.shotsFired++;
  TTBAudio.playUI();

  // Distance/precision are computed from the SAME target snapshot used for
  // the hit test -- both read `target` synchronously here, before any
  // further movement update runs. This keeps visual position and collision
  // position perfectly in sync (v2 fairness requirement).
  const dist = target ? Math.hypot(x - target.x, y - target.y) : Infinity;
  const result = target
    ? aimComputePrecisionScore(dist, target.radius)
    : { hit: false, distance: Infinity, normalizedDistance: 1, precisionScore: 0, tier: 'miss' };
  const hit = result.hit;

  const reactionMs = target ? (now - target.spawnTime) : AIM_CONFIG.fastShotThresholdMs;
  const boardShorterSide = Math.min(w, h);

  const wasCenterHabitBeforeThisShot = aimPlayerModel.centerShotStreak >= 2;
  const wasFastHabitBeforeThisShot = aimPlayerModel.fastShotStreak >= 2;
  const comboBeforeThisShot = aimState.combo;
  const previousDominantTendency = aimPlayerModel.lastDominantTendency;

  aimRecordShot(aimPlayerModel, {
    normX: x / w, normY: y / h,
    reactionMs, hit,
    boardShorterSide, radiusFrac: AIM_CONFIG.centerZoneRadiusFrac,
    precisionScore: result.precisionScore
  });

  // Phase 2: re-classify AFTER recording this shot, then compare against
  // the previously-detected dominant tendency to notice a deliberate
  // strategy change (spec §17 "behavioral counterplay"). This only ever
  // reads/writes the PLAYER's profile -- it has no effect on the shot
  // that already happened, only on future target spawns.
  const behaviorProfile = aimBuildBehaviorProfile(aimPlayerModel);
  const newDominantTendency = behaviorProfile.dominant;
  const strategyJustChanged = behaviorProfile.enoughSamples &&
    previousDominantTendency && newDominantTendency &&
    previousDominantTendency !== newDominantTendency;
  aimPlayerModel.lastDominantTendency = newDominantTendency || previousDominantTendency;

  let finalScore = 0;

  if (hit) {
    aimState.combo++;
    aimState.bestCombo = Math.max(aimState.bestCombo, aimState.combo);
    const multiplier = aimComboMultiplier(aimState.combo);
    finalScore = Math.round(result.precisionScore * multiplier);

    aimState.hits++;
    aimState.score += finalScore;
    aimState.totalPrecision += (1 - result.normalizedDistance);

    TTBAudio.playWin();
    aimAddEffect({ type: 'hit', x, y, time: now });
    aimAddEffect({ type: 'shotMarker', x, y, targetX: target.x, targetY: target.y, time: now });
    aimAddEffect({
      type: 'scorePopup', x, y: y - 20, time: now,
      text: aimFeedbackLabel(result.tier) + ' +' + finalScore
    });

    aimSpawnTarget();

    if (result.tier === 'bullseye') {
      aimMaybeYap('bullseye', now, null, /*forceChance*/ 0.7);
    } else {
      aimMaybeYap('accurateShot', now, () => result.tier === 'great', 0.35);
    }
    aimMaybeYap('predictionBroken', now, () => wasCenterHabitBeforeThisShot || wasFastHabitBeforeThisShot);
  } else {
    const comboBroken = comboBeforeThisShot >= AIM_CONFIG.highComboThreshold;
    aimState.combo = 0;

    TTBAudio.playLose();
    aimAddEffect({ type: 'miss', x, y, time: now });
    aimAddEffect({ type: 'scorePopup', x, y: y - 20, time: now, text: 'MISS' });

    if (comboBroken) {
      aimMaybeYap('missAfterCombo', now, null, 0.7);
    } else if (target) {
      // Player missed while exhibiting a known habit the AI was already
      // countering -- this is the "AI predicted correctly" beat.
      aimMaybeYap('predictionHit', now, () => wasCenterHabitBeforeThisShot || wasFastHabitBeforeThisShot);
    }
  }

  const shotResult = {
    hit, distance: result.distance, normalizedDistance: result.normalizedDistance,
    precisionScore: result.precisionScore, finalScore, reactionTime: reactionMs,
    targetPosition: target ? { x: target.x, y: target.y } : null,
    shotPosition: { x, y }
  };
  aimPushCapped(aimState.shotHistory, shotResult, AIM_CONFIG.recentHistoryLength);

  if (aimState.combo >= AIM_CONFIG.highComboThreshold && aimState.combo === comboBeforeThisShot + 1) {
    aimMaybeYap('highCombo', now, null, 0.5);
  }

  // Phase 2: acknowledge a deliberate strategy change before the generic
  // streak-based lines below (so it doesn't get drowned out by e.g. a
  // fresh miss-streak check that happens to trigger the same shot).
  if (strategyJustChanged) {
    aimMaybeYap('strategyChange', now, null, 0.6);
  } else {
    aimMaybeYapFromBehaviorProfile(behaviorProfile, now);
  }

  aimMaybeYapFromStreaks(now);
  aimUpdateHud();

  // Game over condition: too many consecutive misses ends the run.
  if (aimPlayerModel.missStreak >= 5) {
    aimEndRun();
  }
}

function aimFeedbackLabel(tier) {
  if (tier === 'bullseye') return 'BULLSEYE';
  if (tier === 'great') return 'GREAT';
  return 'HIT';
}

function aimAddEffect(effect) {
  aimState.effects.push(effect);
}

function aimMaybeYap(category, now, conditionFn, chance) {
  if (now - aimLastDialogueTime < AIM_CONFIG.dialogueCooldownMs) return;
  if (conditionFn && !conditionFn()) return;
  // Roll so not every qualifying moment yaps (spec: "keep dialogue occasional").
  const rollChance = typeof chance === 'number' ? chance : 0.5;
  if (Math.random() > rollChance) return;
  aimShowAiLine(Dialogue.pick(AIM_DIALOGUE[category], 'aim.' + category));
  aimLastDialogueTime = now;
}

function aimMaybeYapFromStreaks(now) {
  if (now - aimLastDialogueTime < AIM_CONFIG.dialogueCooldownMs) return;

  if (aimPlayerModel.centerShotStreak >= 3) {
    aimShowAiLine(Dialogue.pick(AIM_DIALOGUE.centerHabit, 'aim.centerHabit'));
    aimLastDialogueTime = now;
  } else if (aimPlayerModel.missStreak >= AIM_CONFIG.missStreakForYap) {
    aimShowAiLine(Dialogue.pick(AIM_DIALOGUE.missStreak, 'aim.missStreak'));
    aimLastDialogueTime = now;
  } else if (aimPlayerModel.fastShotStreak >= AIM_CONFIG.fastStreakForYap) {
    aimShowAiLine(Dialogue.pick(AIM_DIALOGUE.fastShooter, 'aim.fastShooter'));
    aimLastDialogueTime = now;
  } else if (aimPlayerModel.shots >= AIM_CONFIG.highAccuracySampleMin && aimAccuracy(aimPlayerModel) >= AIM_CONFIG.highAccuracyThreshold) {
    aimShowAiLine(Dialogue.pick(AIM_DIALOGUE.highAccuracy, 'aim.highAccuracy'));
    aimLastDialogueTime = now;
  }
}

/**
 * Phase 2: dialogue driven by the behavior profile's STRONG tendencies
 * (left/right/upper/lower bias, patient shooting, panic shooting,
 * precision play). Only fires on strong evidence, and only one line per
 * call, to keep the AI feeling reactive rather than a running narrator
 * (spec §16 "avoid repetitive dialogue").
 */
function aimMaybeYapFromBehaviorProfile(profile, now) {
  if (now - aimLastDialogueTime < AIM_CONFIG.dialogueCooldownMs) return;
  if (!profile.enoughSamples) return;

  const t = profile.tendencies;
  if (t.left.confidence === 'strong') {
    aimShowAiLine(Dialogue.pick(AIM_DIALOGUE.leftBias, 'aim.leftBias'));
    aimLastDialogueTime = now;
  } else if (t.right.confidence === 'strong') {
    aimShowAiLine(Dialogue.pick(AIM_DIALOGUE.rightBias, 'aim.rightBias'));
    aimLastDialogueTime = now;
  } else if (t.slowShot.confidence === 'strong') {
    aimShowAiLine(Dialogue.pick(AIM_DIALOGUE.patientShooter, 'aim.patientShooter'));
    aimLastDialogueTime = now;
  } else if (t.panicShot.confidence !== 'none') {
    aimShowAiLine(Dialogue.pick(AIM_DIALOGUE.panicShooter, 'aim.panicShooter'));
    aimLastDialogueTime = now;
  } else if (t.precisionPlayer.confidence === 'strong') {
    aimShowAiLine(Dialogue.pick(AIM_DIALOGUE.precisionPlayer, 'aim.precisionPlayer'));
    aimLastDialogueTime = now;
  }
}

function aimShowAiLine(line) {
  const box = document.getElementById('aimAiBox');
  const text = document.getElementById('aimAiText');
  if (!box || !text) return;
  text.textContent = line;
  box.style.display = 'block';
}

/** Neural Duel's own dialogue box (separate DOM ids from Classic's #aimAiBox, since both views can exist in the same document). */
function aimDuelShowAiLine(line) {
  const box = document.getElementById('aimDuelAiBox');
  const text = document.getElementById('aimDuelAiText');
  if (!box || !text) return;
  text.textContent = line;
  box.style.display = 'block';
}

/* ---------------------------------------------------------------------
   6. RENDER
   --------------------------------------------------------------------- */
function aimRender() {
  const { w, h } = aimBoardSize();
  if (aimCanvas.width !== Math.round(w * devicePixelRatio) || aimCanvas.height !== Math.round(h * devicePixelRatio)) {
    aimCanvas.width = Math.round(w * devicePixelRatio);
    aimCanvas.height = Math.round(h * devicePixelRatio);
  }
  aimCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  aimCtx.clearRect(0, 0, w, h);

  // Background
  aimCtx.fillStyle = '#0f172a';
  aimCtx.fillRect(0, 0, w, h);

  // Target -- concentric rings communicate precision value at a glance:
  // outer (base) -> middle -> inner -> bullseye (brightest/smallest).
  const t = aimState.target;
  if (t) {
    const cfg = AIM_CONFIG.scoring;
    aimCtx.beginPath();
    aimCtx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
    aimCtx.fillStyle = 'rgba(244, 63, 94, 0.14)';
    aimCtx.fill();
    aimCtx.lineWidth = 3;
    aimCtx.strokeStyle = '#f43f5e';
    aimCtx.stroke();

    // Middle ring at the "great" boundary
    aimCtx.beginPath();
    aimCtx.arc(t.x, t.y, t.radius * cfg.greatThreshold, 0, Math.PI * 2);
    aimCtx.fillStyle = 'rgba(244, 63, 94, 0.28)';
    aimCtx.fill();
    aimCtx.lineWidth = 2;
    aimCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    aimCtx.stroke();

    // Inner ring at the "bullseye" boundary
    aimCtx.beginPath();
    aimCtx.arc(t.x, t.y, t.radius * cfg.bullseyeThreshold * 2.2, 0, Math.PI * 2);
    aimCtx.fillStyle = 'rgba(248, 113, 113, 0.55)';
    aimCtx.fill();

    // Bullseye dot
    aimCtx.beginPath();
    aimCtx.arc(t.x, t.y, t.radius * cfg.bullseyeThreshold, 0, Math.PI * 2);
    aimCtx.fillStyle = '#fef2f2';
    aimCtx.fill();

    // Lifetime ring (shrinks as the target's time runs out)
    const remainingFrac = Math.max(0, 1 - (performance.now() - t.spawnTime) / t.lifetimeMs);
    aimCtx.beginPath();
    aimCtx.arc(t.x, t.y, t.radius + 6, -Math.PI / 2, -Math.PI / 2 + remainingFrac * Math.PI * 2);
    aimCtx.strokeStyle = 'rgba(248, 250, 252, 0.5)';
    aimCtx.lineWidth = 2;
    aimCtx.stroke();
  }

  // Effects (hit marks, miss marks, score popups) -- draw + prune expired
  const now = performance.now();
  aimState.effects = aimState.effects.filter(e => {
    const age = now - e.time;
    if (e.type === 'hit' || e.type === 'miss') {
      if (age > AIM_CONFIG.hitFlashDurationMs) return false;
      const alpha = 1 - age / AIM_CONFIG.hitFlashDurationMs;
      const size = 14 + age * 0.04;
      aimCtx.strokeStyle = e.type === 'hit' ? `rgba(16, 185, 129, ${alpha})` : `rgba(148, 163, 184, ${alpha})`;
      aimCtx.lineWidth = 3;
      aimCtx.beginPath();
      aimCtx.moveTo(e.x - size, e.y - size); aimCtx.lineTo(e.x + size, e.y + size);
      aimCtx.moveTo(e.x + size, e.y - size); aimCtx.lineTo(e.x - size, e.y + size);
      aimCtx.stroke();
      return true;
    }
    if (e.type === 'scorePopup') {
      if (age > AIM_CONFIG.scorePopupDurationMs) return false;
      const alpha = 1 - age / AIM_CONFIG.scorePopupDurationMs;
      aimCtx.fillStyle = `rgba(16, 185, 129, ${alpha})`;
      aimCtx.font = 'bold 16px system-ui, sans-serif';
      aimCtx.textAlign = 'center';
      aimCtx.fillText(e.text, e.x, e.y - age * 0.05);
      return true;
    }
    if (e.type === 'shotMarker') {
      // Briefly shows exactly where the shot landed relative to the target
      // center, so the player can see "I was this far off" (spec §5).
      if (age > AIM_CONFIG.shotMarkerDurationMs) return false;
      const alpha = 1 - age / AIM_CONFIG.shotMarkerDurationMs;
      const size = 7;
      aimCtx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      aimCtx.lineWidth = 2;
      aimCtx.beginPath();
      aimCtx.moveTo(e.x - size, e.y - size); aimCtx.lineTo(e.x + size, e.y + size);
      aimCtx.moveTo(e.x + size, e.y - size); aimCtx.lineTo(e.x - size, e.y + size);
      aimCtx.stroke();
      // Target center dot for reference
      aimCtx.beginPath();
      aimCtx.arc(e.targetX, e.targetY, 3, 0, Math.PI * 2);
      aimCtx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      aimCtx.fill();
      return true;
    }
    return false;
  });

  // Crosshair
  if (aimState.hasPointer) {
    const c = aimState.crosshair;
    aimCtx.strokeStyle = '#f8fafc';
    aimCtx.lineWidth = 2;
    aimCtx.beginPath();
    aimCtx.arc(c.x, c.y, AIM_CONFIG.crosshairRadius, 0, Math.PI * 2);
    aimCtx.stroke();
    aimCtx.beginPath();
    aimCtx.moveTo(c.x - AIM_CONFIG.crosshairRadius - 6, c.y); aimCtx.lineTo(c.x - AIM_CONFIG.crosshairRadius + 4, c.y);
    aimCtx.moveTo(c.x + AIM_CONFIG.crosshairRadius - 4, c.y); aimCtx.lineTo(c.x + AIM_CONFIG.crosshairRadius + 6, c.y);
    aimCtx.moveTo(c.x, c.y - AIM_CONFIG.crosshairRadius - 6); aimCtx.lineTo(c.x, c.y - AIM_CONFIG.crosshairRadius + 4);
    aimCtx.moveTo(c.x, c.y + AIM_CONFIG.crosshairRadius - 4); aimCtx.lineTo(c.x, c.y + AIM_CONFIG.crosshairRadius + 6);
    aimCtx.stroke();
  }
}

function aimUpdateHud() {
  const scoreEl = document.getElementById('aimScore');
  const accEl = document.getElementById('aimAccuracy');
  const comboEl = document.getElementById('aimCombo');
  const bestEl = document.getElementById('aimBestReady');
  if (scoreEl) scoreEl.textContent = aimState.score;
  if (accEl) accEl.textContent = aimState.shotsFired === 0 ? '—' : Math.round(aimAccuracy(aimPlayerModel) * 100) + '%';
  if (comboEl) comboEl.textContent = aimState.combo > 1 ? 'x' + aimComboMultiplier(aimState.combo).toFixed(1) : '—';
  if (bestEl) bestEl.textContent = 'Best: ' + aimBestScore;
  aimUpdateDebugPanel();
}

/**
 * Phase 2: optional, developer-only readout of the current behavior
 * profile and adaptation strength. Hidden by default; only updates its
 * DOM content when the panel is present AND visible, so it costs nothing
 * for normal players (spec §18, "DEBUG ONLY", "small ... is sufficient").
 */
function aimUpdateDebugPanel() {
  const panel = document.getElementById('aimAiDebugPanel');
  if (!panel || panel.style.display === 'none') return;
  if (!aimPlayerModel) return;

  const profile = aimBuildBehaviorProfile(aimPlayerModel);
  const strength = aimAdaptationStrength(aimPlayerModel);
  const pct = (f) => Math.round(f * 100) + '%';

  const lines = [
    'Center: ' + pct(profile.tendencies.center.fraction) + ' (' + profile.tendencies.center.confidence + ')',
    'Left: ' + pct(profile.tendencies.left.fraction) + ' (' + profile.tendencies.left.confidence + ')',
    'Right: ' + pct(profile.tendencies.right.fraction) + ' (' + profile.tendencies.right.confidence + ')',
    'Upper: ' + pct(profile.tendencies.upper.fraction) + ' (' + profile.tendencies.upper.confidence + ')',
    'Lower: ' + pct(profile.tendencies.lower.fraction) + ' (' + profile.tendencies.lower.confidence + ')',
    'Fast Shot: ' + pct(profile.tendencies.fastShot.fraction) + ' (' + profile.tendencies.fastShot.confidence + ')',
    'Patient: ' + pct(profile.tendencies.slowShot.fraction) + ' (' + profile.tendencies.slowShot.confidence + ')',
    'Panic Shot: ' + pct(profile.tendencies.panicShot.fraction) + ' (' + profile.tendencies.panicShot.confidence + ')',
    'Precision Player: ' + pct(profile.tendencies.precisionPlayer.fraction) + ' (' + profile.tendencies.precisionPlayer.confidence + ')',
    'Recent Accuracy: ' + pct(profile.recentAccuracy),
    'Adaptation Strength: ' + strength.toFixed(2) + ' / ' + AIM_CONFIG.adaptation.maxStrength,
    'Dominant Tendency: ' + (profile.dominant || '—')
  ];

  const textEl = document.getElementById('aimAiDebugText');
  if (textEl) textEl.textContent = lines.join('\n');
}

/** Toggles the optional AI debug panel (developer use only, off by default). */
function toggleAimAiDebugPanel() {
  const panel = document.getElementById('aimAiDebugPanel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  aimUpdateDebugPanel();
}

/* ---------------------------------------------------------------------
   7. GAME LOOP
   --------------------------------------------------------------------- */
function aimLoop(thisRunToken, lastTime) {
  if (thisRunToken !== aimRunToken) return; // this run was superseded, stop looping

  const now = performance.now();
  const dtSec = Math.min(0.05, (now - lastTime) / 1000);

  if (aimState.running) {
    aimUpdateTarget(dtSec);
    aimRender();
  }

  aimAnimationId = requestAnimationFrame(() => aimLoop(thisRunToken, now));
}

/* ---------------------------------------------------------------------
   8. START / END / RETRY
   --------------------------------------------------------------------- */
function aimStartRun() {
  aimRunToken++;
  const thisRunToken = aimRunToken;

  aimCanvas = document.getElementById('aimCanvas');
  aimCtx = aimCanvas.getContext('2d');

  aimState = aimCreateFreshState();
  aimState.running = true;
  aimState.startTime = performance.now();
  aimPlayerModel = createAimPlayerModel();
  aimLastDialogueTime = 0;

  document.getElementById('aimOverlayReady').style.display = 'none';
  document.getElementById('aimOverlayEnding').style.display = 'none';
  const aiBox = document.getElementById('aimAiBox');
  aiBox.style.display = 'block';
  document.getElementById('aimAiText').textContent = Dialogue.pick(AIM_DIALOGUE.intro, 'aim.intro');

  aimUpdateHud();
  aimSpawnTarget();
  initAimInput();

  if (aimAnimationId) cancelAnimationFrame(aimAnimationId);
  aimAnimationId = requestAnimationFrame((t) => aimLoop(thisRunToken, t));

  TTBAudio.playStart();
}

function aimEndRun() {
  if (!aimState || !aimState.running) return;
  aimState.running = false;

  const finalScore = aimState.score;
  const finalAccuracy = aimState.shotsFired === 0 ? 0 : Math.round(aimAccuracy(aimPlayerModel) * 100);
  const avgPrecision = aimState.hits === 0 ? 0 : Math.round((aimState.totalPrecision / aimState.hits) * 100);
  const isNewBest = finalScore > aimBestScore;
  if (isNewBest) {
    aimBestScore = finalScore;
    localStorage.setItem('ttb_aim_best', String(aimBestScore));
  }

  TTBAudio.playGameOver();
  if (isNewBest) TTBAudio.playNewBest();

  document.getElementById('aimFinalScore').textContent = finalScore;
  document.getElementById('aimFinalAccuracy').textContent = finalAccuracy + '%';
  document.getElementById('aimFinalBest').textContent = aimBestScore;
  const finalHitsEl = document.getElementById('aimFinalHits');
  const finalMissesEl = document.getElementById('aimFinalMisses');
  const finalComboEl = document.getElementById('aimFinalCombo');
  const finalPrecisionEl = document.getElementById('aimFinalPrecision');
  if (finalHitsEl) finalHitsEl.textContent = aimState.hits;
  if (finalMissesEl) finalMissesEl.textContent = aimPlayerModel.misses;
  if (finalComboEl) finalComboEl.textContent = aimState.bestCombo;
  if (finalPrecisionEl) finalPrecisionEl.textContent = avgPrecision + '%';
  document.getElementById('aimEndingText').textContent = Dialogue.pick(AIM_DIALOGUE.gameOver, 'aim.gameOver');
  document.getElementById('aimOverlayEnding').style.display = 'flex';
  aimUpdateHud();
}

/* ---------------------------------------------------------------------
   9. INPUT WIRING (idempotent -- safe to call every time the game starts)
   --------------------------------------------------------------------- */
function initAimInput() {
  const board = document.getElementById('aimBoardContainer');
  if (!board || board.dataset.aimInputBound === 'true') return;
  board.dataset.aimInputBound = 'true';

  // Guards against the rare hybrid-device case where a touchstart is
  // followed by a synthesized mousedown for the same physical tap (most
  // browsers already suppress this once preventDefault() is called on
  // touchstart, but this is cheap insurance against duplicate shots).
  let lastShotInputTime = 0;
  const MIN_INPUT_GAP_MS = 60;

  // The ready/ending overlays (BEGIN / Play Again / Back to Hub buttons)
  // live inside this same container, on top of the canvas. If we always
  // preventDefault()/handle-aim on every touch/click here, taps on those
  // buttons never reach them (preventDefault on touchstart cancels the
  // browser's synthesized click). So aiming/shooting only applies when the
  // event actually originated on the canvas itself, not on overlay UI.
  const isCanvasTarget = (e) => e.target === aimCanvas;

  board.addEventListener('mousemove', (e) => {
    if (!isCanvasTarget(e)) return;
    aimHandlePointerMove(e.clientX, e.clientY);
  });

  board.addEventListener('mousedown', (e) => {
    if (!isCanvasTarget(e)) return;
    const now = performance.now();
    if (now - lastShotInputTime < MIN_INPUT_GAP_MS) return;
    lastShotInputTime = now;
    const token = aimRunToken;
    aimHandleShoot(e.clientX, e.clientY, token);
  });

  board.addEventListener('touchmove', (e) => {
    if (!isCanvasTarget(e)) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (touch) aimHandlePointerMove(touch.clientX, touch.clientY);
  }, { passive: false });

  board.addEventListener('touchstart', (e) => {
    if (!isCanvasTarget(e)) return; // let overlay buttons receive their own tap/click
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    const now = performance.now();
    if (now - lastShotInputTime < MIN_INPUT_GAP_MS) return;
    lastShotInputTime = now;
    const token = aimRunToken;
    aimHandleShoot(touch.clientX, touch.clientY, token);
  }, { passive: false });
}

/** Hub entry point -- switches to the game view and resets to the "ready" overlay (matches startRunnerGame/startPhysicsGame convention). */
function startAimGame() {
  showView('aimView');
  document.getElementById('aimOverlayReady').style.display = 'flex';
  document.getElementById('aimOverlayEnding').style.display = 'none';
  document.getElementById('aimAiBox').style.display = 'none';
  aimBestScore = Number(localStorage.getItem('ttb_aim_best') || 0);
  document.getElementById('aimBestReady').textContent = 'Best: ' + aimBestScore;
  document.getElementById('aimScore').textContent = '0';
  document.getElementById('aimAccuracy').textContent = '—';
  const comboEl = document.getElementById('aimCombo');
  if (comboEl) comboEl.textContent = '—';
}

/* =====================================================================
   NEURAL DUEL (Phase 3) — isolated special level
   =====================================================================
   Everything below this point is its OWN mode: its own state object
   (aimDuelState), its own run token / animation loop, its own input
   listeners, and its own view/canvas in the DOM (#aimDuelView /
   #aimDuelCanvas). It does not read or write aimState, aimPlayerModel,
   AIM_CONFIG's scoring/combo, or any Classic-mode function. Classic mode
   (everything above this point) is completely unaffected by Neural
   Duel's presence -- this section could be deleted entirely and Classic
   mode would keep working exactly as it does today.

   The actual neural network logic (state encoding, action selection,
   reward function, online learning, checkpoint persistence) lives in
   js/ai/aim-neural.js, mirroring how js/ai/snake-ai.js is Snake's
   bridge to js/ai/neural-network.js. This section only handles: reading
   player input, running the target's physical movement/rendering,
   calling into aim-neural.js at fixed decision intervals, and computing
   the counterfactual baseline used by the reward function.
   ===================================================================== */

const AIM_DUEL_CONFIG = {
  targetRadius: 30,
  targetLifetimeMs: 5000,      // a single duel "round" -- long enough to observe real behavior
  passiveDriftSpeed: 25,       // px/sec -- the BASELINE's own slow, non-adaptive drift (spec §7: baseline keeps following a normal/passive trajectory)
  cursorVelocitySmoothing: 0.35, // how much recent cursor movement contributes to the tracked cursor velocity (0..1, higher = more responsive/less smooth)
  maxRounds: 8,                 // Neural Duel is a short session, not endless (spec: "keep sessions short" precedent from Classic)
  debugPredictedClickMarker: true
};

let aimDuelRunToken = 0;
let aimDuelAnimationId = null;
let aimDuelDecisionIntervalId = null;
let aimDuelCanvas = null;
let aimDuelCtx = null;
let aimDuelBrain = null;
let aimDuelState = null;
let aimDuelLastDialogueTime = 0;

function aimDuelCreateFreshState() {
  return {
    running: false,
    round: 0,
    hits: 0,          // player successfully hit the AI this many times
    evasions: 0,       // AI successfully evaded (Case B) this many times
    unnecessaryMoves: 0, // Case C-moved count, for debug/summary
    lastReward: 0,
    avgReward: 0,
    rewardSamples: 0,
    // Actual, network-controlled target.
    actualX: 0, actualY: 0,
    // Counterfactual baseline -- follows a simple passive drift only,
    // completely uninfluenced by the neural network's decisions.
    baselineX: 0, baselineY: 0, baselineVX: 0, baselineVY: 0,
    // Shared "true" velocity used to seed the baseline at spawn, then the
    // baseline drifts independently from that point on.
    targetVX: 0, targetVY: 0,
    spawnTime: 0,
    lastDecisionTime: 0,
    movementSinceLastShot: 0,       // px the ACTUAL position has moved since the last shot/spawn (for reward shaping)
    movedAwayBeforeShot: false,      // did the AI make an evasive (non-STAY) decision before the next shot arrived?
    lastActionIndex: 0,
    lastActionName: 'STAY',
    lastInputVector: null,
    // Lightweight cursor tracking, local to Neural Duel (does not touch aimPlayerModel).
    cursorX: 0, cursorY: 0, cursorVX: 0, cursorVY: 0, hasPointer: false,
    epsilonShotsObserved: 0,
    effects: []
  };
}

function aimDuelBoardSize() {
  const rect = aimDuelCanvas.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

/** Spawns/respawns the duel target: resets both actual and baseline to the same position, per fairness (no head start for either). */
function aimDuelSpawnTarget() {
  const { w, h } = aimDuelBoardSize();
  const margin = AIM_DUEL_CONFIG.targetRadius * 1.5;
  const x = margin + Math.random() * (w - margin * 2);
  const y = margin + Math.random() * (h - margin * 2);
  const angle = Math.random() * Math.PI * 2;

  aimDuelState.actualX = x;
  aimDuelState.actualY = y;
  aimDuelState.baselineX = x;
  aimDuelState.baselineY = y;
  aimDuelState.targetVX = AIM_DUEL_CONFIG.passiveDriftSpeed * Math.cos(angle);
  aimDuelState.targetVY = AIM_DUEL_CONFIG.passiveDriftSpeed * Math.sin(angle);
  aimDuelState.baselineVX = aimDuelState.targetVX;
  aimDuelState.baselineVY = aimDuelState.targetVY;
  aimDuelState.spawnTime = performance.now();
  aimDuelState.lastDecisionTime = performance.now();
  aimDuelState.movementSinceLastShot = 0;
  aimDuelState.movedAwayBeforeShot = false;
  aimDuelState.lastActionName = 'STAY';
}

/** Advances BOTH the actual (network-controlled) and baseline (passive) positions for one physics tick. Movement source is fully separated: baseline NEVER reads network output. */
function aimDuelUpdatePhysics(dtSec) {
  const s = aimDuelState;
  const { w, h } = aimDuelBoardSize();

  // Baseline: simple passive drift with wall bounce, exactly like a
  // Classic-mode "drift" pattern -- deliberately dumb and NEVER touched
  // by the neural network. This is the counterfactual reference.
  s.baselineX += s.baselineVX * dtSec;
  s.baselineY += s.baselineVY * dtSec;
  const r = AIM_DUEL_CONFIG.targetRadius;
  if (s.baselineX - r < 0) { s.baselineX = r; s.baselineVX *= -1; }
  if (s.baselineX + r > w) { s.baselineX = w - r; s.baselineVX *= -1; }
  if (s.baselineY - r < 0) { s.baselineY = r; s.baselineVY *= -1; }
  if (s.baselineY + r > h) { s.baselineY = h - r; s.baselineVY *= -1; }

  // Actual position drifts the same passive way BETWEEN decisions (so it
  // doesn't look like a static cursor teleporting only on decision ticks
  // -- spec §12 "never teleport"); the network's chosen delta is applied
  // separately, additively, in aimDuelRunDecision below.
  s.actualX += s.targetVX * dtSec;
  s.actualY += s.targetVY * dtSec;
  if (s.actualX - r < 0) { s.actualX = r; s.targetVX *= -1; }
  if (s.actualX + r > w) { s.actualX = w - r; s.targetVX *= -1; }
  if (s.actualY - r < 0) { s.actualY = r; s.targetVY *= -1; }
  if (s.actualY + r > h) { s.actualY = h - r; s.targetVY *= -1; }
}

/**
 * Runs one neural-network decision tick: encode state, choose action,
 * apply the (fairness-clamped) movement to the ACTUAL position only.
 * Called on a fixed interval (AIM_NEURAL_CONFIG.DECISION_INTERVAL_MS),
 * separate from the render loop, per spec §11.
 */
function aimDuelRunDecision() {
  if (!aimDuelState || !aimDuelState.running) return;
  const s = aimDuelState;
  const { w, h } = aimDuelBoardSize();

  const profile = (typeof aimPlayerModel !== 'undefined' && aimPlayerModel.shots > 0)
    ? aimBuildBehaviorProfile(aimPlayerModel)
    : null;
  const avgReactionTimeMs = (typeof aimPlayerModel !== 'undefined' && aimPlayerModel.shots > 0)
    ? aimPlayerModel.totalReactionTime / aimPlayerModel.shots
    : 600;
  const recentImmediateShotFrac = (typeof aimPlayerModel !== 'undefined') ? aimFastShotFraction(aimPlayerModel) : 0;

  const inputVector = encodeAimNeuralState({
    targetX: s.actualX, targetY: s.actualY,
    targetVX: s.targetVX, targetVY: s.targetVY,
    cursorX: s.hasPointer ? s.cursorX : w / 2,
    cursorY: s.hasPointer ? s.cursorY : h / 2,
    cursorVX: s.cursorVX, cursorVY: s.cursorVY,
    boardW: w, boardH: h,
    msSinceSpawn: performance.now() - s.spawnTime,
    avgReactionTimeMs, recentImmediateShotFrac
  });

  const epsilon = computeAimNeuralEpsilon(s.epsilonShotsObserved);
  const choice = chooseAimNeuralAction(aimDuelBrain, inputVector, epsilon);
  const move = decodeAimNeuralMovement(choice.actionName);

  const proposedX = s.actualX + move.dx;
  const proposedY = s.actualY + move.dy;
  const clamped = clampAimNeuralPosition(proposedX, proposedY, w, h, AIM_DUEL_CONFIG.targetRadius);

  const actualDistanceMoved = Math.hypot(clamped.x - s.actualX, clamped.y - s.actualY);
  s.actualX = clamped.x;
  s.actualY = clamped.y;
  s.movementSinceLastShot += actualDistanceMoved;
  if (choice.actionName !== 'STAY') s.movedAwayBeforeShot = true;

  s.lastActionIndex = choice.actionIndex;
  s.lastActionName = choice.actionName;
  s.lastInputVector = inputVector; // kept so trainAimNeuralStep uses the SAME vector used to choose this action
  s.lastDecisionTime = performance.now();

  aimDuelUpdateDebugPanel(choice, epsilon, profile);
}

/** Tracks a lightweight local cursor velocity estimate (Neural Duel's own, does not touch aimPlayerModel). */
function aimDuelTrackCursor(x, y) {
  const s = aimDuelState;
  if (s.hasPointer) {
    const k = AIM_DUEL_CONFIG.cursorVelocitySmoothing;
    const instVX = (x - s.cursorX) / (1 / 60); // approximate px/sec assuming ~60fps move events
    const instVY = (y - s.cursorY) / (1 / 60);
    s.cursorVX = s.cursorVX * (1 - k) + instVX * k;
    s.cursorVY = s.cursorVY * (1 - k) + instVY * k;
  }
  s.cursorX = x;
  s.cursorY = y;
  s.hasPointer = true;
}

/**
 * Resolves a shot: hit-tests against the ACTUAL position (fairness --
 * spec §9/§17/§27, "the target's position at the moment of the shot
 * determines the result"), computes the counterfactual baseline
 * hit-test using the SAME click coordinates, derives the reward, trains
 * the network with the SAME input vector that produced the evaluated
 * decision, then respawns for the next round.
 */
function aimDuelHandleShot(clickX, clickY) {
  if (!aimDuelState || !aimDuelState.running) return;
  const s = aimDuelState;
  const r = AIM_DUEL_CONFIG.targetRadius;

  const actualDist = Math.hypot(clickX - s.actualX, clickY - s.actualY);
  const baselineDist = Math.hypot(clickX - s.baselineX, clickY - s.baselineY);
  const actualWasHit = actualDist <= r;
  const baselineWouldBeHit = baselineDist <= r;

  const { reward, caseLabel, breakdown } = computeAimNeuralReward({
    baselineWouldBeHit,
    actualWasHit,
    movementDistance: s.movementSinceLastShot,
    wasAlreadyMovingAwayBeforeShot: s.movedAwayBeforeShot
  });

  if (s.lastInputVector) {
    trainAimNeuralStep(aimDuelBrain, s.lastInputVector, s.lastActionIndex, reward);
  }

  s.lastReward = reward;
  s.rewardSamples++;
  s.avgReward += (reward - s.avgReward) / s.rewardSamples;
  s.epsilonShotsObserved++;
  s.round++;

  if (actualWasHit) {
    s.hits++;
    TTBAudio.playLose(); // from the AI's perspective this is a "loss" sound; matches Classic's win/lose polarity being about the shooter's success
    aimDuelAddEffect({ type: 'hit', x: clickX, y: clickY, time: performance.now() });
    aimDuelMaybeYap(caseLabel, breakdown);
  } else {
    TTBAudio.playWin(); // AI evaded -- reuse the "positive outcome" sound the same way Classic uses it for the shooter's success, here repurposed for the AI's success (still just an audio cue, no gameplay effect)
    if (caseLabel === 'B_genuine_evasion') s.evasions++;
    if (caseLabel === 'C_unnecessary_movement') s.unnecessaryMoves++;
    aimDuelAddEffect({ type: 'miss', x: clickX, y: clickY, time: performance.now() });
    aimDuelMaybeYap(caseLabel, breakdown);
  }

  aimDuelUpdateHud();

  if (s.round >= AIM_DUEL_CONFIG.maxRounds) {
    aimDuelEndRun();
  } else {
    aimDuelSpawnTarget();
  }
}

function aimDuelAddEffect(effect) {
  aimDuelState.effects.push(effect);
}

/** Contextual dialogue, gated by cooldown, chosen from the actual outcome case -- never fires on every shot (spec §22). */
function aimDuelMaybeYap(caseLabel, breakdown) {
  const now = performance.now();
  if (now - aimDuelLastDialogueTime < AIM_CONFIG.dialogueCooldownMs) return;
  if (Math.random() > 0.55) return;

  let category = null;
  if (caseLabel === 'A_failed_evasion') {
    category = aimDuelState.hits >= 3 ? 'neuralRepeatedlyHit' : 'neuralGotHit';
  } else if (caseLabel === 'B_genuine_evasion') {
    category = (breakdown.movementPenalty && Math.abs(breakdown.movementPenalty) < 0.15) ? 'neuralTinyEvasion' : 'neuralPredicted';
  } else if (caseLabel === 'C_unnecessary_movement') {
    category = 'neuralPanicMovement';
  }
  if (!category || !AIM_DIALOGUE[category]) return;

  aimDuelShowAiLine(Dialogue.pick(AIM_DIALOGUE[category], 'aimDuel.' + category));
  aimDuelLastDialogueTime = now;
}

function aimDuelUpdateHud() {
  const s = aimDuelState;
  const roundEl = document.getElementById('aimDuelRound');
  const evasionsEl = document.getElementById('aimDuelEvasions');
  const hitsEl = document.getElementById('aimDuelHits');
  if (roundEl) roundEl.textContent = s.round + ' / ' + AIM_DUEL_CONFIG.maxRounds;
  if (evasionsEl) evasionsEl.textContent = s.evasions;
  if (hitsEl) hitsEl.textContent = s.hits;
}

/* ---------------------------------------------------------------------
   RENDER (separate canvas/loop from Classic mode)
   --------------------------------------------------------------------- */
function aimDuelRender() {
  const { w, h } = aimDuelBoardSize();
  if (aimDuelCanvas.width !== Math.round(w * devicePixelRatio) || aimDuelCanvas.height !== Math.round(h * devicePixelRatio)) {
    aimDuelCanvas.width = Math.round(w * devicePixelRatio);
    aimDuelCanvas.height = Math.round(h * devicePixelRatio);
  }
  aimDuelCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  aimDuelCtx.clearRect(0, 0, w, h);
  aimDuelCtx.fillStyle = '#0f172a';
  aimDuelCtx.fillRect(0, 0, w, h);

  const s = aimDuelState;
  if (s && s.running) {
    // Actual target (the only one the player can shoot -- baseline is never drawn in normal play).
    aimDuelCtx.beginPath();
    aimDuelCtx.arc(s.actualX, s.actualY, AIM_DUEL_CONFIG.targetRadius, 0, Math.PI * 2);
    aimDuelCtx.fillStyle = 'rgba(129, 140, 248, 0.22)';
    aimDuelCtx.fill();
    aimDuelCtx.lineWidth = 3;
    aimDuelCtx.strokeStyle = '#818cf8';
    aimDuelCtx.stroke();
    aimDuelCtx.beginPath();
    aimDuelCtx.arc(s.actualX, s.actualY, AIM_DUEL_CONFIG.targetRadius * 0.35, 0, Math.PI * 2);
    aimDuelCtx.fillStyle = '#818cf8';
    aimDuelCtx.fill();

    // Debug-only: predicted-click marker and baseline ghost (spec §24), gated behind the same debug panel visibility as Classic's.
    const debugPanel = document.getElementById('aimDuelDebugPanel');
    if (debugPanel && debugPanel.style.display !== 'none') {
      aimDuelCtx.beginPath();
      aimDuelCtx.arc(s.baselineX, s.baselineY, AIM_DUEL_CONFIG.targetRadius, 0, Math.PI * 2);
      aimDuelCtx.setLineDash([4, 4]);
      aimDuelCtx.strokeStyle = 'rgba(248, 250, 252, 0.4)';
      aimDuelCtx.lineWidth = 1.5;
      aimDuelCtx.stroke();
      aimDuelCtx.setLineDash([]);
    }

    // Crosshair
    if (s.hasPointer) {
      aimDuelCtx.strokeStyle = '#f8fafc';
      aimDuelCtx.lineWidth = 2;
      aimDuelCtx.beginPath();
      aimDuelCtx.arc(s.cursorX, s.cursorY, AIM_CONFIG.crosshairRadius, 0, Math.PI * 2);
      aimDuelCtx.stroke();
    }
  }

  // Effects
  const now = performance.now();
  aimDuelState && (aimDuelState.effects = aimDuelState.effects.filter(e => {
    const age = now - e.time;
    if (age > AIM_CONFIG.hitFlashDurationMs) return false;
    const alpha = 1 - age / AIM_CONFIG.hitFlashDurationMs;
    const size = 14 + age * 0.04;
    aimDuelCtx.strokeStyle = e.type === 'hit' ? `rgba(16, 185, 129, ${alpha})` : `rgba(148, 163, 184, ${alpha})`;
    aimDuelCtx.lineWidth = 3;
    aimDuelCtx.beginPath();
    aimDuelCtx.moveTo(e.x - size, e.y - size); aimDuelCtx.lineTo(e.x + size, e.y + size);
    aimDuelCtx.moveTo(e.x + size, e.y - size); aimDuelCtx.lineTo(e.x - size, e.y + size);
    aimDuelCtx.stroke();
    return true;
  }));
}

function aimDuelLoop(thisRunToken, lastTime) {
  if (thisRunToken !== aimDuelRunToken) return;
  const now = performance.now();
  const dtSec = Math.min(0.05, (now - lastTime) / 1000);
  if (aimDuelState && aimDuelState.running) {
    aimDuelUpdatePhysics(dtSec);
    aimDuelRender();
  }
  aimDuelAnimationId = requestAnimationFrame((t) => aimDuelLoop(thisRunToken, t));
}

/* ---------------------------------------------------------------------
   DEBUG PANEL (Phase 3) -- optional, developer-only, hidden by default.
   Separate DOM ids from Classic's debug panel so the two never collide.
   --------------------------------------------------------------------- */
function aimDuelUpdateDebugPanel(choice, epsilon, profile) {
  const panel = document.getElementById('aimDuelDebugPanel');
  if (!panel || panel.style.display === 'none') return;
  const textEl = document.getElementById('aimDuelDebugText');
  if (!textEl || !aimDuelState) return;
  const s = aimDuelState;

  const lines = [
    'Round: ' + s.round + ' / ' + AIM_DUEL_CONFIG.maxRounds,
    'Exploration (epsilon): ' + Math.round(epsilon * 100) + '%',
    'Current action: ' + (choice ? choice.actionName : s.lastActionName) + (choice && choice.wasExploration ? ' (explore)' : ' (greedy)'),
    'Last reward: ' + s.lastReward.toFixed(2),
    'Average reward: ' + s.avgReward.toFixed(2),
    'Successful evasions: ' + s.evasions,
    'Unnecessary movements: ' + s.unnecessaryMoves,
    'AI hit count: ' + s.hits,
    'Movement since last shot: ' + s.movementSinceLastShot.toFixed(1) + 'px'
  ];
  textEl.textContent = lines.join('\n');
}

function toggleAimDuelDebugPanel() {
  const panel = document.getElementById('aimDuelDebugPanel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

/* ---------------------------------------------------------------------
   START / END / RESET / TRAINING CONTROLS
   --------------------------------------------------------------------- */
function aimDuelStartRun() {
  aimDuelRunToken++;
  const thisRunToken = aimDuelRunToken;

  aimDuelCanvas = document.getElementById('aimDuelCanvas');
  aimDuelCtx = aimDuelCanvas.getContext('2d');

  if (!aimDuelBrain) {
    const checkpoint = loadAimNeuralCheckpoint();
    aimDuelBrain = checkpoint ? NeuralNetwork.fromJSON(checkpoint.weights) : createAimNeuralBrain();
  }

  aimDuelState = aimDuelCreateFreshState();
  aimDuelState.running = true;

  const readyEl = document.getElementById('aimDuelOverlayReady');
  const endEl = document.getElementById('aimDuelOverlayEnding');
  if (readyEl) readyEl.style.display = 'none';
  if (endEl) endEl.style.display = 'none';
  const aiBox = document.getElementById('aimDuelAiBox');
  if (aiBox) {
    aiBox.style.display = 'block';
    const textEl = document.getElementById('aimDuelAiText');
    if (textEl) textEl.textContent = Dialogue.pick(AIM_DIALOGUE.neuralIntro || AIM_DIALOGUE.intro, 'aimDuel.intro');
  }

  aimDuelUpdateHud();
  aimDuelSpawnTarget();
  initAimDuelInput();

  if (aimDuelAnimationId) cancelAnimationFrame(aimDuelAnimationId);
  aimDuelAnimationId = requestAnimationFrame((t) => aimDuelLoop(thisRunToken, t));

  if (aimDuelDecisionIntervalId) clearInterval(aimDuelDecisionIntervalId);
  aimDuelDecisionIntervalId = setInterval(aimDuelRunDecision, AIM_NEURAL_CONFIG.DECISION_INTERVAL_MS);

  TTBAudio.playStart();
}

function aimDuelEndRun() {
  if (!aimDuelState || !aimDuelState.running) return;
  aimDuelState.running = false;

  if (aimDuelDecisionIntervalId) { clearInterval(aimDuelDecisionIntervalId); aimDuelDecisionIntervalId = null; }

  saveAimNeuralCheckpoint(aimDuelBrain, {
    hits: aimDuelState.hits,
    evasions: aimDuelState.evasions,
    unnecessaryMoves: aimDuelState.unnecessaryMoves,
    avgReward: aimDuelState.avgReward
  });

  const endEl = document.getElementById('aimDuelOverlayEnding');
  const summaryHitsEl = document.getElementById('aimDuelFinalHits');
  const summaryEvasionsEl = document.getElementById('aimDuelFinalEvasions');
  const summaryRewardEl = document.getElementById('aimDuelFinalReward');
  if (summaryHitsEl) summaryHitsEl.textContent = aimDuelState.hits;
  if (summaryEvasionsEl) summaryEvasionsEl.textContent = aimDuelState.evasions;
  if (summaryRewardEl) summaryRewardEl.textContent = aimDuelState.avgReward.toFixed(2);
  const endTextEl = document.getElementById('aimDuelEndingText');
  if (endTextEl) endTextEl.textContent = Dialogue.pick(AIM_DIALOGUE.neuralOutro || AIM_DIALOGUE.gameOver, 'aimDuel.outro');
  if (endEl) endEl.style.display = 'flex';
}

/** Reset the neural network to a fresh, untrained state (spec §18) -- both the live brain and the saved checkpoint. */
function resetAimDuelNeuralNetwork() {
  aimDuelBrain = createAimNeuralBrain();
  resetAimNeuralCheckpoint();
  aimDuelUpdateDebugPanel(null, AIM_NEURAL_CONFIG.EPSILON_START, null);
}

/** Hub entry point for Neural Duel. */
function startAimDuelGame() {
  showView('aimDuelView');
  const readyEl = document.getElementById('aimDuelOverlayReady');
  const endEl = document.getElementById('aimDuelOverlayEnding');
  if (readyEl) readyEl.style.display = 'flex';
  if (endEl) endEl.style.display = 'none';
  const aiBox = document.getElementById('aimDuelAiBox');
  if (aiBox) aiBox.style.display = 'none';
}

/** Idempotent input binding for Neural Duel's own canvas/container, following the same isCanvasTarget guard pattern as Classic mode. */
function initAimDuelInput() {
  const board = document.getElementById('aimDuelBoardContainer');
  if (!board || board.dataset.aimDuelInputBound === 'true') return;
  board.dataset.aimDuelInputBound = 'true';

  let lastShotInputTime = 0;
  const MIN_INPUT_GAP_MS = 60;
  const isCanvasTarget = (e) => e.target === aimDuelCanvas;

  board.addEventListener('mousemove', (e) => {
    if (!isCanvasTarget(e) || !aimDuelState) return;
    const rect = aimDuelCanvas.getBoundingClientRect();
    aimDuelTrackCursor(e.clientX - rect.left, e.clientY - rect.top);
  });

  board.addEventListener('mousedown', (e) => {
    if (!isCanvasTarget(e) || !aimDuelState) return;
    const now = performance.now();
    if (now - lastShotInputTime < MIN_INPUT_GAP_MS) return;
    lastShotInputTime = now;
    const rect = aimDuelCanvas.getBoundingClientRect();
    aimDuelHandleShot(e.clientX - rect.left, e.clientY - rect.top);
  });

  board.addEventListener('touchmove', (e) => {
    if (!isCanvasTarget(e) || !aimDuelState) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    const rect = aimDuelCanvas.getBoundingClientRect();
    aimDuelTrackCursor(touch.clientX - rect.left, touch.clientY - rect.top);
  }, { passive: false });

  board.addEventListener('touchstart', (e) => {
    if (!isCanvasTarget(e) || !aimDuelState) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    const now = performance.now();
    if (now - lastShotInputTime < MIN_INPUT_GAP_MS) return;
    lastShotInputTime = now;
    const rect = aimDuelCanvas.getBoundingClientRect();
    aimDuelHandleShot(touch.clientX - rect.left, touch.clientY - rect.top);
  }, { passive: false });
}
