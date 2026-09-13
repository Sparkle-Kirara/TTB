/* =====================================================================
   WAKE-UP.JS — Game #6: "Wake Up" (AI-hinted reasoning door-puzzle)
   =====================================================================
   This file only knows how to walk WAKEUP_LEVELS (js/dialogue/wake-up-
   dialogue.js) and score the run. It contains no puzzle text or AI
   lines of its own -- all content lives in the dialogue file.

   CORE LOOP (per spec):
     situation -> AI hint -> doors shown -> player picks -> door opens ->
     AI reacts -> next situation (or ending)

   State tracked (lightweight, spec section 8 -- no narrative engine):
     - levelIndex, mistakesThisLevel (drives which hint tier is shown)
     - correctCount / wrongCount (drives the final "clean vs messy" ending)
     - streak (drives "on a roll" yaps) + best streak this run
     - choiceStartTime (drives fast/slow yaps)
     - doorHistory (emoji picked at each correct step, drives "repeated
       symbol" yap and the trusted/ignored-AI ending split)
   ===================================================================== */

let wakeUpState = null;

function freshWakeUpState() {
  return {
    status: 'READY', // 'READY' | 'PLAYING' | 'ENDED'
    levelIndex: 0,
    mistakesThisLevel: 0,
    correctCount: 0,
    wrongCount: 0,
    streak: 0,
    bestStreak: 0,
    choiceStartTime: 0,
    doorHistory: [],       // emoji of every door actually opened (correct or not)
    hintsUsedCount: 0,     // number of distinct hint-tier escalations across the run
    lastHintTierShown: 0   // tracks tier per current level so repeats on the same tier don't double-count
  };
}

function startWakeUpGame() {
  TTBAudio.playStart();
  showView('wakeUpView');
  wakeUpState = freshWakeUpState();
  showWakeUpOverlay('READY');
}

function startWakeUpStory() {
  TTBAudio.playStart();
  wakeUpState = freshWakeUpState();
  wakeUpState.status = 'PLAYING';
  showWakeUpOverlay('NONE');
  renderWakeUpLevel();
}

function showWakeUpOverlay(type) {
  document.getElementById('wakeUpOverlayReady').style.display = (type === 'READY') ? 'flex' : 'none';
  document.getElementById('wakeUpOverlayEnding').style.display = (type === 'ENDING') ? 'flex' : 'none';
  document.getElementById('wakeUpSceneBox').style.display = (type === 'NONE') ? 'block' : 'none';
  document.getElementById('wakeUpVisualBox').style.display = (type === 'NONE') ? 'block' : 'none';
  document.getElementById('wakeUpChoicesSection').style.display = (type === 'NONE') ? 'flex' : 'none';
}

/**
 * Renders the current level: situation text, door row (ASCII), AI hint
 * (picked by mistake count on this level), and clickable door buttons.
 */
function renderWakeUpLevel() {
  const level = WAKEUP_LEVELS[wakeUpState.levelIndex];
  if (!level) {
    finishWakeUpRun();
    return;
  }

  document.getElementById('wakeUpSceneBadge').innerText = level.label;
  document.getElementById('wakeUpSceneBox').innerText = level.situation;
  document.getElementById('wakeUpVisualArt').innerText = level.visual;

  const hintTier = Math.min(wakeUpState.mistakesThisLevel, level.hints.length - 1);
  if (hintTier > 0 && hintTier > wakeUpState.lastHintTierShown) wakeUpState.hintsUsedCount += 1;
  wakeUpState.lastHintTierShown = hintTier;
  setWakeUpAiLine(level.hints[hintTier]);

  renderWakeUpDoors(level);
  wakeUpState.choiceStartTime = Date.now();
}

function renderWakeUpDoors(level) {
  const choicesSection = document.getElementById('wakeUpChoicesSection');
  choicesSection.innerHTML = '';
  level.doors.forEach((door, index) => {
    const btn = document.createElement('button');
    btn.className = 'wakeup-door-btn';
    btn.innerHTML = `<span class="wakeup-door-emoji">${door.emoji}</span><span class="wakeup-door-label">${door.label}</span>`;
    btn.onclick = () => handleWakeUpDoorChoice(level, index);
    choicesSection.appendChild(btn);
  });
}

/** Core decision handler: applies the outcome, updates tracked state, shows the AI reaction. */
function handleWakeUpDoorChoice(level, doorIndex) {
  if (wakeUpState.status !== 'PLAYING') return;
  const door = level.doors[doorIndex];
  const decisionMs = Date.now() - wakeUpState.choiceStartTime;

  wakeUpState.doorHistory.push(door.emoji);

  if (door.outcome === 'correct') {
    TTBAudio.playSelect();
    wakeUpState.correctCount += 1;
    wakeUpState.streak += 1;
    wakeUpState.bestStreak = Math.max(wakeUpState.bestStreak, wakeUpState.streak);
    wakeUpState.mistakesThisLevel = 0;
    wakeUpState.lastHintTierShown = 0;

    const behaviorLine = pickWakeUpBehaviorYap(decisionMs);
    setWakeUpAiLine(behaviorLine ? `${door.reaction} ${behaviorLine}` : door.reaction);

    wakeUpState.levelIndex += 1;
    setTimeout(() => {
      if (wakeUpState.status !== 'PLAYING') return;
      if (wakeUpState.levelIndex < WAKEUP_LEVELS.length) {
        setWakeUpAiLine(randomFrom(WAKEUP_YAPS.levelStart));
        setTimeout(renderWakeUpLevel, 500);
      } else {
        finishWakeUpRun();
      }
    }, 900);

  } else if (door.outcome === 'wrongRetry') {
    TTBAudio.playUI();
    wakeUpState.wrongCount += 1;
    wakeUpState.streak = 0;
    wakeUpState.mistakesThisLevel += 1;

    const repeatLine = (wakeUpState.mistakesThisLevel >= 2) ? ` ${randomFrom(WAKEUP_YAPS.repeatMistakes)}` : '';
    setWakeUpAiLine(`${door.reaction}${repeatLine}`);

    setTimeout(() => {
      if (wakeUpState.status === 'PLAYING') renderWakeUpLevel();
    }, 1100);

  } else {
    // 'deadEnd' or 'secret' -- run ends immediately on this specific door
    TTBAudio.playGameOver();
    wakeUpState.wrongCount += 1;
    setWakeUpAiLine(door.reaction);
    setTimeout(() => showWakeUpEnding(door.endingId || 'secret'), 900);
  }
}

/** Picks a behavior-based yap to append after a correct choice (spec section 8). Returns '' if none apply. */
function pickWakeUpBehaviorYap(decisionMs) {
  const s = wakeUpState;
  if (s.streak === 3) return randomFrom(WAKEUP_YAPS.streak3);
  if (s.streak === 5) return randomFrom(WAKEUP_YAPS.streak5);
  if (s.streak === 1 && s.wrongCount >= 2) return randomFrom(WAKEUP_YAPS.comeback);
  if (decisionMs < 900) return randomFrom(WAKEUP_YAPS.veryFast);
  if (decisionMs > 7000) return randomFrom(WAKEUP_YAPS.verySlow);
  if (hasRepeatedRecentDoor(s.doorHistory)) return randomFrom(WAKEUP_YAPS.repeatedSymbol);
  return '';
}

/** True if the same door emoji was picked 3 times in a row somewhere in history. */
function hasRepeatedRecentDoor(history) {
  if (history.length < 3) return false;
  const last3 = history.slice(-3);
  return last3.every(e => e === last3[0]);
}

function setWakeUpAiLine(text) {
  const aiBox = document.getElementById('wakeUpAiBox');
  const aiText = document.getElementById('wakeUpAiText');
  if (!text) {
    aiBox.style.display = 'none';
    return;
  }
  aiBox.style.display = 'flex';
  aiText.innerText = `"${text}"`;
}

/** Reached after clearing every level (no deadEnd/secret hit). Picks the closing ending from run stats. */
function finishWakeUpRun() {
  const s = wakeUpState;
  const cleanRun = s.wrongCount === 0;

  // "Trusted the AI": barely ever needed a harder hint tier, and got it right anyway.
  const trustedAi = s.hintsUsedCount === 0 && cleanRun;

  // "Ignored the AI": needed several harder hints AND kept missing anyway --
  // i.e. wrong choices piled up well beyond the number of times the AI had
  // to repeat/escalate itself. A player who fixes their mistake right after
  // the harder hint (wrongCount ~= hintsUsedCount) was listening, just slow.
  // A player who blows well past that ratio was guessing through it.
  const ignoredAi = s.wrongCount >= s.hintsUsedCount + 2 && s.wrongCount >= 3;

  let endingId;
  if (trustedAi) endingId = 'trustedAi';
  else if (ignoredAi) endingId = 'ignoredAi';
  else if (cleanRun) endingId = 'escapeClean';
  else endingId = 'escapeMessy';

  showWakeUpEnding(endingId);
}

function showWakeUpEnding(endingId) {
  wakeUpState.status = 'ENDED';
  TTBAudio.playGameOver();

  const ending = WAKEUP_ENDINGS[endingId];
  const title = ending ? ending.title : 'THE END';
  const closingLines = ending ? ending.closingLines : '...';

  document.getElementById('wakeUpEndingTitle').innerText = title;
  document.getElementById('wakeUpEndingText').innerText = closingLines;

  showWakeUpOverlay('ENDING');
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
