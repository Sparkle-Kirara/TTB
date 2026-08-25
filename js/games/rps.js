    const MOVES = ['rock', 'paper', 'scissors'];
    const MOVE_ICONS = { rock: '✊', paper: '✋', scissors: '✌️' };
    const WIN_AGAINST = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
    const LOSE_TO = { rock: 'paper', paper: 'scissors', scissors: 'rock' };

    function getCounterMove(move) { return LOSE_TO[move]; }
    function getBeatenByMove(move) { return WIN_AGAINST[move]; }

    const LEVEL_0_PROMPTS = [
      "Make your choice.", "Choose your move.", "Rock, Paper, or Scissors?",
      "Your move.", "Pick one.", "What will you choose?", "Choose wisely."
    ];

    const LEVEL_0_HINT_REACTIONS = [
      "Two rounds and you still haven't won? Fine. Here's a hint.",
      "Still struggling? I'll help you this time.",
      "Two chances. Zero wins. You need a little help?",
      "Alright, alright... I'll give you a hint.",
      "You had two chances. Let's make this easier.",
      "Okay, you clearly need some assistance."
    ];

    const WIN_REACTIONS = ["You actually won?", "Don't get too excited.", "Enjoy your little victory.", "Was that intentional?"];
    const LOSS_REACTIONS = ["That was almost too easy.", "Predictable.", "I saw that coming from a mile away."];
    const DRAW_REACTIONS = ["We're going nowhere.", "Still tied?", "Neither of us wanted to win, apparently."];

    let rpsGameState = {
      level: 0,
      totalRounds: 1,
      playerScore: 0,
      aiScore: 0,
      history: [],
      currentAiMove: null,
      currentStatement: '',
      currentExplanation: '',
      currentReaction: null,
      isRoundResolved: false,
      recentlyUsedHintKeys: [],
      recentlyUsedReactions: [],
      justLeveledUp: false,
      lastRoundResult: null,
      level0FailedAttempts: 0
    };

    function startRPSGame() {
      TTBAudio.playStart();
      rpsGameState = {
        level: 0, totalRounds: 1, playerScore: 0, aiScore: 0, history: [],
        currentAiMove: null, currentStatement: '', currentExplanation: '', currentReaction: null,
        isRoundResolved: false, recentlyUsedHintKeys: [], recentlyUsedReactions: [],
        justLeveledUp: false, lastRoundResult: null, level0FailedAttempts: 0
      };
      showView('rpsView');
      setupRound();
    }

    function setupRound() {
      rpsGameState.isRoundResolved = false;
      document.getElementById('resultStage').classList.remove('active');
      document.getElementById('controlsSection').style.display = 'block';

      if (rpsGameState.justLeveledUp) {
        document.getElementById('newLevelNum').innerText = rpsGameState.level;
        const banner = document.getElementById('levelUpBanner');
        banner.style.display = 'block';
        setTimeout(() => { banner.style.display = 'none'; }, 2200);
        rpsGameState.justLeveledUp = false;
      } else {
        document.getElementById('levelUpBanner').style.display = 'none';
      }

      rpsGameState.currentReaction = generateAiYapping();
      const generated = generateTurnData(rpsGameState.level, rpsGameState.history, rpsGameState.recentlyUsedHintKeys);
      
      rpsGameState.currentAiMove = generated.move;
      rpsGameState.currentStatement = generated.statement;
      rpsGameState.currentExplanation = generated.explanation;

      if (generated.hintKey && generated.hintKey !== 'L0') {
        TTBAudio.playHint();
      }

      if (generated.hintKey) {
        rpsGameState.recentlyUsedHintKeys.push(generated.hintKey);
        if (rpsGameState.recentlyUsedHintKeys.length > 5) rpsGameState.recentlyUsedHintKeys.shift();
      }

      updateRpsUI();
    }

    function generateAiYapping() {
      function pickUnique(pool) {
        let filtered = pool.filter(line => !rpsGameState.recentlyUsedReactions.includes(line));
        if (filtered.length === 0) filtered = pool;
        const chosen = filtered[Math.floor(Math.random() * filtered.length)];
        rpsGameState.recentlyUsedReactions.push(chosen);
        if (rpsGameState.recentlyUsedReactions.length > 8) rpsGameState.recentlyUsedReactions.shift();
        return chosen;
      }

      if (rpsGameState.level === 0 && rpsGameState.level0FailedAttempts >= 2) {
        return pickUnique(LEVEL_0_HINT_REACTIONS);
      }

      if (rpsGameState.lastRoundResult === 'win') return pickUnique(WIN_REACTIONS);
      if (rpsGameState.lastRoundResult === 'lose') return pickUnique(LOSS_REACTIONS);
      if (rpsGameState.lastRoundResult === 'draw') return pickUnique(DRAW_REACTIONS);
      return null;
    }

    function generateTurnData(level, history, usedKeys) {
      const hLen = history.length;
      const isLevel0NoHint = (level === 0 && rpsGameState.level0FailedAttempts < 2);

      if (isLevel0NoHint) {
        const randomMove = MOVES[Math.floor(Math.random() * MOVES.length)];
        const prompt = LEVEL_0_PROMPTS[Math.floor(Math.random() * LEVEL_0_PROMPTS.length)];
        return { move: randomMove, statement: `"${prompt}"`, explanation: 'Level 0 Baseline: Pure strategy test.', hintKey: 'L0' };
      }

      const effectiveLevel = (level === 0 && rpsGameState.level0FailedAttempts >= 2) ? 2 : level;

      if (effectiveLevel === 1) {
        const intendedMove = MOVES[Math.floor(Math.random() * MOVES.length)];
        const moveCap = intendedMove.charAt(0).toUpperCase() + intendedMove.slice(1);
        return { move: intendedMove, statement: `"My next choice will be ${moveCap}."`, explanation: `Direct Hint: AI directly declared ${moveCap}.`, hintKey: 'L1' };
      }

      let candidatePool = [];
      for (let offset = 1; offset <= Math.min(3, hLen); offset++) {
        if (effectiveLevel === 2 && offset > 1) continue;

        const targetRound = history[hLen - offset];
        const targetMove = targetRound.playerMove;
        const roundDescriptor = (offset === 1) ? 'one round ago' : `${offset} rounds ago`;

        let chosenRelationship = (targetRound.result === 'win') ? 'beat' : 'lose';
        let aiMove = chosenRelationship === 'beat' ? getCounterMove(targetMove) : getBeatenByMove(targetMove);
        let relText = chosenRelationship === 'beat' ? 'beat' : 'lose to';

        candidatePool.push({
          move: aiMove,
          statement: `"My next choice will ${relText} your choice from ${roundDescriptor}."`,
          explanation: `Referenced Round ${targetRound.round}: You played ${targetMove.toUpperCase()}. To ${relText} it, AI chose ${aiMove.toUpperCase()}.`,
          hintKey: `rel_${offset}_${chosenRelationship}`
        });
      }

      let unused = candidatePool.filter(c => !usedKeys.includes(c.hintKey));
      let finalPool = unused.length > 0 ? unused : candidatePool;

      if (finalPool.length === 0) {
        const fallbackMove = MOVES[Math.floor(Math.random() * MOVES.length)];
        return { move: fallbackMove, statement: `"My next choice will be ${fallbackMove.toUpperCase()}."`, explanation: `Direct Hint.`, hintKey: 'fallback' };
      }

      return finalPool[Math.floor(Math.random() * finalPool.length)];
    }

    function playTurn(playerMove) {
      if (rpsGameState.isRoundResolved) return;
      rpsGameState.isRoundResolved = true;

      TTBAudio.playSelect();

      const aiMove = rpsGameState.currentAiMove;
      let result = 'draw';

      if (playerMove === aiMove) result = 'draw';
      else if (WIN_AGAINST[playerMove] === aiMove) { result = 'win'; rpsGameState.playerScore++; }
      else { result = 'lose'; rpsGameState.aiScore++; }

      rpsGameState.history.push({
        round: rpsGameState.totalRounds, playerMove, aiMove, result
      });

      rpsGameState.lastRoundResult = result;

      document.getElementById('playerMoveIcon').innerText = MOVE_ICONS[playerMove];
      document.getElementById('aiMoveIcon').innerText = MOVE_ICONS[aiMove];
      
      const badge = document.getElementById('resultBadge');
      badge.className = 'result-badge ' + result;

      if (result === 'win') {
        badge.innerText = 'YOU WIN!';
        rpsGameState.level++;
        rpsGameState.justLeveledUp = true;
        TTBAudio.playLevelUp();
      } else if (result === 'lose') {
        badge.innerText = 'AI WINS!';
        if (rpsGameState.level === 0) rpsGameState.level0FailedAttempts++;
        TTBAudio.playLose();
      } else {
        badge.innerText = 'DRAW!';
        if (rpsGameState.level === 0) rpsGameState.level0FailedAttempts++;
        TTBAudio.playDraw();
      }

      document.getElementById('explanationText').innerText = rpsGameState.currentExplanation;
      document.getElementById('controlsSection').style.display = 'none';
      document.getElementById('resultStage').classList.add('active');

      updateRpsUI();
    }

    function advanceRound() {
      TTBAudio.playUI();
      rpsGameState.totalRounds++;
      setupRound();
    }

    function updateRpsUI() {
      document.getElementById('levelDisplay').innerText = `Level ${rpsGameState.level}`;
      document.getElementById('playerScoreDisplay').innerText = rpsGameState.playerScore;
      document.getElementById('aiScoreDisplay').innerText = rpsGameState.aiScore;
      document.getElementById('roundDisplay').innerText = rpsGameState.totalRounds;
      
      const isNoHintL0 = (rpsGameState.level === 0 && rpsGameState.level0FailedAttempts < 2);
      document.getElementById('aiTagTitle').innerText = isNoHintL0 ? '🤖 AI' : '🤖 AI HINT';
      
      const reactionEl = document.getElementById('aiReactionDisplay');
      if (rpsGameState.currentReaction) {
        reactionEl.innerText = `"${rpsGameState.currentReaction}"`;
        reactionEl.style.display = 'inline-block';
      } else reactionEl.style.display = 'none';

      document.getElementById('aiStatementText').innerText = rpsGameState.currentStatement;

      const historyList = document.getElementById('historyList');
      if (rpsGameState.history.length === 0) {
        historyList.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted);">No history yet.</div>';
      } else {
        const recentHistory = [...rpsGameState.history].reverse().slice(0, 8);
        historyList.innerHTML = recentHistory.map(h => `
          <div class="history-item ${h.result === 'lose' ? 'loss-item' : h.result === 'win' ? 'win-item' : ''}">
            <span class="round-lbl">R${h.round} ${h.result === 'lose' ? '❌' : h.result === 'win' ? '✅' : '➖'}</span>
            <span class="moves-lbl">${MOVE_ICONS[h.playerMove]} vs ${MOVE_ICONS[h.aiMove]}</span>
          </div>
        `).join('');
      }
    }

