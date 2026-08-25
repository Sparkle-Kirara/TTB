/* =====================================================================
   NEUROEVOLUTION.JS — Headless training for the Snake AI
   =====================================================================
   This module trains populations of NeuralNetworks (js/ai/neural-network.js)
   to play Snake, using a plain genetic algorithm (no backprop, no RL
   framework): evaluate -> select the best -> clone + mutate -> repeat.

   IMPORTANT: this module intentionally reimplements a minimal, PURE
   (no DOM, no audio, no localStorage) version of Snake's movement/
   collision/food rules, separate from js/games/snake.js. This is not
   duplicated gameplay logic in the bad sense -- it's the same core rules
   (collision, food, bounds) with all rendering/sound/storage side effects
   stripped out, which is required to run hundreds of simulations per
   generation without touching the DOM or audio system at all (per spec:
   training must not require full visual rendering and must not freeze
   the page). The single source of truth for the PLAYABLE game remains
   js/games/snake.js; this module only needs to know the same rules.

   Responsibilities:
     - run one full headless Snake game for a given NeuralNetwork ("brain")
     - compute a fitness score for that run
     - run a full generation across a population
     - evolve a population across generations (selection + mutation)
     - yield control back to the browser periodically so the UI doesn't freeze
   ===================================================================== */

const NEUROEVOLUTION_CONFIG = {
  POPULATION_SIZE: 100,
  MUTATION_RATE: 0.1,
  MUTATION_AMOUNT: 0.3,
  ELITE_COUNT: 10,           // top N networks carried over unmutated each generation
  MAX_STEPS_PER_GAME: 500,   // safety cap so a wandering snake can't simulate forever
  MAX_STEPS_WITHOUT_FOOD: 150, // treat prolonged food-less wandering as "done" for this run
  GRID_SIZE: 20,             // mirrors SNAKE_CONFIG.GRID_SIZE; kept independent so this
                             // module has no hard dependency on snake.js loading first
  GAMES_PER_GENERATION_YIELD: 10 // yield to the event loop after this many simulated games
};

/**
 * Runs one full headless Snake game for a single brain and returns
 * { score, fitness, steps }. Pure function: no DOM, no audio, no storage.
 */
function simulateSnakeGame(brain, gridSize = NEUROEVOLUTION_CONFIG.GRID_SIZE) {
  let snakeBody = [
    { x: 7, y: 10 },
    { x: 6, y: 10 },
    { x: 5, y: 10 }
  ];
  let direction = { x: 1, y: 0 };
  let food = spawnFoodForSimulation(snakeBody, gridSize);
  let score = 0;
  let steps = 0;
  let stepsSinceFood = 0;

  while (steps < NEUROEVOLUTION_CONFIG.MAX_STEPS_PER_GAME) {
    const input = encodeSnakeState({
      snakeBody,
      food,
      direction,
      gridSize
    });
    const output = brain.predict(input);
    direction = decodeSnakeAction(output, direction);

    const head = snakeBody[0];
    const newHead = { x: head.x + direction.x, y: head.y + direction.y };

    const hitWall = (newHead.x < 0 || newHead.x >= gridSize || newHead.y < 0 || newHead.y >= gridSize);
    if (hitWall) break;

    const willEatFood = (newHead.x === food.x && newHead.y === food.y);
    const bodyCheckLength = willEatFood ? snakeBody.length : snakeBody.length - 1;
    let hitSelf = false;
    for (let i = 0; i < bodyCheckLength; i++) {
      if (newHead.x === snakeBody[i].x && newHead.y === snakeBody[i].y) {
        hitSelf = true;
        break;
      }
    }
    if (hitSelf) break;

    snakeBody.unshift(newHead);

    if (willEatFood) {
      score += 1;
      stepsSinceFood = 0;
      food = spawnFoodForSimulation(snakeBody, gridSize);
    } else {
      snakeBody.pop();
      stepsSinceFood++;
    }

    steps++;

    // If the snake goes too long without making progress, stop this run --
    // this discourages the "wander forever" degenerate strategy the spec
    // explicitly warns against (survival must not outweigh eating).
    if (stepsSinceFood >= NEUROEVOLUTION_CONFIG.MAX_STEPS_WITHOUT_FOOD) break;
  }

  const fitness = calculateSnakeFitness(score, steps);
  return { score, fitness, steps };
}

function spawnFoodForSimulation(snakeBody, gridSize) {
  const occupied = new Set(snakeBody.map(s => `${s.x},${s.y}`));
  const freeCells = [];
  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      if (!occupied.has(`${x},${y}`)) freeCells.push({ x, y });
    }
  }
  if (freeCells.length === 0) return { x: 0, y: 0 }; // board full (won); degenerate case
  return freeCells[Math.floor(Math.random() * freeCells.length)];
}

/**
 * Fitness rewards food eaten strongly, survival mildly, and does NOT let
 * survival alone outweigh eating -- per spec, an AI that just wanders
 * without eating should score far lower than one that eats and dies
 * reasonably soon after.
 */
function calculateSnakeFitness(score, steps) {
  const foodReward = score * 100;
  const survivalReward = steps * 0.1;
  return foodReward + survivalReward;
}

/** Creates a fresh population of random brains. */
function createPopulation(size = NEUROEVOLUTION_CONFIG.POPULATION_SIZE) {
  const population = [];
  for (let i = 0; i < size; i++) {
    population.push(createSnakeBrain());
  }
  return population;
}

/**
 * Evaluates an entire population (one game each) and returns results
 * sorted by fitness descending: [{ brain, score, fitness, steps }, ...]
 */
function evaluatePopulation(population, gridSize = NEUROEVOLUTION_CONFIG.GRID_SIZE) {
  const results = population.map(brain => {
    const { score, fitness, steps } = simulateSnakeGame(brain, gridSize);
    return { brain, score, fitness, steps };
  });
  results.sort((a, b) => b.fitness - a.fitness);
  return results;
}

/**
 * Produces the next generation from a sorted (fitness descending) result
 * list: keep the elite unmutated, then fill the rest by cloning + mutating
 * parents selected from the elite pool.
 */
function evolvePopulation(sortedResults, config = NEUROEVOLUTION_CONFIG) {
  const nextGen = [];

  const eliteCount = Math.min(config.ELITE_COUNT, sortedResults.length);
  for (let i = 0; i < eliteCount; i++) {
    nextGen.push(sortedResults[i].brain.clone()); // elites carried over unmutated
  }

  while (nextGen.length < config.POPULATION_SIZE) {
    const parent = sortedResults[Math.floor(Math.random() * eliteCount)].brain;
    const child = parent.clone();
    child.mutate(config.MUTATION_RATE, config.MUTATION_AMOUNT);
    nextGen.push(child);
  }

  return nextGen;
}

/**
 * Runs training for a given number of generations, yielding control back
 * to the browser event loop periodically so the UI doesn't freeze (spec
 * PART 19: training must not freeze the page).
 *
 * @param {Object} options
 * @param {number} options.generations - how many generations to run
 * @param {NeuralNetwork[]} [options.initialPopulation] - resume from an existing population; otherwise starts random
 * @param {function} [options.onGenerationComplete] - called after each generation with { generation, best, avgFitness, avgScore }
 * @returns {Promise<{ population: NeuralNetwork[], bestBrain: NeuralNetwork, bestScore: number, bestFitness: number, generationsRun: number }>}
 */
async function runTraining({ generations, initialPopulation, onGenerationComplete } = {}) {
  let population = initialPopulation && initialPopulation.length > 0
    ? initialPopulation
    : createPopulation();

  let bestBrainEver = null;
  let bestScoreEver = -Infinity;
  let bestFitnessEver = -Infinity;

  for (let gen = 0; gen < generations; gen++) {
    const results = evaluatePopulation(population);

    const genBest = results[0];
    const avgFitness = results.reduce((sum, r) => sum + r.fitness, 0) / results.length;
    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

    if (genBest.fitness > bestFitnessEver) {
      bestFitnessEver = genBest.fitness;
      bestScoreEver = genBest.score;
      bestBrainEver = genBest.brain.clone();
    }

    if (typeof onGenerationComplete === 'function') {
      onGenerationComplete({
        generation: gen,
        bestFitness: genBest.fitness,
        bestScore: genBest.score,
        avgFitness,
        avgScore
      });
    }

    population = evolvePopulation(results);

    // Yield to the browser event loop periodically so training doesn't
    // block rendering/input on the rest of the page.
    if (gen % 1 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return {
    population,
    bestBrain: bestBrainEver,
    bestScore: bestScoreEver,
    bestFitness: bestFitnessEver,
    generationsRun: generations
  };
}
