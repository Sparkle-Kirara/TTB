/* =====================================================================
   DONT-BLINK.JS — Game #7: "Don't Blink" (observation + reaction game)
   =====================================================================
   Core loop (spec section 1):
     OBSERVE -> MEMORIZE -> HIDE/CHANGE -> IDENTIFY -> AI REACTION -> NEXT

   Rounds are generated procedurally from a small symbol pool + a level
   config (count of objects, change type, timing) rather than hand-
   authored, so there's no fixed list of rounds to run out of (spec
   implies replayability). This file owns "what happened"; GAME7_DIALOGUE
   (js/dialogue/game7-dialogue.js) owns "what the AI says about it".
   ===================================================================== */

const DONTBLINK_SYMBOLS = ['🔴', '🔵', '🟢', '⭐', '🟣', '🟡', '⬛', '🔺'];

/** Level configs (spec section 3). Levels beyond this list reuse the last one. */
const DONTBLINK_LEVELS = [
  { objectCount: 3, changeTypes: ['identity', 'disappear'],            observeMs: 3000, distraction: false },
  { objectCount: 4, changeTypes: ['identity', 'disappear', 'appear'],  observeMs: 2600, distraction: false },
  { objectCount: 5, changeTypes: ['identity', 'disappear', 'appear'],  observeMs: 2400, distraction: false },
  { objectCount: 5, changeTypes: ['position', 'identity', 'appear'],   observeMs: 2200, distraction: false },
  { objectCount: 6, changeTypes: ['position', 'identity', 'disappear'], observeMs: 1800, distraction: false },
  { objectCount: 6, changeTypes: ['position', 'identity', 'appear', 'disappear'], observeMs: 1500, distraction: true }
];

const DONTBLINK_MAX_LIVES = 3;

let dontBlinkState = null;

function freshDontBlinkState() {
  return {
    status: 'READY', // 'READY' | 'OBSERVE' | 'HIDDEN' | 'ANSWERING' | 'ENDED'
    round: 0,
    score: 0,
    lives: DONTBLINK_MAX_LIVES,
    streak: 0,
    mistakesInARow: 0,
    roundStartTime: 0,
    currentRound: null,   // { before: [...], after: [...], changeDescription, correctIndex, choices }
    timers: []
  };
}

function startDontBlinkGame() {
  TTBAudio.playStart();
  showView('dontBlinkView');
  dontBlinkState = freshDontBlinkState();
  showDontBlinkOverlay('READY');
}

function startDontBlinkRun() {
  TTBAudio.playStart();
  clearDontBlinkTimers();
  dontBlinkState = freshDontBlinkState();
  dontBlinkState.status = 'OBSERVE';
  showDontBlinkOverlay('NONE');
  updateDontBlinkHud();
  nextDontBlinkRound();
}

function showDontBlinkOverlay(type) {
  document.getElementById('dontBlinkOverlayReady').style.display = (type === 'READY') ? 'flex' : 'none';
  document.getElementById('dontBlinkOverlayEnding').style.display = (type === 'ENDING') ? 'flex' : 'none';
  document.getElementById('dontBlinkPlayArea').style.display = (type === 'NONE') ? 'block' : 'none';
}

function clearDontBlinkTimers() {
  dontBlinkState && dontBlinkState.timers.forEach(t => clearTimeout(t));
  if (dontBlinkState) dontBlinkState.timers = [];
}

function scheduleDontBlink(fn, ms) {
  const id = setTimeout(fn, ms);
  dontBlinkState.timers.push(id);
  return id;
}

function getDontBlinkLevelConfig() {
  const idx = Math.min(dontBlinkState.round, DONTBLINK_LEVELS.length - 1);
  return DONTBLINK_LEVELS[idx];
}

/** Builds a fresh round: picks symbols, applies exactly one change, builds the 4 answer choices. */
function generateDontBlinkRound(config) {
  const pool = [...DONTBLINK_SYMBOLS];
  shuffleArray(pool);
  const before = pool.slice(0, config.objectCount);

  const changeType = config.changeTypes[Math.floor(Math.random() * config.changeTypes.length)];
  const after = [...before];
  let changeDescription = '';
  let changedIndex = -1;

  if (changeType === 'identity') {
    changedIndex = Math.floor(Math.random() * after.length);
    const unused = DONTBLINK_SYMBOLS.filter(s => !before.includes(s));
    const replacement = unused.length ? unused[Math.floor(Math.random() * unused.length)] : pool[config.objectCount];
    after[changedIndex] = replacement;
    changeDescription = `${before[changedIndex]} became ${replacement}`;

  } else if (changeType === 'disappear') {
    changedIndex = Math.floor(Math.random() * after.length);
    changeDescription = `${before[changedIndex]} disappeared`;
    after[changedIndex] = null; // rendered as an empty slot

  } else if (changeType === 'appear') {
    const unused = DONTBLINK_SYMBOLS.filter(s => !before.includes(s));
    const newSymbol = unused.length ? unused[Math.floor(Math.random() * unused.length)] : pool[config.objectCount];
    after.push(newSymbol);
    before.push(null); // keep arrays aligned; empty slot in the "before" view
    changeDescription = `${newSymbol} appeared`;

  } else if (changeType === 'position') {
    let i = Math.floor(Math.random() * after.length);
    let j = Math.floor(Math.random() * after.length);
    while (j === i) j = Math.floor(Math.random() * after.length);
    [after[i], after[j]] = [after[j], after[i]];
    changeDescription = `${before[i]} and ${before[j]} swapped`;
  }

  const choices = buildDontBlinkChoices(before, changeType, changeDescription);

  return { before, after, changeType, changeDescription, choices };
}

/** Builds 4 answer options: the correct one plus 3 plausible wrong ones, shuffled. */
function buildDontBlinkChoices(before, correctType, correctDescription) {
  const distractors = [];
  const liveSymbols = before.filter(s => s !== null);

  // A distractor for each OTHER change type, using symbols actually on screen
  // so wrong answers still look plausible rather than nonsensical.
  if (correctType !== 'position' && liveSymbols.length >= 2) {
    const a = liveSymbols[0], b = liveSymbols[1];
    distractors.push(`${a} and ${b} swapped`);
  }
  if (correctType !== 'identity' && liveSymbols.length >= 1) {
    distractors.push(`${liveSymbols[0]} became something else`);
  }
  if (correctType !== 'disappear' && liveSymbols.length >= 1) {
    distractors.push(`${liveSymbols[liveSymbols.length - 1]} disappeared`);
  }
  distractors.push('Nothing changed');

  // De-dupe (unlikely but possible with small object counts) and trim to 3.
  const uniqueDistractors = [...new Set(distractors)].filter(d => d !== correctDescription).slice(0, 3);
  const options = shuffleArray([correctDescription, ...uniqueDistractors]);
  return options;
}

function nextDontBlinkRound() {
  const config = getDontBlinkLevelConfig();
  dontBlinkState.currentRound = generateDontBlinkRound(config);
  dontBlinkState.status = 'OBSERVE';

  document.getElementById('dontBlinkRoundBadge').innerText = `Round ${dontBlinkState.round + 1}`;
  setDontBlinkAiLine(pickDontBlinkLine('observe'));
  renderDontBlinkGrid(dontBlinkState.currentRound.before, false);
  hideDontBlinkChoices();

  let distractionFired = false;
  if (config.distraction && Math.random() < 0.5) {
    distractionFired = true;
    scheduleDontBlink(() => setDontBlinkAiLine(pickDontBlinkLine('distractionBait')), Math.floor(config.observeMs * 0.4));
  }

  scheduleDontBlink(() => {
    if (distractionFired) setDontBlinkAiLine(pickDontBlinkLine('distractionDismiss'));
    hideDontBlinkGrid();
  }, config.observeMs);
}

function hideDontBlinkGrid() {
  if (dontBlinkState.status !== 'OBSERVE') return;
  dontBlinkState.status = 'HIDDEN';
  renderDontBlinkGrid(null, true);

  scheduleDontBlink(() => {
    dontBlinkState.status = 'ANSWERING';
    dontBlinkState.roundStartTime = Date.now();
    renderDontBlinkGrid(dontBlinkState.currentRound.after, false);
    showDontBlinkChoices(dontBlinkState.currentRound.choices);
  }, 500);
}

function renderDontBlinkGrid(symbols, hidden) {
  const grid = document.getElementById('dontBlinkGrid');
  grid.innerHTML = '';
  if (hidden) {
    const slot = document.createElement('div');
    slot.className = 'dontblink-hidden-slot';
    slot.innerText = '❓';
    grid.appendChild(slot);
    return;
  }
  symbols.forEach(sym => {
    const slot = document.createElement('div');
    slot.className = 'dontblink-slot';
    slot.innerText = sym || '';
    grid.appendChild(slot);
  });
}

function showDontBlinkChoices(choices) {
  const section = document.getElementById('dontBlinkChoices');
  section.style.display = 'grid';
  section.innerHTML = '';
  choices.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'dontblink-choice-btn';
    btn.innerText = choice;
    btn.onclick = () => handleDontBlinkAnswer(choice);
    section.appendChild(btn);
  });
}

function hideDontBlinkChoices() {
  const section = document.getElementById('dontBlinkChoices');
  section.style.display = 'none';
  section.innerHTML = '';
}

function handleDontBlinkAnswer(chosenText) {
  if (dontBlinkState.status !== 'ANSWERING') return;
  dontBlinkState.status = 'REVEAL';

  const decisionMs = Date.now() - dontBlinkState.roundStartTime;
  const isCorrect = chosenText === dontBlinkState.currentRound.changeDescription;
  hideDontBlinkChoices();

  if (isCorrect) {
    TTBAudio.playSelect();
    dontBlinkState.streak += 1;
    dontBlinkState.mistakesInARow = 0;
    const points = 10 + getDontBlinkLevelConfig().objectCount * 2;
    dontBlinkState.score += points;

    let line = pickDontBlinkLine('correct');
    if (decisionMs < 1200) line += ' ' + pickDontBlinkLine('fastCorrect');
    else if (decisionMs > 5000) line += ' ' + pickDontBlinkLine('slowCorrect');
    else if (dontBlinkState.streak > 0 && dontBlinkState.streak % 3 === 0) line += ' ' + pickDontBlinkLine('streak');
    setDontBlinkAiLine(line);

    dontBlinkState.round += 1;
  } else {
    TTBAudio.playUI();
    dontBlinkState.streak = 0;
    dontBlinkState.mistakesInARow += 1;
    dontBlinkState.lives -= 1;

    let line = pickDontBlinkLine('wrong');
    if (decisionMs < 900) line += ' ' + pickDontBlinkLine('fastWrong');
    else if (dontBlinkState.mistakesInARow >= 2) line += ' ' + pickDontBlinkLine('repeatMistakes');
    setDontBlinkAiLine(line);
  }

  updateDontBlinkHud();

  scheduleDontBlink(() => {
    if (dontBlinkState.lives <= 0) {
      finishDontBlinkRun();
    } else {
      setDontBlinkAiLine(pickDontBlinkLine('levelStart'));
      scheduleDontBlink(nextDontBlinkRound, 500);
    }
  }, 1100);
}

function updateDontBlinkHud() {
  document.getElementById('dontBlinkScore').innerText = dontBlinkState.score;
  document.getElementById('dontBlinkLives').innerText = '❤️'.repeat(Math.max(dontBlinkState.lives, 0)) + '🖤'.repeat(DONTBLINK_MAX_LIVES - Math.max(dontBlinkState.lives, 0));
}

function setDontBlinkAiLine(text) {
  const aiBox = document.getElementById('dontBlinkAiBox');
  const aiText = document.getElementById('dontBlinkAiText');
  if (!text) {
    aiBox.style.display = 'none';
    return;
  }
  aiBox.style.display = 'flex';
  aiText.innerText = `"${text}"`;
}

/** Uses the shared Dialogue.pick utility when available (anti-repetition), falls back to plain random otherwise. */
function pickDontBlinkLine(poolKey) {
  const pool = GAME7_DIALOGUE[poolKey];
  if (!pool || pool.length === 0) return '';
  if (typeof Dialogue !== 'undefined' && Dialogue.pick) {
    return Dialogue.pick(pool, 'game7_' + poolKey);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function finishDontBlinkRun() {
  dontBlinkState.status = 'ENDED';
  TTBAudio.playGameOver();

  const tier = dontBlinkState.round >= 8 ? 'high' : (dontBlinkState.round >= 4 ? 'mid' : 'low');
  const ending = GAME7_ENDINGS[tier];

  document.getElementById('dontBlinkEndingTitle').innerText = ending.title;
  document.getElementById('dontBlinkEndingText').innerText =
    ending.closingLines.replace('{round}', dontBlinkState.round + 1);
  document.getElementById('dontBlinkFinalScore').innerText = `Score: ${dontBlinkState.score}`;

  showDontBlinkOverlay('ENDING');
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
