    let currentActiveGame = null;

    function showView(viewId) {
      TTBAudio.resume();
      TTBAudio.playUI();
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById(viewId).classList.add('active');
      
      const isHub = (viewId === 'hubView');
      document.getElementById('navBackBtn').style.display = isHub ? 'none' : 'flex';
      document.getElementById('restartGameBtn').style.display = isHub ? 'none' : 'flex';

      stopAllAnimationLoops();
      if (typeof clearDontBlinkTimers === 'function') clearDontBlinkTimers();
      if (typeof clearHotOrNotTimers === 'function') clearHotOrNotTimers();
      if (typeof clearReflexTimers === 'function') clearReflexTimers();

      if (viewId === 'rpsView') {
        currentActiveGame = 'rps';
      } else if (viewId === 'snakeView') {
        currentActiveGame = 'snake';
        startSnakeLoop();
      } else if (viewId === 'whereIsItView') {
        currentActiveGame = 'whereIsIt';
        startWiiLoop();
      } else if (viewId === 'dgcView') {
        currentActiveGame = 'dgc';
        startDgcLoop();
      } else if (viewId === 'ttmView') {
        currentActiveGame = 'ttm';
      } else if (viewId === 'wakeUpView') {
        currentActiveGame = 'wakeUp';
      } else if (viewId === 'dontBlinkView') {
        currentActiveGame = 'dontBlink';
      } else if (viewId === 'hotOrNotView') {
        currentActiveGame = 'hotOrNot';
      } else if (viewId === 'reflexView') {
        currentActiveGame = 'reflex';
      } else if (viewId === 'runnerView') {
        currentActiveGame = 'runner';
        startRunnerLoop();
      } else if (viewId === 'physicsView') {
        currentActiveGame = 'physics';
        startPhysicsLoop();
      } else if (viewId === 'aimView') {
        currentActiveGame = 'aim';
      } else if (viewId === 'aimDuelView') {
        currentActiveGame = 'aimDuel';
      } else {
        currentActiveGame = null;
      }
    }

    function handleHeaderRestart() {
      TTBAudio.playUI();
      if (currentActiveGame === 'rps') startRPSGame();
      else if (currentActiveGame === 'snake') snakeStartRun();
      else if (currentActiveGame === 'whereIsIt') wiiStartRun();
      else if (currentActiveGame === 'dgc') dgcRetryRun();
      else if (currentActiveGame === 'ttm') ttmRetryRun();
      else if (currentActiveGame === 'wakeUp') startWakeUpStory();
      else if (currentActiveGame === 'dontBlink') startDontBlinkRun();
      else if (currentActiveGame === 'hotOrNot') startHotOrNotRun();
      else if (currentActiveGame === 'reflex') startReflexRun();
      else if (currentActiveGame === 'runner') runnerStartRun();
      else if (currentActiveGame === 'physics') physicsStartRun();
      else if (currentActiveGame === 'aim') aimStartRun();
      else if (currentActiveGame === 'aimDuel') aimDuelStartRun();
    }

    function stopAllAnimationLoops() {
      if (snakeAnimationId) {
        cancelAnimationFrame(snakeAnimationId);
        snakeAnimationId = null;
      }
      if (wiiAnimationId) {
        cancelAnimationFrame(wiiAnimationId);
        wiiAnimationId = null;
      }
      if (dgcAnimationId) {
        cancelAnimationFrame(dgcAnimationId);
        dgcAnimationId = null;
      }
      if (typeof runnerAnimationId !== 'undefined' && runnerAnimationId) {
        cancelAnimationFrame(runnerAnimationId);
        runnerAnimationId = null;
      }
      if (typeof physicsAnimationId !== 'undefined' && physicsAnimationId) {
        cancelAnimationFrame(physicsAnimationId);
        physicsAnimationId = null;
      }
      if (typeof aimAnimationId !== 'undefined' && aimAnimationId) {
        cancelAnimationFrame(aimAnimationId);
        aimAnimationId = null;
      }
      if (typeof aimDuelAnimationId !== 'undefined' && aimDuelAnimationId) {
        cancelAnimationFrame(aimDuelAnimationId);
        aimDuelAnimationId = null;
      }
      if (typeof aimDuelDecisionIntervalId !== 'undefined' && aimDuelDecisionIntervalId) {
        clearInterval(aimDuelDecisionIntervalId);
        aimDuelDecisionIntervalId = null;
      }
    }

