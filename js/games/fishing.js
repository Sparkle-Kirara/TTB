/* =====================================================================
   GAMES/FISHING.JS — Game #13 "Fishing"
   =====================================================================
   Simple arcade fishing game. Core loop: CAST -> WAIT -> BITE -> HOOK ->
   FIGHTING -> CAUGHT/ESCAPED -> IDLE. The main mechanic is FIGHTING:
   the player continuously balances LINE TENSION against FISH DISTANCE
   while the fish struggles, using one simple press/release input.

   Fairness discipline (matches Game #12's established pattern): all fish
   movement/resistance is computed once per frame from the fish's own
   state (velocity, target direction, struggle timer) -- it never reads
   or reacts to the player's CURRENT input event after the fact, only
   the continuous tension value the player has been building up. Nothing
   here teleports the fish or invalidates player action retroactively.

   Structure inside this file:
     1. CONFIG              - all tunables in one place (fish types included)
     2. Player behavior tracker (lightweight, for a future AI hook -- spec §19)
     3. Fish model (movement, resistance, struggle)
     4. Tension / distance simulation (the core FIGHTING mechanic)
     5. Core game state + transitions (state machine)
     6. Input handling (mouse + touch + keyboard -> press/release)
     7. Render
     8. Game loop
     9. Public start/stop functions wired into game-manager.js
     10. Input wiring
   ===================================================================== */

const FISHING_CONFIG = {
  // Casting / waiting
  castDurationMs: 700,             // brief casting animation before WAITING begins
  minWaitMs: 1200,                 // shortest possible time before a bite
  maxWaitMs: 4500,                 // longest possible time before a bite
  biteReactionWindowMs: 900,       // how long the player has to react to BITE before it becomes a miss

  // Tension (0..1, 1 = line breaks)
  tensionIncreasePerSec: 1.35,     // rate tension rises while the player is pressing/holding
  tensionDecreasePerSec: 0.9,      // rate tension falls while released
  tensionBreakThreshold: 1.0,
  tensionDangerThreshold: 0.78,    // above this, dialogue/visual warnings trigger

  // Fish distance (0..1, 0 = fish far away/escaped, 1 = caught)
  startingDistance: 0.32,          // fish starts partway reeled in, so the fight has room to go either way
  escapeThreshold: 0.0,
  catchThreshold: 1.0,
  // How distance responds to tension: pulling (tension above the fish's
  // own resistance) reels the fish in; below resistance, the fish gains
  // distance back. This is what creates the core "pull harder to catch
  // faster, but risk breaking the line" decision (spec §8).
  reelRatePerSec: 0.22,            // how fast distance increases when tension > fish resistance
  driftAwayRatePerSec: 0.10,       // how fast distance decreases when tension < fish resistance

  // Fish types (spec §12). Each tuning knob maps directly onto the fish
  // model in section 3 below.
  fishTypes: {
    calm: {
      label: 'Calm',
      baseResistance: 0.28,        // tension needed just to hold ground against this fish
      struggleChance: 0.10,        // per-second chance of a struggle event while fighting
      struggleStrength: 0.35,      // 0..1, how strong a struggle event's pull is
      directionChangeChance: 0.15, // per-second chance of a smooth direction change (visual/movement only)
      baseValue: 40                // used in scoring
    },
    agile: {
      label: 'Agile',
      baseResistance: 0.38,
      struggleChance: 0.16,
      struggleStrength: 0.45,
      directionChangeChance: 0.45,
      baseValue: 60
    },
    strong: {
      label: 'Strong',
      baseResistance: 0.58,
      struggleChance: 0.14,
      struggleStrength: 0.65,
      directionChangeChance: 0.18,
      baseValue: 90
    },
    erratic: {
      label: 'Erratic',
      baseResistance: 0.42,
      struggleChance: 0.30,
      struggleStrength: 0.5,
      directionChangeChance: 0.6,
      baseValue: 80
    }
  },
  // Difficulty ramp: which fish type is available at which catch count.
  // Kept simple -- a short ordered list that cycles/escalates rather than
  // a formal curve (spec §13: "don't make the first fish frustrating").
  difficultyOrder: ['calm', 'calm', 'agile', 'calm', 'strong', 'agile', 'erratic', 'strong'],

  struggleDurationMs: 650,          // how long a single struggle event's strong pull lasts
  struggleCooldownMs: 900,          // minimum gap between struggle events

  // Scoring (spec §11): score = baseFishValue * difficultyMultiplier * efficiencyMultiplier
  difficultyMultiplierPerType: { calm: 1.0, agile: 1.15, strong: 1.35, erratic: 1.25 },
  efficiencyMaxMultiplier: 1.5,      // best possible efficiency multiplier (low max tension, fast catch)
  efficiencyMinMultiplier: 0.6,      // worst-case multiplier for a messy, slow, high-tension catch

  dialogueCooldownMs: 2600,
  longWaitDialogueMs: 3200          // if WAITING exceeds this with no bite yet, allow a "still waiting" line
};

/* ---------------------------------------------------------------------
   2. PLAYER BEHAVIOR TRACKER (spec §19 -- future AI hook)
   Lightweight, game-specific stats only. No neural network, no
   adaptation yet -- purely data collection so a future phase can add
   fish AI without rewriting this file, matching how Game #12's Phase 2
   built directly on top of Phase 1's tracked stats.
   --------------------------------------------------------------------- */
function createFishingPlayerModel() {
  return {
    fightsStarted: 0,
    fightsWon: 0,
    fightsLost: 0,
    totalFightTimeMs: 0,
    overpullCount: 0,          // how many times tension crossed the danger threshold, across all fights
    reactionTimesMs: [],       // bounded list of BITE->hook reaction times
    recentFightResults: [],    // bounded list of booleans (true = caught)
    lossStreak: 0
  };
}

function fishingPushCapped(arr, value, maxLen) {
  arr.push(value);
  if (arr.length > maxLen) arr.shift();
}

/* ---------------------------------------------------------------------
   3. FISH MODEL
   A fish is a small state object updated once per frame. Movement is
   smooth (velocity + easing), not jittery, per spec §6. Struggle events
   are scheduled probabilistically but always resolve over their own
   fixed duration -- they are never triggered or cancelled based on the
   player's current input event, only on the fish's own timer/state.
   --------------------------------------------------------------------- */
function createFish(typeKey) {
  const type = FISHING_CONFIG.fishTypes[typeKey];
  return {
    typeKey,
    type,
    // Visual position only (0..1 across the play lane) -- NOT the same as
    // "distance" (which tracks fight progress). Purely for rendering the
    // fish moving left/right while fighting.
    visualX: 0.5,
    visualVX: 0,
    strugglingUntil: 0,
    struggleDirection: 0,
    lastStruggleAt: -Infinity
  };
}

/** Advances the fish's visual movement and decides whether a new struggle event should begin. Called once per frame during FIGHTING. */
function updateFish(fish, dtSec, now) {
  const type = fish.type;

  const isStruggling = now < fish.strugglingUntil;
  if (!isStruggling) {
    // Smooth wandering movement between struggles.
    if (Math.random() < type.directionChangeChance * dtSec) {
      fish.visualVX = (Math.random() * 2 - 1) * 0.4;
    }
    // Possibly start a new struggle event (own timer-gated, never input-triggered).
    if (now - fish.lastStruggleAt > FISHING_CONFIG.struggleCooldownMs && Math.random() < type.struggleChance * dtSec) {
      fish.strugglingUntil = now + FISHING_CONFIG.struggleDurationMs;
      fish.struggleDirection = Math.random() < 0.5 ? -1 : 1;
      fish.lastStruggleAt = now;
      return { isStruggling: true, justStartedStruggle: true };
    }
  } else {
    fish.visualVX = fish.struggleDirection * type.struggleStrength;
  }

  fish.visualX += fish.visualVX * dtSec;
  fish.visualX = Math.max(0.05, Math.min(0.95, fish.visualX));
  if (fish.visualX <= 0.05 || fish.visualX >= 0.95) fish.visualVX *= -1;

  return { isStruggling, justStartedStruggle: false };
}

/** Current effective resistance for this instant -- higher during a struggle event, per spec §6 ("stronger escape attempts"). */
function currentFishResistance(fish, now) {
  const isStruggling = now < fish.strugglingUntil;
  return isStruggling ? fish.type.baseResistance + fish.type.struggleStrength * 0.5 : fish.type.baseResistance;
}

/* ---------------------------------------------------------------------
   4. TENSION / DISTANCE SIMULATION (the core FIGHTING mechanic)
   Pure function of the current state + dt -- called once per frame.
   --------------------------------------------------------------------- */
function updateTensionAndDistance(fight, dtSec, now, isPressing) {
  const cfg = FISHING_CONFIG;

  // Tension continuously rises while pressing, falls while released. This
  // is deliberately NOT instant (spec §4: "constantly make small
  // adjustments"), so held-down spam is punished by the rate, not blocked outright.
  if (isPressing) {
    fight.tension = Math.min(1, fight.tension + cfg.tensionIncreasePerSec * dtSec);
  } else {
    fight.tension = Math.max(0, fight.tension - cfg.tensionDecreasePerSec * dtSec);
  }
  fight.maxTensionReached = Math.max(fight.maxTensionReached, fight.tension);

  const resistance = currentFishResistance(fight.fish, now);

  // Distance responds to how much tension EXCEEDS (or falls short of) the
  // fish's current resistance -- this is the "pull harder to catch faster,
  // but risk breaking the line" decision from spec §8.
  const pullAdvantage = fight.tension - resistance;
  if (pullAdvantage > 0) {
    fight.distance = Math.min(1, fight.distance + cfg.reelRatePerSec * pullAdvantage * dtSec);
  } else {
    fight.distance = Math.max(0, fight.distance + cfg.driftAwayRatePerSec * pullAdvantage * dtSec); // pullAdvantage is negative here, so this decreases distance
  }

  if (fight.tension >= cfg.tensionDangerThreshold) fight.overpullFrames++;
}

/* ---------------------------------------------------------------------
   5. CORE GAME STATE + TRANSITIONS
   --------------------------------------------------------------------- */
let fishingRunToken = 0;
let fishingAnimationId = null;
let fishingCanvas = null;
let fishingCtx = null;

let fishingState = null;
let fishingPlayerModel = createFishingPlayerModel();
let fishingBestScore = Number(localStorage.getItem('ttb_fishing_best') || 0);
let fishingLastDialogueTime = 0;
let fishingCatchCount = 0; // drives the difficulty order, resets each session

function fishingCreateFreshState() {
  return {
    phase: 'IDLE', // IDLE | CASTING | WAITING | BITE | FIGHTING | CAUGHT | ESCAPED
    phaseStartedAt: 0,
    biteAt: 0,          // WAITING -> BITE transition timestamp, scheduled when casting completes
    isPressing: false,
    fight: null,        // { fish, tension, distance, startedAt, overpullFrames, maxTensionReached }
    lastScore: null,
    lastCatchWasHardWon: false,
    lastBreakReason: null,
    effects: []
  };
}

function fishingBoardSize() {
  const rect = fishingCanvas.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

function fishingPickFishType() {
  const order = FISHING_CONFIG.difficultyOrder;
  const idx = Math.min(fishingCatchCount, order.length - 1);
  return order[idx];
}

function fishingSetPhase(phase) {
  fishingState.phase = phase;
  fishingState.phaseStartedAt = performance.now();
}

function fishingStartCast() {
  if (!fishingState) return;
  if (fishingState.phase !== 'IDLE' && fishingState.phase !== 'CAUGHT' && fishingState.phase !== 'ESCAPED') return;
  fishingState.fight = null;
  fishingSetPhase('CASTING');
  TTBAudio.playStart();
  fishingUpdateOverlayForPhase();
}

function fishingBeginWaiting() {
  fishingSetPhase('WAITING');
  const waitMs = FISHING_CONFIG.minWaitMs + Math.random() * (FISHING_CONFIG.maxWaitMs - FISHING_CONFIG.minWaitMs);
  fishingState.biteAt = performance.now() + waitMs;
  fishingUpdateOverlayForPhase();
}

function fishingTriggerBite() {
  fishingSetPhase('BITE');
  TTBAudio.playHint();
  fishingUpdateOverlayForPhase();
}

function fishingHandleBiteTimeout() {
  // Player failed to react in time -- BITE -> ESCAPED, per spec §3.
  fishingSetPhase('ESCAPED');
  fishingState.lastBreakReason = 'missedBite';
  fishingPlayerModel.fightsLost++;
  fishingPlayerModel.lossStreak++;
  fishingMaybeYap('missedBite');
  fishingUpdateOverlayForPhase();
  fishingUpdateHud();
}

function fishingHookFish() {
  if (fishingState.phase !== 'BITE') return; // stale/duplicate input guard
  const reactionMs = performance.now() - fishingState.phaseStartedAt;
  fishingPushCapped(fishingPlayerModel.reactionTimesMs, reactionMs, 10);

  const typeKey = fishingPickFishType();
  const fish = createFish(typeKey);
  fishingState.fight = {
    fish,
    tension: 0.15,
    distance: FISHING_CONFIG.startingDistance,
    startedAt: performance.now(),
    overpullFrames: 0,
    maxTensionReached: 0.15
  };
  fishingPlayerModel.fightsStarted++;
  fishingSetPhase('FIGHTING');
  TTBAudio.playSelect();
  fishingMaybeYap('goodHook');
  fishingUpdateOverlayForPhase();
}

function fishingComputeScore(fight, fightDurationMs) {
  const cfg = FISHING_CONFIG;
  const typeKey = fight.fish.typeKey;
  const baseValue = cfg.fishTypes[typeKey].baseValue;
  const difficultyMultiplier = cfg.difficultyMultiplierPerType[typeKey];

  // Efficiency: rewards a fast catch with low max tension. Both factors
  // normalized 0..1 then blended, clamped into the configured multiplier range.
  const tensionEfficiency = 1 - fight.maxTensionReached; // lower max tension -> closer to 1
  const speedEfficiency = Math.max(0, 1 - fightDurationMs / 12000); // faster -> closer to 1, floors at 12s
  const blendedEfficiency = (tensionEfficiency * 0.6 + speedEfficiency * 0.4);
  const efficiencyMultiplier = cfg.efficiencyMinMultiplier + (cfg.efficiencyMaxMultiplier - cfg.efficiencyMinMultiplier) * blendedEfficiency;

  const total = Math.round(baseValue * difficultyMultiplier * efficiencyMultiplier);
  return { total, baseValue, difficultyMultiplier, efficiencyMultiplier, typeKey };
}

function fishingResolveCatch() {
  const fight = fishingState.fight;
  const fightDurationMs = performance.now() - fight.startedAt;
  fishingPlayerModel.totalFightTimeMs += fightDurationMs;
  fishingPlayerModel.fightsWon++;
  fishingPlayerModel.lossStreak = 0;
  fishingPushCapped(fishingPlayerModel.recentFightResults, true, 10);

  const score = fishingComputeScore(fight, fightDurationMs);
  fishingState.lastScore = score;
  fishingState.lastCatchWasHardWon = (fight.fish.typeKey === 'strong' || fight.fish.typeKey === 'erratic') && fightDurationMs > 4000;
  fishingCatchCount++;

  if (score.total > fishingBestScore) {
    fishingBestScore = score.total;
    localStorage.setItem('ttb_fishing_best', String(fishingBestScore));
  }

  fishingSetPhase('CAUGHT');
  TTBAudio.playWin();
  if (fishingState.lastCatchWasHardWon) fishingMaybeYap('hardWonCatch');
  else if (fightDurationMs < 2200) fishingMaybeYap('quickCatch');
  fishingUpdateOverlayForPhase();
  fishingUpdateHud();
}

function fishingResolveEscape(reason) {
  fishingPlayerModel.fightsLost++;
  fishingPlayerModel.lossStreak++;
  fishingPushCapped(fishingPlayerModel.recentFightResults, false, 10);
  fishingState.lastBreakReason = reason;
  fishingSetPhase('ESCAPED');
  TTBAudio.playLose();
  if (reason === 'break') fishingMaybeYap('lineBroke');
  else fishingMaybeYap('fishEscaped');
  if (fishingPlayerModel.lossStreak >= 2) fishingMaybeYap('losingStreak');
  fishingUpdateOverlayForPhase();
  fishingUpdateHud();
}

/* ---------------------------------------------------------------------
   6. INPUT HANDLING
   --------------------------------------------------------------------- */
function fishingSetPressing(pressing) {
  if (!fishingState) return;

  // BITE -> hook reaction is a discrete press event, handled separately
  // in fishingHookFish(); pressing during FIGHTING drives tension.
  if (fishingState.phase === 'BITE' && pressing) {
    fishingHookFish();
    return;
  }
  if (fishingState.phase !== 'FIGHTING') return;

  const wasPressing = fishingState.isPressing;
  fishingState.isPressing = pressing;
  if (wasPressing && !pressing) fishingPlayerModel.overpullCount += 0; // release transition tracked implicitly via overpullFrames elsewhere
}

/* ---------------------------------------------------------------------
   DIALOGUE
   --------------------------------------------------------------------- */
function fishingMaybeYap(category, chance) {
  const now = performance.now();
  if (now - fishingLastDialogueTime < FISHING_CONFIG.dialogueCooldownMs) return;
  const rollChance = typeof chance === 'number' ? chance : 0.7;
  if (Math.random() > rollChance) return;
  if (!FISHING_DIALOGUE[category]) return;
  fishingShowAiLine(Dialogue.pick(FISHING_DIALOGUE[category], 'fishing.' + category));
  fishingLastDialogueTime = now;
}

function fishingShowAiLine(line) {
  const box = document.getElementById('fishingAiBox');
  const text = document.getElementById('fishingAiText');
  if (!box || !text) return;
  text.textContent = line;
  box.style.display = 'block';
}

/* ---------------------------------------------------------------------
   HUD / OVERLAY
   --------------------------------------------------------------------- */
function fishingUpdateHud() {
  const bestEl = document.getElementById('fishingBestReady');
  const scoreEl = document.getElementById('fishingLastScore');
  if (bestEl) bestEl.textContent = 'Best: ' + fishingBestScore;
  if (scoreEl) scoreEl.textContent = fishingState.lastScore ? String(fishingState.lastScore.total) : '—';
}

function fishingUpdateOverlayForPhase() {
  const statusEl = document.getElementById('fishingStatusText');
  const catchInfoEl = document.getElementById('fishingCatchInfo');
  const castBtn = document.getElementById('fishingCastBtn');
  if (!fishingState) return;

  const phase = fishingState.phase;
  if (statusEl) {
    const labels = {
      IDLE: 'Ready to cast.',
      CASTING: 'Casting...',
      WAITING: 'Waiting for a bite...',
      BITE: 'BITE! Tap now!',
      FIGHTING: 'Reeling it in...',
      CAUGHT: 'CAUGHT!',
      ESCAPED: fishingState.lastBreakReason === 'break' ? 'LINE BROKE!' : (fishingState.lastBreakReason === 'missedBite' ? 'TOO SLOW!' : 'THE FISH GOT AWAY!')
    };
    statusEl.textContent = labels[phase] || '';
  }
  if (castBtn) castBtn.style.display = (phase === 'IDLE' || phase === 'CAUGHT' || phase === 'ESCAPED') ? 'inline-flex' : 'none';
  if (catchInfoEl) {
    if (phase === 'CAUGHT' && fishingState.lastScore) {
      const s = fishingState.lastScore;
      catchInfoEl.textContent = FISHING_CONFIG.fishTypes[s.typeKey].label + ' fish — +' + s.total;
      catchInfoEl.style.display = 'block';
    } else {
      catchInfoEl.style.display = 'none';
    }
  }
}

/* ---------------------------------------------------------------------
   7. RENDER
   --------------------------------------------------------------------- */
function fishingRender() {
  const { w, h } = fishingBoardSize();
  if (fishingCanvas.width !== Math.round(w * devicePixelRatio) || fishingCanvas.height !== Math.round(h * devicePixelRatio)) {
    fishingCanvas.width = Math.round(w * devicePixelRatio);
    fishingCanvas.height = Math.round(h * devicePixelRatio);
  }
  fishingCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  fishingCtx.clearRect(0, 0, w, h);

  // Water background
  fishingCtx.fillStyle = '#0c4a6e';
  fishingCtx.fillRect(0, 0, w, h);
  fishingCtx.fillStyle = 'rgba(56, 189, 248, 0.15)';
  for (let i = 0; i < 4; i++) {
    fishingCtx.fillRect(0, h * (0.2 + i * 0.2), w, 2);
  }

  const phase = fishingState.phase;
  const waterLineY = h * 0.18;

  // Fishing line from the top-center down into the water.
  fishingCtx.strokeStyle = 'rgba(248, 250, 252, 0.6)';
  fishingCtx.lineWidth = 2;
  fishingCtx.beginPath();
  fishingCtx.moveTo(w / 2, 0);

  if (phase === 'FIGHTING' && fishingState.fight) {
    const fish = fishingState.fight.fish;
    const fishX = fish.visualX * w;
    const fishY = waterLineY + (h - waterLineY) * (1 - fishingState.fight.distance) * 0.7 + (h - waterLineY) * 0.15;
    fishingCtx.lineTo(fishX, fishY);
    fishingCtx.stroke();

    // Fish body (simple shape, per spec "simple shapes are acceptable").
    const isStruggling = performance.now() < fish.strugglingUntil;
    fishingCtx.fillStyle = isStruggling ? '#f97316' : '#facc15';
    fishingCtx.beginPath();
    fishingCtx.ellipse(fishX, fishY, 22, 12, 0, 0, Math.PI * 2);
    fishingCtx.fill();
  } else {
    fishingCtx.lineTo(w / 2, waterLineY);
    fishingCtx.stroke();
    // Bobber
    fishingCtx.fillStyle = '#ef4444';
    fishingCtx.beginPath();
    fishingCtx.arc(w / 2, waterLineY, 8, 0, Math.PI * 2);
    fishingCtx.fill();
  }

  // Tension / distance bars during FIGHTING.
  if (phase === 'FIGHTING' && fishingState.fight) {
    const fight = fishingState.fight;
    const barW = w * 0.7, barX = w * 0.15;

    // Tension bar
    const tensionY = h - 60;
    fishingCtx.fillStyle = 'rgba(255,255,255,0.15)';
    fishingCtx.fillRect(barX, tensionY, barW, 14);
    const tensionColor = fight.tension >= FISHING_CONFIG.tensionDangerThreshold ? '#ef4444' : '#22d3ee';
    fishingCtx.fillStyle = tensionColor;
    fishingCtx.fillRect(barX, tensionY, barW * fight.tension, 14);

    // Distance bar
    const distanceY = h - 36;
    fishingCtx.fillStyle = 'rgba(255,255,255,0.15)';
    fishingCtx.fillRect(barX, distanceY, barW, 14);
    fishingCtx.fillStyle = '#4ade80';
    fishingCtx.fillRect(barX, distanceY, barW * fight.distance, 14);
  }

  // Effects (score popups etc.)
  const now = performance.now();
  fishingState.effects = fishingState.effects.filter(e => {
    const age = now - e.time;
    if (age > 700) return false;
    const alpha = 1 - age / 700;
    fishingCtx.fillStyle = `rgba(74, 222, 128, ${alpha})`;
    fishingCtx.font = 'bold 18px system-ui, sans-serif';
    fishingCtx.textAlign = 'center';
    fishingCtx.fillText(e.text, e.x, e.y - age * 0.05);
    return true;
  });
}

/* ---------------------------------------------------------------------
   8. GAME LOOP
   --------------------------------------------------------------------- */
function fishingLoop(thisRunToken, lastTime) {
  if (thisRunToken !== fishingRunToken) return;
  const now = performance.now();
  const dtSec = Math.min(0.05, (now - lastTime) / 1000);

  if (fishingState) {
    fishingUpdatePhase(now, dtSec);
    fishingRender();
  }

  fishingAnimationId = requestAnimationFrame((t) => fishingLoop(thisRunToken, t));
}

function fishingUpdatePhase(now, dtSec) {
  const phase = fishingState.phase;

  if (phase === 'CASTING') {
    if (now - fishingState.phaseStartedAt >= FISHING_CONFIG.castDurationMs) {
      fishingBeginWaiting();
    }
  } else if (phase === 'WAITING') {
    if (now >= fishingState.biteAt) {
      fishingTriggerBite();
    } else if (now - fishingState.phaseStartedAt >= FISHING_CONFIG.longWaitDialogueMs) {
      fishingMaybeYap('longWait', 0.4);
    }
  } else if (phase === 'BITE') {
    if (now - fishingState.phaseStartedAt >= FISHING_CONFIG.biteReactionWindowMs) {
      fishingHandleBiteTimeout();
    }
  } else if (phase === 'FIGHTING') {
    const fight = fishingState.fight;
    updateFish(fight.fish, dtSec, now);
    updateTensionAndDistance(fight, dtSec, now, fishingState.isPressing);

    if (fight.tension >= FISHING_CONFIG.tensionDangerThreshold) {
      fishingMaybeYap('nearLineBreak', 0.3);
    }

    if (fight.tension >= FISHING_CONFIG.tensionBreakThreshold) {
      fishingResolveEscape('break');
    } else if (fight.distance <= FISHING_CONFIG.escapeThreshold) {
      fishingResolveEscape('fled');
    } else if (fight.distance >= FISHING_CONFIG.catchThreshold) {
      fishingResolveCatch();
    }
  }
}

/* ---------------------------------------------------------------------
   9. START / STOP
   --------------------------------------------------------------------- */
function fishingStartRun() {
  fishingRunToken++;
  const thisRunToken = fishingRunToken;

  fishingCanvas = document.getElementById('fishingCanvas');
  fishingCtx = fishingCanvas.getContext('2d');

  fishingState = fishingCreateFreshState();
  fishingPlayerModel = createFishingPlayerModel();
  fishingCatchCount = 0;
  fishingLastDialogueTime = 0;

  const aiBox = document.getElementById('fishingAiBox');
  if (aiBox) {
    aiBox.style.display = 'block';
    const textEl = document.getElementById('fishingAiText');
    if (textEl) textEl.textContent = Dialogue.pick(FISHING_DIALOGUE.intro, 'fishing.intro');
  }

  fishingUpdateHud();
  fishingUpdateOverlayForPhase();
  initFishingInput();

  if (fishingAnimationId) cancelAnimationFrame(fishingAnimationId);
  fishingAnimationId = requestAnimationFrame((t) => fishingLoop(thisRunToken, t));
}

/** Hub entry point. */
function startFishingGame() {
  showView('fishingView');
  fishingStartRun();
}

/* ---------------------------------------------------------------------
   10. INPUT WIRING (idempotent, follows the same isCanvasTarget pattern
   established for Game #12's overlay-button fix)
   --------------------------------------------------------------------- */
function initFishingInput() {
  const board = document.getElementById('fishingBoardContainer');
  if (!board || board.dataset.fishingInputBound === 'true') return;
  board.dataset.fishingInputBound = 'true';

  const isCanvasTarget = (e) => e.target === fishingCanvas;

  board.addEventListener('mousedown', (e) => {
    if (!isCanvasTarget(e)) return;
    fishingSetPressing(true);
  });
  window.addEventListener('mouseup', () => fishingSetPressing(false));

  board.addEventListener('touchstart', (e) => {
    if (!isCanvasTarget(e)) return;
    e.preventDefault();
    fishingSetPressing(true);
  }, { passive: false });
  board.addEventListener('touchend', (e) => {
    if (!isCanvasTarget(e)) return;
    e.preventDefault();
    fishingSetPressing(false);
  }, { passive: false });
  board.addEventListener('touchcancel', (e) => {
    if (!isCanvasTarget(e)) return;
    fishingSetPressing(false);
  });

  // Keyboard support (spec §5: desktop mouse/keyboard).
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); fishingSetPressing(true); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); fishingSetPressing(false); }
  });
}
