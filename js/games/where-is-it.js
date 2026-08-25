    const WII_CONFIG = {
      STORAGE_KEY: 'ttb_whereisit_highscore',
      SHOW_DURATION: 1400,
      SETTLE_DURATION: 120,
      RESULT_PAUSE: 1800
    };

    let wiiState = {
      status: 'READY',
      level: 0,
      score: 0,
      bestScore: 0,
      progress: 0,
      cups: [],
      targetCupId: null,
      selectedCupId: null,
      swapQueue: [],
      currentSwap: null,
      lastResult: null,
      instructionText: "Watch carefully."
    };

    let wiiCanvas, wiiCtx;
    let wiiAnimationId = null;

    function getWiiDimensions() {
      if (!wiiCanvas) return null;
      const width = wiiCanvas.width;
      const height = wiiCanvas.height;
      const numCups = wiiState.cups.length || 3;

      const paddingLeft = width * 0.05;
      const paddingTop = height * 0.06;
      const playW = width * 0.90;
      const playH = height * 0.88;
      const slotW = playW / numCups;

      const TOP_RATIO = 0.65;
      const BOTTOM_RATIO = 0.35;
      const LIFT_RATIO = 0.70;
      const totalReachRatio = LIFT_RATIO + TOP_RATIO + BOTTOM_RATIO;
      const SAFETY = 0.92;

      const HEIGHT_RATIO = 1.15;
      const wMaxHorizontal = slotW * 0.68;
      const wMaxVertical = ((playH * SAFETY) / totalReachRatio) / HEIGHT_RATIO;
      const cupWidth = Math.min(wMaxHorizontal, wMaxVertical);
      const cupHeight = cupWidth * HEIGHT_RATIO;

      const liftOffset = cupHeight * LIFT_RATIO;
      const arcHeight = cupHeight * 0.35;

      const leftoverSpace = Math.max(0, playH - cupHeight * totalReachRatio);
      const centerY = paddingTop + (leftoverSpace / 2) + (cupHeight * (LIFT_RATIO + TOP_RATIO));

      return {
        width, height, numCups, paddingLeft, paddingTop,
        playW, playH, slotW, cupWidth, cupHeight, liftOffset, arcHeight, centerY
      };
    }

    function startWhereIsItGame() {
      TTBAudio.playStart();
      showView('whereIsItView');
      initWiiCanvas();
      loadWiiHighScore();
      
      wiiState.level = 0;
      wiiState.score = 0;
      wiiState.progress = 0;
      wiiState.status = 'READY';

      updateWiiScoresUI();
      document.getElementById('wiiOverlayReady').style.display = 'flex';
      setWiiInstruction("Watch carefully.");
    }

    function startWiiLoop() {
      if (!wiiAnimationId) {
        wiiAnimationId = requestAnimationFrame(wiiGameLoop);
      }
    }

    function initWiiCanvas() {
      wiiCanvas = document.getElementById('wiiCanvas');
      if (!wiiCanvas) return;
      wiiCtx = wiiCanvas.getContext('2d');

      const container = document.getElementById('wiiBoardContainer');
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      wiiCanvas.width = Math.floor(rect.width * dpr);
      wiiCanvas.height = Math.floor(rect.height * dpr);
    }

    window.addEventListener('resize', () => {
      if (currentActiveGame === 'whereIsIt' && wiiCanvas) {
        initWiiCanvas();
        recalculateWiiCupPositions();
        drawWiiBoard();
      }
    });

    function loadWiiHighScore() {
      const saved = localStorage.getItem(WII_CONFIG.STORAGE_KEY);
      wiiState.bestScore = saved ? parseInt(saved, 10) : 0;
      document.getElementById('wiiBestDisplay').innerText = wiiState.bestScore;
    }

    function saveWiiHighScore() {
      if (wiiState.score > wiiState.bestScore) {
        wiiState.bestScore = wiiState.score;
        localStorage.setItem(WII_CONFIG.STORAGE_KEY, wiiState.bestScore.toString());
        document.getElementById('wiiBestDisplay').innerText = wiiState.bestScore;
      }
    }

    function setWiiInstruction(text) {
      wiiState.instructionText = text;
      document.getElementById('wiiInstructionText').innerText = text;
    }

    function updateWiiScoresUI() {
      document.getElementById('wiiLevelDisplay').innerText = `Level ${wiiState.level}`;
      document.getElementById('wiiScoreDisplay').innerText = wiiState.score;
      document.getElementById('wiiBestDisplay').innerText = wiiState.bestScore;
      document.getElementById('wiiProgressDisplay').innerText = `${wiiState.progress}/2`;
    }

    function getLevelParams(level) {
      if (level === 0) return { cupCount: 3, swapCount: 2, swapDuration: 420 };
      if (level === 1) return { cupCount: 3, swapCount: 4, swapDuration: 340 };
      if (level === 2) return { cupCount: 4, swapCount: 5, swapDuration: 280 };
      if (level === 3) return { cupCount: 4, swapCount: 7, swapDuration: 230 };
      
      const cupCount = 5;
      const swapCount = Math.min(12, 8 + (level - 4));
      const swapDuration = Math.max(160, 200 - (level - 4) * 10);
      return { cupCount, swapCount, swapDuration };
    }

    function wiiStartRun() {
      TTBAudio.playStart();
      document.getElementById('wiiOverlayReady').style.display = 'none';
      setupWiiRound();
    }

    function setupWiiRound() {
      const params = getLevelParams(wiiState.level);
      const numCups = params.cupCount;

      wiiState.status = 'SHOW';
      wiiState.selectedCupId = null;
      wiiState.lastResult = null;
      wiiState.swapQueue = [];
      wiiState.currentSwap = null;

      wiiState.cups = [];
      const targetIndex = Math.floor(Math.random() * numCups);

      for (let i = 0; i < numCups; i++) {
        const isTarget = (i === targetIndex);
        wiiState.cups.push({
          id: i, slotIndex: i, currentX: 0, currentY: 0,
          targetX: 0, targetY: 0, isTarget: isTarget, liftY: isTarget ? 1.0 : 0.0
        });
        if (isTarget) wiiState.targetCupId = i;
      }

      recalculateWiiCupPositions();
      updateWiiScoresUI();
      setWiiInstruction("Watch carefully!");

      generateSwapSequence(params.swapCount, numCups);

      setTimeout(() => {
        if (wiiState.status !== 'SHOW') return;
        animateCupLowering(() => {
          wiiState.status = 'SHUFFLING';
          setWiiInstruction("Follow the object...");
          processNextSwap();
        });
      }, WII_CONFIG.SHOW_DURATION);
    }

    function generateSwapSequence(count, numCups) {
      wiiState.swapQueue = [];
      let lastSlotA = -1, lastSlotB = -1;

      for (let i = 0; i < count; i++) {
        let slotA, slotB;
        do {
          slotA = Math.floor(Math.random() * numCups);
          do {
            slotB = Math.floor(Math.random() * numCups);
          } while (slotA === slotB);
        } while (
          (slotA === lastSlotA && slotB === lastSlotB) ||
          (slotA === lastSlotB && slotB === lastSlotA)
        );

        wiiState.swapQueue.push({ slotA, slotB });
        lastSlotA = slotA;
        lastSlotB = slotB;
      }
    }

    function recalculateWiiCupPositions() {
      if (!wiiCanvas || wiiState.cups.length === 0) return;
      const dims = getWiiDimensions();
      if (!dims) return;

      wiiState.cups.forEach(cup => {
        const posX = dims.paddingLeft + dims.slotW * (cup.slotIndex + 0.5);
        cup.currentX = posX;
        cup.targetX = posX;
        cup.currentY = dims.centerY;
        cup.targetY = dims.centerY;
      });
    }

    function animateCupLowering(onComplete) {
      const targetCup = wiiState.cups.find(c => c.id === wiiState.targetCupId);
      if (!targetCup) { onComplete(); return; }

      const startTime = performance.now();
      const duration = 300;

      function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        targetCup.liftY = 1.0 - progress;

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          targetCup.liftY = 0;
          onComplete();
        }
      }
      requestAnimationFrame(step);
    }

    function processNextSwap() {
      if (wiiState.swapQueue.length === 0) {
        wiiState.status = 'CHOOSE';
        setWiiInstruction("Where is it? Tap a cup.");
        TTBAudio.playHint();
        return;
      }

      const nextPair = wiiState.swapQueue.shift();
      const cupA = wiiState.cups.find(c => c.slotIndex === nextPair.slotA);
      const cupB = wiiState.cups.find(c => c.slotIndex === nextPair.slotB);

      if (!cupA || !cupB) return;

      const tempSlot = cupA.slotIndex;
      cupA.slotIndex = cupB.slotIndex;
      cupB.slotIndex = tempSlot;

      const params = getLevelParams(wiiState.level);
      const dims = getWiiDimensions();

      wiiState.currentSwap = {
        cupA, cupB,
        startXA: cupA.currentX, startXB: cupB.currentX,
        targetXA: cupB.currentX, targetXB: cupA.currentX,
        startTime: performance.now(), duration: params.swapDuration,
        baselineY: dims ? dims.centerY : wiiCanvas.height * 0.58,
        maxArc: dims ? dims.arcHeight : wiiCanvas.height * 0.1
      };

      TTBAudio.playSwap();
    }

    function handleWiiCanvasClick(clientX, clientY) {
      if (wiiState.status !== 'CHOOSE') return;

      const dims = getWiiDimensions();
      if (!dims) return;

      const rect = wiiCanvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const tapX = (clientX - rect.left) * dpr;
      const tapY = (clientY - rect.top) * dpr;

      const cupW = dims.cupWidth;
      const cupH = dims.cupHeight;

      for (const cup of wiiState.cups) {
        const minX = cup.currentX - cupW * 0.55;
        const maxX = cup.currentX + cupW * 0.55;
        const minY = cup.currentY - cupH * 0.70;
        const maxY = cup.currentY + cupH * 0.35;

        if (tapX >= minX && tapX <= maxX && tapY >= minY && tapY <= maxY) {
          selectWiiCup(cup.id);
          break;
        }
      }
    }

    function selectWiiCup(cupId) {
      if (wiiState.status !== 'CHOOSE') return;

      wiiState.status = 'RESULT';
      wiiState.selectedCupId = cupId;

      const isCorrect = (cupId === wiiState.targetCupId);
      const chosenCup = wiiState.cups.find(c => c.id === cupId);
      const targetCup = wiiState.cups.find(c => c.id === wiiState.targetCupId);

      chosenCup.liftY = 1.0;
      if (!isCorrect) targetCup.liftY = 1.0;

      if (isCorrect) {
        wiiState.score += 1;
        wiiState.progress += 1;
        wiiState.lastResult = 'win';

        TTBAudio.playWin();

        if (wiiState.progress >= 2) {
          wiiState.level += 1;
          wiiState.progress = 0;
          setWiiInstruction("🎉 Level Up!");
          TTBAudio.playLevelUp();
        } else {
          setWiiInstruction("✅ Correct!");
        }

        saveWiiHighScore();
      } else {
        wiiState.lastResult = 'lose';
        TTBAudio.playLose();
        setWiiInstruction("❌ Wrong! Here it was.");
      }

      updateWiiScoresUI();

      setTimeout(() => {
        if (currentActiveGame === 'whereIsIt') setupWiiRound();
      }, WII_CONFIG.RESULT_PAUSE);
    }

    function wiiGameLoop(timestamp) {
      if (currentActiveGame === 'whereIsIt') {
        updateWiiPhysics(timestamp);
        drawWiiBoard();
        wiiAnimationId = requestAnimationFrame(wiiGameLoop);
      } else {
        wiiAnimationId = null;
      }
    }

    function updateWiiPhysics(now) {
      if (wiiState.status === 'SHUFFLING' && wiiState.currentSwap) {
        const swap = wiiState.currentSwap;
        const elapsed = now - swap.startTime;
        const progress = Math.min(1, elapsed / swap.duration);

        const ease = progress < 0.5 
          ? 4 * progress * progress * progress 
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        const baselineY = swap.baselineY;
        const maxArc = swap.maxArc;

        swap.cupA.currentX = swap.startXA + (swap.targetXA - swap.startXA) * ease;
        swap.cupA.currentY = baselineY - Math.sin(progress * Math.PI) * maxArc;

        swap.cupB.currentX = swap.startXB + (swap.targetXB - swap.startXB) * ease;
        swap.cupB.currentY = baselineY + Math.sin(progress * Math.PI) * maxArc;

        if (progress >= 1) {
          swap.cupA.currentX = swap.targetXA;
          swap.cupA.currentY = baselineY;
          swap.cupB.currentX = swap.targetXB;
          swap.cupB.currentY = baselineY;
          wiiState.currentSwap = null;

          setTimeout(() => {
            if (wiiState.status === 'SHUFFLING') processNextSwap();
          }, WII_CONFIG.SETTLE_DURATION);
        }
      }
    }

    function drawWiiBoard() {
      if (!wiiCtx || !wiiCanvas) return;

      const width = wiiCanvas.width;
      const height = wiiCanvas.height;

      wiiCtx.fillStyle = '#0f172a';
      wiiCtx.fillRect(0, 0, width, height);

      const dims = getWiiDimensions();
      if (!dims || wiiState.cups.length === 0) return;

      const { paddingLeft, paddingTop, playW, playH, cupWidth, cupHeight, liftOffset } = dims;

      wiiCtx.fillStyle = '#1e293b';
      if (wiiCtx.roundRect) {
        wiiCtx.beginPath();
        wiiCtx.roundRect(paddingLeft, paddingTop, playW, playH, 16);
        wiiCtx.fill();
      } else {
        wiiCtx.fillRect(paddingLeft, paddingTop, playW, playH);
      }
      wiiCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      wiiCtx.lineWidth = 2;

      wiiState.cups.forEach(cup => {
        if (cup.isTarget && cup.liftY > 0.01) {
          const objX = cup.currentX;
          const objY = cup.currentY + cupHeight * 0.12;
          const objRadius = cupWidth * 0.18;

          const alpha = Math.min(1, cup.liftY * 1.5);
          wiiCtx.save();
          wiiCtx.globalAlpha = alpha;

          wiiCtx.fillStyle = 'rgba(245, 158, 11, 0.3)';
          wiiCtx.beginPath();
          wiiCtx.arc(objX, objY, objRadius * 1.4, 0, Math.PI * 2);
          wiiCtx.fill();

          const grad = wiiCtx.createRadialGradient(
            objX - objRadius * 0.3, objY - objRadius * 0.3, objRadius * 0.1,
            objX, objY, objRadius
          );
          grad.addColorStop(0, '#fef08a');
          grad.addColorStop(0.5, '#f59e0b');
          grad.addColorStop(1, '#b45309');

          wiiCtx.fillStyle = grad;
          wiiCtx.beginPath();
          wiiCtx.arc(objX, objY, objRadius, 0, Math.PI * 2);
          wiiCtx.fill();

          wiiCtx.fillStyle = '#ffffff';
          wiiCtx.beginPath();
          wiiCtx.arc(objX - objRadius * 0.35, objY - objRadius * 0.35, objRadius * 0.25, 0, Math.PI * 2);
          wiiCtx.fill();

          wiiCtx.restore();
        }
      });

      wiiState.cups.forEach(cup => {
        const renderY = cup.currentY - (cup.liftY * liftOffset);
        const halfW = cupWidth / 2;

        const shadowScale = Math.max(0.2, 1 - (cup.liftY * 0.4));
        wiiCtx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        wiiCtx.beginPath();
        wiiCtx.ellipse(
          cup.currentX, 
          cup.currentY + cupHeight * 0.25, 
          halfW * shadowScale * 1.05, 
          halfW * 0.3 * shadowScale, 
          0, 0, Math.PI * 2
        );
        wiiCtx.fill();

        wiiCtx.fillStyle = (wiiState.status === 'CHOOSE') ? '#6366f1' : '#475569';
        if (wiiState.selectedCupId === cup.id) {
          wiiCtx.fillStyle = cup.isTarget ? '#10b981' : '#f43f5e';
        }

        wiiCtx.beginPath();
        const topW = halfW * 0.8;
        const botW = halfW * 1.05;
        const topY = renderY - cupHeight * 0.65;
        const botY = renderY + cupHeight * 0.25;

        wiiCtx.moveTo(cup.currentX - topW, topY);
        wiiCtx.lineTo(cup.currentX + topW, topY);
        wiiCtx.lineTo(cup.currentX + botW, botY);
        wiiCtx.lineTo(cup.currentX - botW, botY);
        wiiCtx.closePath();
        wiiCtx.fill();

        wiiCtx.fillStyle = '#334155';
        wiiCtx.beginPath();
        wiiCtx.ellipse(cup.currentX, topY, topW, topW * 0.25, 0, 0, Math.PI * 2);
        wiiCtx.fill();

        wiiCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        wiiCtx.lineWidth = 2.5;
        wiiCtx.stroke();

        wiiCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        wiiCtx.beginPath();
        wiiCtx.moveTo(cup.currentX - topW * 0.5, topY + cupHeight * 0.15);
        wiiCtx.lineTo(cup.currentX - botW * 0.5, botY - cupHeight * 0.15);
        wiiCtx.stroke();
      });
    }

    const wiiBoardContainer = document.getElementById('wiiBoardContainer');

    wiiBoardContainer.addEventListener('click', (e) => {
      if (currentActiveGame === 'whereIsIt') {
        handleWiiCanvasClick(e.clientX, e.clientY);
      }
    });

    wiiBoardContainer.addEventListener('touchstart', (e) => {
      if (currentActiveGame === 'whereIsIt' && e.touches.length === 1) {
        handleWiiCanvasClick(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    /* --- GAME 04: "DON'T GET CAUGHT" (STRATEGIC INTERCEPTION EXPANSION) --- */
