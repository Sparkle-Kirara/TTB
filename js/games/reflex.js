/* =====================================================================
   REFLEX.JS — Game #9: "Don't Trust the Signal" (adaptive reflex game)
   =====================================================================
   Core loop (spec section 1):
     signal appears -> player reacts or doesn't -> correct/wrong ->
     score + feedback -> AI reacts -> next signal

   This is a REAL-TIME game, unlike Games 6-8's turn-based reveal loops.
   Two things resolve a signal: the player tapping, or its window
   expiring. Only ONE of those may ever count -- see resolveSignal()
   and the `resolved` guard, which prevents the classic race where a
   stale expiry timer fires after a tap already resolved the round (the
   same class of bug flagged in the Snake AI training notes: stale async
   callbacks overwriting state need a guard, not just "clear the timer
   and hope").

   AIController (section 7) is intentionally simple and rule-based: it
   reads PlayerStats and nudges `fakeSignalChance` / `signalDuration`
   for the NEXT signal only. It never alters a signal after it's shown,
   never shortens time on an in-flight signal, and never reacts to input
   before the signal exists -- those are explicit fairness rules (spec
   section 7) enforced by construction: the AI only runs between rounds.
   ===================================================================== */

/** All tunable numbers live here (spec section 8) -- nothing else in this
    file should have a magic timing/probability constant. */
const REFLEX_CONFIG = {
  initialReactionWindow: 1600,  // ms the player has to react at run start
  minimumReactionWindow: 650,   // hard floor -- window never gets shorter than this
  signalGapMin: 550,            // ms of "nothing on screen" before the next signal
  signalGapMax: 950,
  fakeSignalChance: 0.0,        // starting chance a signal is fake (ramps up, see PHASES)
  fakeSignalChanceMax: 0.55,
  difficultyRampPerSignal: 18,  // ms shaved off the window per signal (before AI bias)
  countdownSteps: ['3', '2', '1', 'GO'],
  countdownStepMs: 500,
  fastReactionMs: 280,          // reacting faster than this counts as "too fast"
  scoreBonusFastMs: 400,        // reacting faster than this grants a small bonus
  streakMilestone: 6            // streak length that triggers the "long streak" yap
};

/** Phase thresholds by signal count (spec section 5). */
const REFLEX_PHASES = {
  learningEndsAt: 4,   // signals 0-3: no fakes at all
  fakesRampEndsAt: 12  // signals 4-11: fakes ramp in; 12+: full adaptive phase
};

let reflexState = null;
let reflexRunTokenCounter = 0;

function freshReflexState() {
  reflexRunTokenCounter += 1;
  return {
    status: 'READY', // 'READY' | 'COUNTDOWN' | 'PLAYING' | 'GAMEOVER'
    runToken: reflexRunTokenCounter, // invalidates any timer left over from a prior run
    signalSeq: 0,
    score: 0,
    signalIndex: 0,
    currentSignal: null, // { isFake, startTime, windowMs, resolved, timers }
    stats: {
      totalSignals: 0,
      correctReactions: 0,
      mistakes: 0,
      reactionTimes: [],
      fastestReaction: null,
      slowestReaction: null,
      earlyReactionCount: 0,
      lateReactionCount: 0,
      fakeSignalMistakes: 0,
      validSignalMisses: 0,
      currentStreak: 0,
      longestStreak: 0
    },
    lastMistakeSignalIndex: -100, // for detecting "several mistakes in a short span"
    recentMistakeCount: 0,
    timers: []
  };
}

function startReflexGame() {
  TTBAudio.playStart();
  showView('reflexView');
  reflexState = freshReflexState();
  showReflexOverlay('READY');
  updateReflexBestDisplay();
}

function startReflexRun() {
  TTBAudio.playStart();
  clearReflexTimers();
  reflexState = freshReflexState();
  reflexState.status = 'COUNTDOWN';
  showReflexOverlay('NONE');
  updateReflexHud();
  runReflexCountdown();
}

function showReflexOverlay(type) {
  document.getElementById('reflexOverlayReady').style.display = (type === 'READY') ? 'flex' : 'none';
  document.getElementById('reflexOverlayEnding').style.display = (type === 'ENDING') ? 'flex' : 'none';
  document.getElementById('reflexPlayArea').style.display = (type === 'NONE') ? 'flex' : 'none';
}

function clearReflexTimers() {
  reflexState && reflexState.timers.forEach(t => clearTimeout(t));
  if (reflexState) reflexState.timers = [];
}

function scheduleReflex(fn, ms) {
  const id = setTimeout(fn, ms);
  reflexState.timers.push(id);
  return id;
}

function runReflexCountdown() {
  const steps = REFLEX_CONFIG.countdownSteps;
  const runToken = reflexState.runToken;
  let i = 0;
  setReflexAiLine(pickReflexLine('countdown'));
  const zone = document.getElementById('reflexZone');
  zone.className = 'reflex-zone idle';

  function showStep() {
    if (reflexState.runToken !== runToken) return; // this run was restarted/discarded mid-countdown
    document.getElementById('reflexCountdownText').innerText = steps[i];
    document.getElementById('reflexCountdownOverlay').style.display = 'flex';
    i += 1;
    if (i < steps.length) {
      scheduleReflex(showStep, REFLEX_CONFIG.countdownStepMs);
    } else {
      scheduleReflex(() => {
        if (reflexState.runToken !== runToken) return;
        document.getElementById('reflexCountdownOverlay').style.display = 'none';
        reflexState.status = 'PLAYING';
        spawnNextReflexSignal();
      }, REFLEX_CONFIG.countdownStepMs);
    }
  }
  showStep();
}

/** Decides fake-signal probability and window duration for the NEXT signal only (spec section 7). Never touches an in-flight signal. */
function getAIControllerBias() {
  const s = reflexState.stats;
  const idx = reflexState.signalIndex;

  // Phase gating (spec section 5): no fakes during the learning phase,
  // then ramp fake chance in gradually.
  let fakeChance;
  if (idx < REFLEX_PHASES.learningEndsAt) {
    fakeChance = 0;
  } else if (idx < REFLEX_PHASES.fakesRampEndsAt) {
    const rampProgress = (idx - REFLEX_PHASES.learningEndsAt) / (REFLEX_PHASES.fakesRampEndsAt - REFLEX_PHASES.learningEndsAt);
    fakeChance = rampProgress * REFLEX_CONFIG.fakeSignalChanceMax * 0.6;
  } else {
    fakeChance = REFLEX_CONFIG.fakeSignalChanceMax * 0.6;

    // Adaptive nudges (spec section 7), only in the full adaptive phase:
    // impulsive players see more fakes; players who keep falling for
    // fakes see a (still fair, still full-window) fake more often too.
    const avgReaction = s.reactionTimes.length
      ? s.reactionTimes.reduce((a, b) => a + b, 0) / s.reactionTimes.length
      : REFLEX_CONFIG.initialReactionWindow;
    if (avgReaction < REFLEX_CONFIG.fastReactionMs * 1.5) {
      fakeChance = Math.min(REFLEX_CONFIG.fakeSignalChanceMax, fakeChance + 0.15);
    }
    if (s.fakeSignalMistakes >= 2) {
      fakeChance = Math.min(REFLEX_CONFIG.fakeSignalChanceMax, fakeChance + 0.1);
    }
  }

  // Base difficulty ramp, floored at the configured minimum -- the AI
  // can never push the window below this, keeping every signal winnable.
  const rampedWindow = REFLEX_CONFIG.initialReactionWindow - idx * REFLEX_CONFIG.difficultyRampPerSignal;
  let windowMs = Math.max(REFLEX_CONFIG.minimumReactionWindow, rampedWindow);

  // If the player tends to react slowly, occasionally tighten the window
  // a bit further (still respecting the floor) rather than only ever
  // making things easier for them.
  if (idx >= REFLEX_PHASES.fakesRampEndsAt && s.slowestReaction && s.slowestReaction > windowMs * 0.8) {
    windowMs = Math.max(REFLEX_CONFIG.minimumReactionWindow, windowMs - 100);
  }

  return { fakeChance, windowMs };
}

function spawnNextReflexSignal() {
  if (reflexState.status !== 'PLAYING') return;

  const gap = REFLEX_CONFIG.signalGapMin + Math.random() * (REFLEX_CONFIG.signalGapMax - REFLEX_CONFIG.signalGapMin);
  const zone = document.getElementById('reflexZone');
  zone.className = 'reflex-zone idle';
  document.getElementById('reflexSignalDot').style.display = 'none';

  // Capture which run this spawn belongs to so a stale timer from a
  // discarded/previous run can never act on a newer run's state -- see
  // the runToken check inside both scheduled callbacks below.
  const runToken = reflexState.runToken;

  scheduleReflex(() => {
    if (reflexState.status !== 'PLAYING' || reflexState.runToken !== runToken) return;
    const { fakeChance, windowMs } = getAIControllerBias();
    const isFake = Math.random() < fakeChance;

    const signal = {
      id: ++reflexState.signalSeq,
      isFake,
      startTime: performance.now(),
      windowMs,
      resolved: false
    };
    reflexState.currentSignal = signal;

    const dot = document.getElementById('reflexSignalDot');
    dot.style.display = 'flex';
    zone.className = isFake ? 'reflex-zone signal-fake' : 'reflex-zone signal-valid';
    dot.innerText = isFake ? '✖' : '●';

    // Capture this exact signal object (and its id) by closure, so this
    // timer can only ever resolve THIS signal -- never whatever object
    // happens to be sitting in reflexState.currentSignal by the time it
    // fires, which is what let a leftover timer from a previous/discarded
    // run race against and corrupt a brand new run's live signal.
    scheduleReflex(() => resolveReflexSignal('expired', signal, runToken), windowMs);
  }, gap);
}

/**
 * Fires on PRESS (pointerdown), not on release. This is the fix for the
 * hold-to-avoid-mistake exploit: previously the zone used a `click`
 * handler, and a browser's `click` event fires on pointer/touch UP, so a
 * player could press down on a real signal, hold through a fake signal
 * appearing, and only release after it vanished -- never registering a
 * reaction to either. Evaluating on pointerdown closes that gap: the
 * reaction is locked in the instant the player presses, before anything
 * else on screen can change.
 *
 * `eventTimeMs` is the timestamp of THIS press. A press is only eligible
 * to react to the currently active signal if it started at or after that
 * signal's own start time (pressStartTime >= signalStartTime) -- this
 * stops a press that began BEFORE a signal appeared (finger already down,
 * signal spawns underneath it) from being retroactively counted once the
 * signal shows up. Without this, holding down through the gap between
 * signals would let a stale press "catch" the next signal for free.
 */
function handleReflexPress(eventTimeMs) {
  if (reflexState.status !== 'PLAYING' || !reflexState.currentSignal) return;
  const signal = reflexState.currentSignal;
  if (eventTimeMs < signal.startTime) return; // press predates this signal -- not eligible
  resolveReflexSignal('tapped', signal, reflexState.runToken);
}

/** Wires the zone's press input once. pointerdown covers mouse, touch, and
    pen uniformly (no separate touchstart/mousedown listeners needed), and
    firing on down rather than the browser's synthesized click/up event is
    what makes reaction timing correct -- see handleReflexPress above. */
function initReflexInput() {
  const zone = document.getElementById('reflexZone');
  if (!zone || zone.dataset.reflexInputBound) return; // idempotent -- only bind once
  zone.dataset.reflexInputBound = 'true';

  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // stop the browser from also firing a delayed synthetic click/touch event
    handleReflexPress(performance.now());
  });
}

/**
 * Single resolution point for a signal, whether triggered by a tap or by
 * its window expiring. Two independent guards keep this safe:
 *   1. `runToken` must match the CURRENT run -- a timer left over from a
 *      run that was restarted/discarded before it fired is rejected
 *      outright, even if a new run's signal now occupies currentSignal.
 *   2. `signal.resolved` ensures only the first of tap-vs-expiry for
 *      THIS specific signal ever counts.
 * Both the tap handler and the expiry timer pass in the exact signal
 * object (and run token) they were scheduled/invoked for, rather than
 * this function re-reading whatever reflexState.currentSignal is "right
 * now" -- that re-read was the actual bug: a stale expiry timer from a
 * discarded run would resolve whatever NEW signal had since been spawned.
 */
function resolveReflexSignal(cause, signal, runToken) {
  if (!signal || signal.resolved) return;
  if (runToken !== reflexState.runToken) return; // stale call from a previous/discarded run
  if (reflexState.currentSignal !== signal) return; // this exact signal is no longer the live one
  signal.resolved = true;

  const reactionMs = performance.now() - signal.startTime;
  reflexState.stats.totalSignals += 1;
  reflexState.signalIndex += 1;

  let outcome; // 'correct' | 'wrongTap' | 'missed'
  if (signal.isFake) {
    outcome = (cause === 'tapped') ? 'wrongTap' : 'correct';
  } else {
    outcome = (cause === 'tapped') ? 'correct' : 'missed';
  }

  if (outcome === 'correct') {
    handleReflexSuccess(signal, reactionMs, cause);
  } else {
    handleReflexFailure(signal, outcome, reactionMs);
  }
}

function handleReflexSuccess(signal, reactionMs, cause) {
  const s = reflexState.stats;
  TTBAudio.playSelect();

  // Only real (non-fake) taps have a meaningful reaction time to log.
  if (!signal.isFake && cause === 'tapped') {
    s.reactionTimes.push(reactionMs);
    s.fastestReaction = (s.fastestReaction === null) ? reactionMs : Math.min(s.fastestReaction, reactionMs);
    s.slowestReaction = (s.slowestReaction === null) ? reactionMs : Math.max(s.slowestReaction, reactionMs);
    if (reactionMs < REFLEX_CONFIG.fastReactionMs) s.earlyReactionCount += 1;
    if (reactionMs > signal.windowMs * 0.75) s.lateReactionCount += 1;
  }

  s.correctReactions += 1;
  s.currentStreak += 1;
  s.longestStreak = Math.max(s.longestStreak, s.currentStreak);

  const basePoints = 1;
  const bonus = (!signal.isFake && reactionMs < REFLEX_CONFIG.scoreBonusFastMs) ? 1 : 0;
  reflexState.score += basePoints + bonus;

  showReflexFeedback(true, signal.isFake);
  updateReflexHud();

  let line = null;
  if (!signal.isFake && cause === 'tapped' && reactionMs < REFLEX_CONFIG.fastReactionMs) {
    line = pickReflexLine('tooFast');
  } else if (!signal.isFake && cause === 'tapped' && s.reactionTimes.length >= 3) {
    const avg = s.reactionTimes.slice(0, -1).reduce((a, b) => a + b, 0) / (s.reactionTimes.length - 1);
    if (reactionMs > avg * 1.6) line = pickReflexLine('tooSlow');
  }
  if (!line && s.currentStreak > 0 && s.currentStreak % REFLEX_CONFIG.streakMilestone === 0) {
    line = pickReflexLine('longStreak');
  }
  if (line) setReflexAiLine(line);

  reflexState.currentSignal = null;
  scheduleReflex(spawnNextReflexSignal, 250);
}

function handleReflexFailure(signal, outcome, reactionMs) {
  const s = reflexState.stats;
  TTBAudio.playUI();

  s.mistakes += 1;
  s.currentStreak = 0;
  if (outcome === 'wrongTap') s.fakeSignalMistakes += 1;
  if (outcome === 'missed') s.validSignalMisses += 1;

  reflexState.recentMistakeCount = (reflexState.signalIndex - reflexState.lastMistakeSignalIndex <= 3)
    ? reflexState.recentMistakeCount + 1 : 1;
  reflexState.lastMistakeSignalIndex = reflexState.signalIndex;

  showReflexFeedback(false, signal.isFake);
  updateReflexHud();

  let line = (outcome === 'wrongTap') ? pickReflexLine('fellForFake') : pickReflexLine('missedValid');
  if (reflexState.recentMistakeCount >= 2) line = pickReflexLine('repeatMistakes');
  else if (outcome === 'wrongTap' && s.fakeSignalMistakes >= 2) line += ' ' + pickReflexLine('exploitedHabit');
  setReflexAiLine(line);

  reflexState.currentSignal = null;
  reflexState.status = 'GAMEOVER';
  scheduleReflex(finishReflexRun, 900);
}

function showReflexFeedback(isSuccess, wasFake) {
  const zone = document.getElementById('reflexZone');
  zone.classList.add(isSuccess ? 'feedback-hit' : 'feedback-miss');
  scheduleReflex(() => zone.classList.remove('feedback-hit', 'feedback-miss'), 260);
  document.getElementById('reflexSignalDot').style.display = 'none';
}

function updateReflexHud() {
  document.getElementById('reflexScore').innerText = reflexState.score;
  document.getElementById('reflexStreak').innerText = `🔥 ${reflexState.stats.currentStreak}`;
}

function setReflexAiLine(text) {
  const aiBox = document.getElementById('reflexAiBox');
  const aiText = document.getElementById('reflexAiText');
  if (!text) {
    aiBox.style.display = 'none';
    return;
  }
  aiBox.style.display = 'flex';
  aiText.innerText = `"${text}"`;
}

function pickReflexLine(poolKey) {
  const pool = REFLEX_DIALOGUE[poolKey];
  if (!pool || pool.length === 0) return '';
  if (typeof Dialogue !== 'undefined' && Dialogue.pick) {
    return Dialogue.pick(pool, 'reflex_' + poolKey);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

const REFLEX_BEST_KEY = 'ttb_reflex_best';

function getReflexBest() {
  const raw = localStorage.getItem(REFLEX_BEST_KEY);
  const parsed = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function updateReflexBestDisplay() {
  document.getElementById('reflexBestReady').innerText = `Best: ${getReflexBest()}`;
}

function finishReflexRun() {
  TTBAudio.playGameOver();

  const best = getReflexBest();
  const isNewBest = reflexState.score > best;
  if (isNewBest) localStorage.setItem(REFLEX_BEST_KEY, String(reflexState.score));
  const displayBest = isNewBest ? reflexState.score : best;

  const s = reflexState.stats;
  const avgReaction = s.reactionTimes.length
    ? Math.round(s.reactionTimes.reduce((a, b) => a + b, 0) / s.reactionTimes.length)
    : 0;

  let closing;
  if (isNewBest) closing = REFLEX_ENDINGS.newBest;
  else if (best === 0) closing = REFLEX_ENDINGS.first.replace('{score}', reflexState.score);
  else closing = REFLEX_ENDINGS.normal.replace('{score}', reflexState.score).replace('{best}', displayBest);

  document.getElementById('reflexEndingText').innerText = closing;
  document.getElementById('reflexFinalScore').innerText = reflexState.score;
  document.getElementById('reflexFinalBest').innerText = displayBest;
  document.getElementById('reflexFinalReaction').innerText = avgReaction ? `${avgReaction} ms` : '—';

  showReflexOverlay('ENDING');
}

// Bind press input once, at script load -- #reflexZone already exists in
// the DOM by this point since scripts load at the end of <body>.
initReflexInput();
