/* =====================================================================
   AI/AIM-NEURAL.JS — Neural Duel: state encoding, action decoding, and
   online reward-based learning for Game #12's AI-controlled target.
   =====================================================================
   This is the bridge module between the generic NeuralNetwork
   (js/ai/neural-network.js) and Neural Duel gameplay (js/games/aim.js),
   the same role js/ai/snake-ai.js plays for Snake. It knows nothing
   about canvas rendering, DOM, or dialogue -- only:

     - encoding the current duel situation into a fixed input vector
     - decoding the network's output into one of 5 discrete actions
     - a small ONLINE learning rule that nudges weights after each shot
     - epsilon-greedy exploration
     - checkpoint persistence (own storage key, mirrors ai-storage.js's
       pattern without touching that Snake-specific module)

   IMPORTANT -- WHAT THE LEARNING RULE ACTUALLY IS:
   js/ai/neural-network.js has no gradient-descent/backprop method, and
   js/ai/neuroevolution.js only trains via whole-population, whole-game
   genetic selection (evaluate hundreds of full games, then mutate the
   survivors). Neither fits "learn a little after every single shot,
   during live play." So this module implements a small, honestly-labeled
   REWARD-WEIGHTED PERTURBATION update (see nudgeNetworkTowardAction
   below): it is NOT backpropagation and NOT a real policy-gradient
   estimator with correct credit assignment -- it is a lightweight
   hill-climbing signal that nudges the weights feeding the chosen
   action's output node in the direction that would have increased (for
   positive reward) or decreased (for negative reward) that node's
   activation, scaled by the reward magnitude and a learning rate. This
   is closer to a single-sample REINFORCE-style update on one output
   than true backprop through hidden layers (hidden-layer weights are
   left untouched by design, to keep this small, fast, and stable enough
   to run after every shot on mobile). It genuinely changes behavior over
   time in the direction of past rewards -- it is not decorative and not
   hardcoded -- but it is a simplified rule, and this comment exists so
   that fact is never hidden or overstated.
   ===================================================================== */

const AIM_NEURAL_CONFIG = {
  // Network topology: small, per spec ("input -> small hidden -> 5 actions").
  INPUT_SIZE: 14,
  HIDDEN_SIZES: [12],
  OUTPUT_SIZE: 5, // [STAY, LEFT, RIGHT, UP, DOWN]

  // Decision cadence: the network is NOT re-evaluated every render frame.
  DECISION_INTERVAL_MS: 150,

  // Movement limits (fairness/safety layer -- enforced deterministically
  // AFTER the network picks an action, never left to the network itself).
  MAX_MOVE_PER_DECISION: 5,   // px the target may move per decision tick
  MAX_MOVE_SPEED: 5 / 0.15,   // px/sec implied by the above at the decision interval

  // Online learning.
  LEARNING_RATE: 0.05,
  REWARD_CLAMP: 3,            // reward is clamped to [-REWARD_CLAMP, +REWARD_CLAMP] before use

  // Exploration (epsilon-greedy). Starts high, decays toward a floor as
  // more shots are observed this session (spec §15).
  EPSILON_START: 0.35,
  EPSILON_MIN: 0.05,
  EPSILON_DECAY_PER_SHOT: 0.01,

  // Reward shaping (spec §6-8).
  EVASION_BASE_REWARD: 2.0,       // Case B: genuine evasion, before movement shaping
  HIT_PENALTY: -2.0,              // Case A: baseline would be hit AND actual is hit (AI failed)
  UNNECESSARY_MOVE_PENALTY: -0.4, // Case C: baseline would already miss, but AI moved anyway
  STILLNESS_REWARD: 0.15,         // Case C: baseline would already miss, AI correctly stayed put
  MINIMAL_MOVEMENT_BONUS_MAX: 1.0,// added on top of EVASION_BASE_REWARD for very small movement
  MOVEMENT_DISTANCE_PENALTY_SCALE: 0.02, // per-pixel penalty applied to total movement distance for the decision(s) involved
  PREDICTION_BONUS: 0.5,          // extra reward if the AI had already started moving away before the shot (see isPredictive flag)

  CHECKPOINT_STORAGE_KEY: 'ttb_aim_neural_checkpoint',
  MODEL_VERSION: 1
};

/**
 * Encodes the current Neural Duel situation into a fixed 14-value input
 * vector. All values are normalized (roughly -1..1 or 0..1) and relative
 * (cursor-relative-to-target, not raw screen coordinates), per spec §9.
 *
 * @param {Object} s
 * @param {number} s.targetX/targetY       - target position, px
 * @param {number} s.targetVX/targetVY     - target velocity, px/sec
 * @param {number} s.cursorX/cursorY       - player cursor/crosshair position, px
 * @param {number} s.cursorVX/cursorVY     - player cursor velocity, px/sec (recent)
 * @param {number} s.boardW/boardH         - board dimensions, px
 * @param {number} s.msSinceSpawn          - time since this duel target appeared
 * @param {number} s.avgReactionTimeMs     - player's average reaction time (Phase 2 profile), ms
 * @param {number} s.recentImmediateShotFrac - fraction of recent shots that were "fast" (Phase 2), 0..1
 * @returns {number[]} length-14 input vector
 */
function encodeAimNeuralState(s) {
  const boardDiag = Math.hypot(s.boardW, s.boardH) || 1;
  const maxSpeed = 400; // px/sec, soft normalization ceiling for velocities

  const dx = (s.cursorX - s.targetX) / boardDiag;
  const dy = (s.cursorY - s.targetY) / boardDiag;
  const dist = Math.hypot(s.cursorX - s.targetX, s.cursorY - s.targetY) / boardDiag;

  // "Approaching" signal: positive if the cursor's velocity vector points
  // roughly toward the target, negative if moving away. Computed via the
  // dot product of cursor velocity and the (target - cursor) direction.
  const toTargetX = s.targetX - s.cursorX;
  const toTargetY = s.targetY - s.cursorY;
  const toTargetLen = Math.hypot(toTargetX, toTargetY) || 1;
  const cursorSpeed = Math.hypot(s.cursorVX, s.cursorVY);
  const approaching = cursorSpeed < 1 ? 0 :
    ((s.cursorVX * toTargetX + s.cursorVY * toTargetY) / toTargetLen) / maxSpeed;

  return [
    s.targetX / s.boardW,                                   // 1: target x, 0..1
    s.targetY / s.boardH,                                   // 2: target y, 0..1
    clampNorm(s.targetVX / maxSpeed),                        // 3: target vx
    clampNorm(s.targetVY / maxSpeed),                        // 4: target vy
    clampNorm(dx),                                           // 5: cursor x relative to target
    clampNorm(dy),                                           // 6: cursor y relative to target
    clampNorm(s.cursorVX / maxSpeed),                        // 7: cursor vx
    clampNorm(s.cursorVY / maxSpeed),                        // 8: cursor vy
    clampNorm(dist),                                         // 9: normalized distance cursor<->target
    clampNorm(approaching),                                  // 10: cursor approaching (+) or retreating (-) target
    clampNorm(s.msSinceSpawn / 2000),                        // 11: time since target appeared (caps ~2s)
    clampNorm((s.avgReactionTimeMs || 600) / 1200),          // 12: player's typical reaction time (Phase 2)
    clampNorm(s.recentImmediateShotFrac || 0),                // 13: recent fast-shot tendency (Phase 2)
    1.0                                                       // 14: bias-like constant input (lets the net learn a baseline offset per action easily)
  ];
}

function clampNorm(v) {
  return Math.max(-1, Math.min(1, v));
}

const AIM_NEURAL_ACTIONS = ['STAY', 'LEFT', 'RIGHT', 'UP', 'DOWN'];

/**
 * Chooses an action index using epsilon-greedy over the network's output.
 * Exploration is bounded (spec §15: "random movement should not dominate").
 * Returns { actionIndex, actionName, outputs, wasExploration }.
 */
function chooseAimNeuralAction(brain, inputVector, epsilon) {
  const outputs = brain.predict(inputVector);

  if (Math.random() < epsilon) {
    const actionIndex = Math.floor(Math.random() * AIM_NEURAL_ACTIONS.length);
    return { actionIndex, actionName: AIM_NEURAL_ACTIONS[actionIndex], outputs, wasExploration: true };
  }

  let bestIndex = 0;
  for (let i = 1; i < outputs.length; i++) {
    if (outputs[i] > outputs[bestIndex]) bestIndex = i;
  }
  return { actionIndex: bestIndex, actionName: AIM_NEURAL_ACTIONS[bestIndex], outputs, wasExploration: false };
}

/**
 * Converts a discrete action into a movement delta, ALREADY clamped to
 * the fairness/safety limits (spec §26: deterministic constraints live
 * outside the network; the network only picks a direction, this function
 * enforces the magnitude). The network can never request more than this.
 *
 * @param {string} actionName - one of AIM_NEURAL_ACTIONS
 * @returns {{dx:number, dy:number}} movement delta in px for this decision tick
 */
function decodeAimNeuralMovement(actionName) {
  const step = AIM_NEURAL_CONFIG.MAX_MOVE_PER_DECISION;
  switch (actionName) {
    case 'LEFT': return { dx: -step, dy: 0 };
    case 'RIGHT': return { dx: step, dy: 0 };
    case 'UP': return { dx: 0, dy: -step };
    case 'DOWN': return { dx: 0, dy: step };
    default: return { dx: 0, dy: 0 }; // STAY
  }
}

/** Clamps a proposed target position to stay within the board, minus a margin for the target radius. */
function clampAimNeuralPosition(x, y, boardW, boardH, radius) {
  const margin = radius * 1.2;
  return {
    x: Math.max(margin, Math.min(boardW - margin, x)),
    y: Math.max(margin, Math.min(boardH - margin, y))
  };
}

/**
 * Computes the epsilon (exploration rate) for the current shot count,
 * decaying linearly from EPSILON_START to EPSILON_MIN.
 */
function computeAimNeuralEpsilon(shotsObservedThisRun) {
  const cfg = AIM_NEURAL_CONFIG;
  const decayed = cfg.EPSILON_START - shotsObservedThisRun * cfg.EPSILON_DECAY_PER_SHOT;
  return Math.max(cfg.EPSILON_MIN, decayed);
}

/* ---------------------------------------------------------------------
   REWARD FUNCTION (spec §6-8): counterfactual-aware, movement-penalized.
   Pure function: given the outcome facts, returns a single reward value
   and a small breakdown for debugging. Does NOT look at anything from
   AFTER the shot other than the shot's own hit/miss results (spec §27 --
   this is the "learning from the result is allowed after the event"
   part, not retroactive influence on the event itself).
   --------------------------------------------------------------------- */

/**
 * @param {Object} p
 * @param {boolean} p.baselineWouldBeHit - would the passive/no-AI-movement position have been hit?
 * @param {boolean} p.actualWasHit       - was the actual (network-controlled) position hit?
 * @param {number} p.movementDistance    - total px the AI moved during this target's lifetime (since spawn or since last shot)
 * @param {boolean} p.wasAlreadyMovingAwayBeforeShot - did the AI start evasive movement before the click happened (genuine prediction, not post-hoc)?
 * @returns {{ reward: number, caseLabel: 'A_failed_evasion'|'B_genuine_evasion'|'C_unnecessary_movement'|'C_correct_stillness', breakdown: Object }}
 */
function computeAimNeuralReward({ baselineWouldBeHit, actualWasHit, movementDistance, wasAlreadyMovingAwayBeforeShot }) {
  const cfg = AIM_NEURAL_CONFIG;
  const breakdown = {};
  let reward = 0;
  let caseLabel;

  if (baselineWouldBeHit && actualWasHit) {
    // Case A: the AI needed to evade and failed.
    caseLabel = 'A_failed_evasion';
    reward = cfg.HIT_PENALTY;
    breakdown.hitPenalty = cfg.HIT_PENALTY;
  } else if (baselineWouldBeHit && !actualWasHit) {
    // Case B: genuine successful evasion. Reward shrinks as movement grows.
    caseLabel = 'B_genuine_evasion';
    const movementPenalty = movementDistance * cfg.MOVEMENT_DISTANCE_PENALTY_SCALE;
    const minimalMovementBonus = cfg.MINIMAL_MOVEMENT_BONUS_MAX * Math.max(0, 1 - movementDistance / (cfg.MAX_MOVE_PER_DECISION * 4));
    const predictionBonus = wasAlreadyMovingAwayBeforeShot ? cfg.PREDICTION_BONUS : 0;
    reward = cfg.EVASION_BASE_REWARD + minimalMovementBonus + predictionBonus - movementPenalty;
    breakdown.evasionBase = cfg.EVASION_BASE_REWARD;
    breakdown.minimalMovementBonus = minimalMovementBonus;
    breakdown.predictionBonus = predictionBonus;
    breakdown.movementPenalty = -movementPenalty;
  } else if (!baselineWouldBeHit && movementDistance > cfg.MAX_MOVE_PER_DECISION * 0.5) {
    // Case C (moved): the shot was never actually a threat, but the AI
    // moved anyway -- this is exactly the "panic movement" spec §7/§8
    // wants discouraged.
    caseLabel = 'C_unnecessary_movement';
    const movementPenalty = movementDistance * cfg.MOVEMENT_DISTANCE_PENALTY_SCALE;
    reward = cfg.UNNECESSARY_MOVE_PENALTY - movementPenalty;
    breakdown.unnecessaryMovePenalty = cfg.UNNECESSARY_MOVE_PENALTY;
    breakdown.movementPenalty = -movementPenalty;
  } else {
    // Case C (stayed): the shot was never a threat, and the AI correctly
    // stayed still. Small positive reward reinforces "don't move unless needed".
    caseLabel = 'C_correct_stillness';
    reward = cfg.STILLNESS_REWARD;
    breakdown.stillnessReward = cfg.STILLNESS_REWARD;
  }

  reward = Math.max(-cfg.REWARD_CLAMP, Math.min(cfg.REWARD_CLAMP, reward));
  return { reward, caseLabel, breakdown };
}

/* ---------------------------------------------------------------------
   ONLINE LEARNING (see the big header comment for exactly what this is
   and isn't). Nudges only the output-layer weights/bias feeding the
   node for the action that was actually taken, in proportion to reward.
   --------------------------------------------------------------------- */

/**
 * @param {NeuralNetwork} brain
 * @param {number[]} inputVectorAtDecisionTime - the SAME input vector used to choose the action (not recomputed later)
 * @param {number} actionIndex - which output node was chosen
 * @param {number} reward - already clamped
 */
function trainAimNeuralStep(brain, inputVectorAtDecisionTime, actionIndex, reward) {
  const cfg = AIM_NEURAL_CONFIG;
  const lastLayerIndex = brain.weights.length - 1;

  // Re-run the forward pass to get the hidden-layer activations that fed
  // the output layer (NeuralNetwork.predict() doesn't expose intermediate
  // activations, so we recompute the same deterministic pass here rather
  // than modifying the shared neural-network.js module).
  let activations = inputVectorAtDecisionTime;
  for (let layer = 0; layer < lastLayerIndex; layer++) {
    const w = brain.weights[layer];
    const b = brain.biases[layer];
    const next = new Array(w.length);
    for (let n = 0; n < w.length; n++) {
      let sum = b[n];
      for (let i = 0; i < w[n].length; i++) sum += w[n][i] * activations[i];
      next[n] = Math.tanh(sum);
    }
    activations = next;
  }
  const hiddenActivations = activations; // input to the output layer

  // Nudge only row [actionIndex] of the output layer's weights, plus its
  // bias -- i.e. only the parameters that directly produced the chosen
  // action's logit. Positive reward pushes those weights further in the
  // direction of the (positively-correlated) hidden activation that
  // produced them; negative reward pushes the opposite way. This is the
  // "reward-weighted perturbation" described at the top of this file.
  const outputWeights = brain.weights[lastLayerIndex][actionIndex];
  for (let i = 0; i < outputWeights.length; i++) {
    outputWeights[i] += cfg.LEARNING_RATE * reward * hiddenActivations[i];
  }
  brain.biases[lastLayerIndex][actionIndex] += cfg.LEARNING_RATE * reward;
}

/** Convenience: builds a fresh NeuralNetwork with Neural Duel's fixed architecture. */
function createAimNeuralBrain() {
  return new NeuralNetwork([
    AIM_NEURAL_CONFIG.INPUT_SIZE,
    ...AIM_NEURAL_CONFIG.HIDDEN_SIZES,
    AIM_NEURAL_CONFIG.OUTPUT_SIZE
  ]);
}

/* ---------------------------------------------------------------------
   CHECKPOINT PERSISTENCE (own storage key -- mirrors ai-storage.js's
   shape/pattern without modifying that Snake-specific module).
   --------------------------------------------------------------------- */

function loadAimNeuralCheckpoint() {
  try {
    const raw = localStorage.getItem(AIM_NEURAL_CONFIG.CHECKPOINT_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.modelVersion !== AIM_NEURAL_CONFIG.MODEL_VERSION) return null;
    return data;
  } catch (e) {
    console.warn('[Neural Duel] Failed to load checkpoint:', e.message);
    return null;
  }
}

function saveAimNeuralCheckpoint(brain, stats) {
  try {
    const toSave = {
      modelVersion: AIM_NEURAL_CONFIG.MODEL_VERSION,
      weights: brain.toJSON(),
      stats: stats || {}
    };
    localStorage.setItem(AIM_NEURAL_CONFIG.CHECKPOINT_STORAGE_KEY, JSON.stringify(toSave));
    return true;
  } catch (e) {
    console.warn('[Neural Duel] Failed to save checkpoint:', e.message);
    return false;
  }
}

function resetAimNeuralCheckpoint() {
  try {
    localStorage.removeItem(AIM_NEURAL_CONFIG.CHECKPOINT_STORAGE_KEY);
    return true;
  } catch (e) {
    console.warn('[Neural Duel] Failed to reset checkpoint:', e.message);
    return false;
  }
}
