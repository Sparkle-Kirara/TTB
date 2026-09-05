/* =====================================================================
   HOT-OR-NOT.JS — Game #8: "Hot or Not" (prediction + AI trust game)
   =====================================================================
   Core loop (spec section: CORE CONCEPT):
     SHOW OPTIONS -> AI OPINION -> PLAYER PREDICTS -> REVEAL VALUES ->
     SCORE -> AI REACTION -> NEXT ROUND

   Rounds are generated procedurally: a small pool of emoji/label options
   is sampled per round, each given a random hidden value inside a
   level-defined gap (wide gap = obvious at low levels, narrow gap =
   hard at high levels). The AI's opinion is picked with a CONTROLLED
   probability of matching the true-best option (spec section 5) -- not
   always right, not random -- and that probability decays slightly by
   level (spec section 9: "AI becomes less reliable").

   This file owns "what happened" (values, correctness, AI accuracy).
   GAME8_DIALOGUE (js/dialogue/game8-dialogue.js) owns "what the AI says
   about it".
   ===================================================================== */

const HOTORNOT_ITEMS = [
  { emoji: '🐱', label: 'Cat' }, { emoji: '🐶', label: 'Dog' }, { emoji: '🐰', label: 'Rabbit' },
  { emoji: '🍕', label: 'Pizza' }, { emoji: '🍔', label: 'Burger' }, { emoji: '🌮', label: 'Taco' },
  { emoji: '🎸', label: 'Guitar' }, { emoji: '🎹', label: 'Piano' }, { emoji: '🥁', label: 'Drums' },
  { emoji: '⚽', label: 'Soccer' }, { emoji: '🏀', label: 'Basketball' }, { emoji: '🎾', label: 'Tennis' },
  { emoji: '🌊', label: 'Ocean' }, { emoji: '🏔️', label: 'Mountain' }, { emoji: '🌲', label: 'Forest' },
  { emoji: '☕', label: 'Coffee' }, { emoji: '🍵', label: 'Tea' }, { emoji: '🥤', label: 'Soda' }
];

/** Level configs (spec section 9). Levels beyond this list reuse the last one. */
const HOTORNOT_LEVELS = [
  { optionCount: 2, valueGap: 30, aiAccuracy: 0.85 },
  { optionCount: 2, valueGap: 18, aiAccuracy: 0.75 },
  { optionCount: 3, valueGap: 22, aiAccuracy: 0.70 },
  { optionCount: 3, valueGap: 14, aiAccuracy: 0.65 },
  { optionCount: 4, valueGap: 16, aiAccuracy: 0.60 },
  { optionCount: 4, valueGap: 10, aiAccuracy: 0.55 }
];

const HOTORNOT_MAX_LIVES = 3;

let hotOrNotState = null;

function freshHotOrNotState() {
  return {
    status: 'READY', // 'READY' | 'PREDICTING' | 'REVEALED' | 'ENDED'
    round: 0,
    score: 0,
    lives: HOTORNOT_MAX_LIVES,
    streak: 0,
    followCount: 0,
    ignoreCount: 0,
    currentRound: null, // { options: [{emoji,label,value}], aiPickIndex, aiLine }
    timers: []
  };
}

function startHotOrNotGame() {
  TTBAudio.playStart();
  showView('hotOrNotView');
  hotOrNotState = freshHotOrNotState();
  showHotOrNotOverlay('READY');
}

function startHotOrNotRun() {
  TTBAudio.playStart();
  clearHotOrNotTimers();
  hotOrNotState = freshHotOrNotState();
  hotOrNotState.status = 'PREDICTING';
  showHotOrNotOverlay('NONE');
  updateHotOrNotHud();
  nextHotOrNotRound();
}

function showHotOrNotOverlay(type) {
  document.getElementById('hotOrNotOverlayReady').style.display = (type === 'READY') ? 'flex' : 'none';
  document.getElementById('hotOrNotOverlayEnding').style.display = (type === 'ENDING') ? 'flex' : 'none';
  document.getElementById('hotOrNotPlayArea').style.display = (type === 'NONE') ? 'block' : 'none';
}

function clearHotOrNotTimers() {
  hotOrNotState && hotOrNotState.timers.forEach(t => clearTimeout(t));
  if (hotOrNotState) hotOrNotState.timers = [];
}

function scheduleHotOrNot(fn, ms) {
  const id = setTimeout(fn, ms);
  hotOrNotState.timers.push(id);
  return id;
}

function getHotOrNotLevelConfig() {
  const idx = Math.min(hotOrNotState.round, HOTORNOT_LEVELS.length - 1);
  return HOTORNOT_LEVELS[idx];
}

/** Picks N distinct items and assigns each a random value inside the level's gap, around a random center. */
function generateHotOrNotOptions(config) {
  const pool = [...HOTORNOT_ITEMS];
  shuffleHotOrNot(pool);
  const chosenItems = pool.slice(0, config.optionCount);

  const center = 50 + Math.floor(Math.random() * 30); // keep values in a readable ~20-99 range
  const options = chosenItems.map(item => ({
    emoji: item.emoji,
    label: item.label,
    value: 0 // filled below
  }));

  // Assign values with at least `valueGap` spread between best and worst,
  // but with randomized ordering so the best option isn't always first.
  const spread = config.valueGap + Math.floor(Math.random() * 15);
  const step = spread / (options.length - 1 || 1);
  const values = options.map((_, i) => Math.round(center - spread / 2 + i * step + (Math.random() * 6 - 3)));
  shuffleHotOrNot(values);
  options.forEach((opt, i) => { opt.value = Math.max(1, Math.min(99, values[i])); });

  return options;
}

/**
 * Decides the AI's pick with a controlled probability of being correct
 * (spec section 5): `config.aiAccuracy` chance it picks the TRUE best
 * option, otherwise it picks a plausible near-miss (the second-best, or
 * a random other option if only 2 exist) so its errors feel like
 * reasonable misjudgments rather than random noise.
 */
function rollAiPick(options, config) {
  const sortedIndexes = options
    .map((opt, i) => i)
    .sort((a, b) => options[b].value - options[a].value);
  const bestIndex = sortedIndexes[0];

  const aiIsCorrect = Math.random() < config.aiAccuracy;
  const pickIndex = aiIsCorrect
    ? bestIndex
    : (sortedIndexes[1] !== undefined ? sortedIndexes[1] : bestIndex);

  return { pickIndex, aiIsCorrect };
}

function pickAiOpinionLine(aiIsCorrect, config) {
  // Confidence tier is cosmetic flavor, weighted so confident lines lean
  // (but aren't guaranteed) correct -- keeps "confident AI" meaningful
  // without making tone a perfect tell for correctness.
  const roll = Math.random();
  let tierKey;
  if (roll < 0.4) tierKey = 'opinionConfident';
  else if (roll < 0.75) tierKey = 'opinionUncertain';
  else tierKey = 'opinionVague';
  return pickHotOrNotLine(tierKey);
}

function nextHotOrNotRound() {
  const config = getHotOrNotLevelConfig();
  const options = generateHotOrNotOptions(config);
  const { pickIndex, aiIsCorrect } = rollAiPick(options, config);
  const aiLine = pickAiOpinionLine(aiIsCorrect, config);

  hotOrNotState.currentRound = { options, aiPickIndex: pickIndex, aiIsCorrect };
  hotOrNotState.status = 'PREDICTING';

  document.getElementById('hotOrNotRoundBadge').innerText = `Round ${hotOrNotState.round + 1}`;
  setHotOrNotAiLine(aiLine);
  renderHotOrNotOptions(options, null, pickIndex);
}

function renderHotOrNotOptions(options, revealedIndex, aiPickIndex) {
  const grid = document.getElementById('hotOrNotGrid');
  grid.innerHTML = '';
  options.forEach((opt, i) => {
    const card = document.createElement('button');
    card.className = 'hotornot-card';
    if (revealedIndex !== null) card.classList.add('revealed');
    if (i === aiPickIndex) card.classList.add('ai-pick');

    const emojiEl = document.createElement('div');
    emojiEl.className = 'hotornot-emoji';
    emojiEl.innerText = opt.emoji;

    const labelEl = document.createElement('div');
    labelEl.className = 'hotornot-label';
    labelEl.innerText = opt.label;

    card.appendChild(emojiEl);
    card.appendChild(labelEl);

    if (i === aiPickIndex) {
      const tag = document.createElement('div');
      tag.className = 'hotornot-ai-tag';
      tag.innerText = '🤖';
      card.appendChild(tag);
    }

    if (revealedIndex !== null) {
      const valueEl = document.createElement('div');
      valueEl.className = 'hotornot-value';
      valueEl.innerText = opt.value;
      card.appendChild(valueEl);
      if (i === revealedIndex) card.classList.add('picked');
    } else {
      card.onclick = () => handleHotOrNotPrediction(i);
    }

    grid.appendChild(card);
  });
}

function handleHotOrNotPrediction(chosenIndex) {
  if (hotOrNotState.status !== 'PREDICTING') return;
  hotOrNotState.status = 'REVEALED';

  const round = hotOrNotState.currentRound;
  const bestIndex = round.options.reduce((bestI, opt, i, arr) => opt.value > arr[bestI].value ? i : bestI, 0);
  const isCorrect = chosenIndex === bestIndex;
  const followedAi = chosenIndex === round.aiPickIndex;

  renderHotOrNotOptions(round.options, chosenIndex, round.aiPickIndex);

  if (followedAi) hotOrNotState.followCount += 1;
  else hotOrNotState.ignoreCount += 1;

  let reactionKey;
  if (isCorrect && followedAi) reactionKey = 'correctFollowed';
  else if (isCorrect && !followedAi) reactionKey = 'correctIgnored';
  else if (!isCorrect && followedAi) reactionKey = 'wrongFollowed';
  else reactionKey = 'wrongIgnored';

  let line = pickHotOrNotLine(reactionKey);

  const totalRounds = hotOrNotState.followCount + hotOrNotState.ignoreCount;
  if (totalRounds >= 4 && hotOrNotState.ignoreCount === 0) {
    line += ' ' + pickHotOrNotLine('alwaysFollowsAi');
  } else if (totalRounds >= 4 && hotOrNotState.followCount === 0) {
    line += ' ' + pickHotOrNotLine('alwaysIgnoresAi');
  }

  if (isCorrect) {
    TTBAudio.playSelect();
    hotOrNotState.streak += 1;
    if (hotOrNotState.streak > 0 && hotOrNotState.streak % 3 === 0) line += ' ' + pickHotOrNotLine('streak');
    const points = 10 + getHotOrNotLevelConfig().optionCount * 5 + hotOrNotState.streak * 2;
    hotOrNotState.score += points;
    hotOrNotState.round += 1;
  } else {
    TTBAudio.playUI();
    hotOrNotState.streak = 0;
    hotOrNotState.lives -= 1;
  }

  setHotOrNotAiLine(line);
  updateHotOrNotHud();

  scheduleHotOrNot(() => {
    if (hotOrNotState.lives <= 0) {
      finishHotOrNotRun();
    } else {
      setHotOrNotAiLine(pickHotOrNotLine('levelStart'));
      scheduleHotOrNot(nextHotOrNotRound, 500);
    }
  }, 1600);
}

function updateHotOrNotHud() {
  document.getElementById('hotOrNotScore').innerText = hotOrNotState.score;
  document.getElementById('hotOrNotLives').innerText =
    '❤️'.repeat(Math.max(hotOrNotState.lives, 0)) + '🖤'.repeat(HOTORNOT_MAX_LIVES - Math.max(hotOrNotState.lives, 0));
}

function setHotOrNotAiLine(text) {
  const aiBox = document.getElementById('hotOrNotAiBox');
  const aiText = document.getElementById('hotOrNotAiText');
  if (!text) {
    aiBox.style.display = 'none';
    return;
  }
  aiBox.style.display = 'flex';
  aiText.innerText = `"${text}"`;
}

/** Uses the shared Dialogue.pick utility when available (anti-repetition), falls back to plain random otherwise. */
function pickHotOrNotLine(poolKey) {
  const pool = GAME8_DIALOGUE[poolKey];
  if (!pool || pool.length === 0) return '';
  if (typeof Dialogue !== 'undefined' && Dialogue.pick) {
    return Dialogue.pick(pool, 'game8_' + poolKey);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function finishHotOrNotRun() {
  hotOrNotState.status = 'ENDED';
  TTBAudio.playGameOver();

  const tier = hotOrNotState.score >= 300 ? 'high' : (hotOrNotState.score >= 120 ? 'mid' : 'low');
  const ending = GAME8_ENDINGS[tier];

  document.getElementById('hotOrNotEndingTitle').innerText = ending.title;
  document.getElementById('hotOrNotEndingText').innerText =
    ending.closingLines.replace('{score}', hotOrNotState.score);
  document.getElementById('hotOrNotFinalScore').innerText = `Score: ${hotOrNotState.score}`;

  showHotOrNotOverlay('ENDING');
}

function shuffleHotOrNot(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
