/* =====================================================================
   AI-STORAGE.JS — Persistence for the Snake AI's learned model
   =====================================================================
   Responsible only for reading/writing the AI's checkpoint data to
   localStorage. Knows nothing about training, gameplay, or dialogue.

   A checkpoint contains more than raw weights (spec PART 13): model
   version, generation, training episode count, best score/fitness seen,
   and the network weights themselves for both the "current" and "best"
   models (spec PART 14 -- a bad generation must not overwrite a
   previously-better model).
   ===================================================================== */

const AI_STORAGE_CONFIG = {
  STORAGE_KEY: 'ttb_snake_ai_checkpoint',
  MODEL_VERSION: 1
};

/**
 * @typedef {Object} SnakeAiCheckpoint
 * @property {number} modelVersion
 * @property {number} generation
 * @property {number} gamesTrained
 * @property {number} bestScore
 * @property {number} bestFitness
 * @property {Object} currentModelWeights - NeuralNetwork.toJSON() of the current (most recent) model
 * @property {Object} bestModelWeights - NeuralNetwork.toJSON() of the best-ever model
 * @property {Object} trainingStats - small free-form stats bag (avgFitness/avgScore history tail, etc.)
 */

/** Loads the checkpoint from localStorage, or null if none exists yet. */
function loadAiCheckpoint() {
  try {
    const raw = localStorage.getItem(AI_STORAGE_CONFIG.STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);

    if (data.modelVersion !== AI_STORAGE_CONFIG.MODEL_VERSION) {
      // A future step could migrate old checkpoints here. For now, an
      // incompatible version is treated the same as "no checkpoint" --
      // safer than trying to load weights into a different architecture.
      console.warn('[Snake AI] Checkpoint version mismatch, ignoring old checkpoint.');
      return null;
    }

    return data;
  } catch (e) {
    console.warn('[Snake AI] Failed to load checkpoint:', e.message);
    return null;
  }
}

/** Saves a checkpoint object to localStorage. */
function saveAiCheckpoint(checkpoint) {
  try {
    const toSave = { ...checkpoint, modelVersion: AI_STORAGE_CONFIG.MODEL_VERSION };
    localStorage.setItem(AI_STORAGE_CONFIG.STORAGE_KEY, JSON.stringify(toSave));
    console.log(`[Snake AI] Checkpoint saved (generation ${checkpoint.generation}, bestScore ${checkpoint.bestScore})`);
    return true;
  } catch (e) {
    console.warn('[Snake AI] Failed to save checkpoint:', e.message);
    return false;
  }
}

/** Removes the saved checkpoint entirely (spec PART 15: Reset AI). */
function resetAiCheckpoint() {
  try {
    localStorage.removeItem(AI_STORAGE_CONFIG.STORAGE_KEY);
    console.log('[Snake AI] Checkpoint reset.');
    return true;
  } catch (e) {
    console.warn('[Snake AI] Failed to reset checkpoint:', e.message);
    return false;
  }
}

/** Builds a fresh, empty checkpoint shape (used when no saved data exists). */
function createEmptyCheckpoint() {
  return {
    modelVersion: AI_STORAGE_CONFIG.MODEL_VERSION,
    generation: 0,
    gamesTrained: 0,
    bestScore: 0,
    bestFitness: 0,
    currentModelWeights: null,
    bestModelWeights: null,
    trainingStats: {}
  };
}
