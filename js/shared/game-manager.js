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
    }

