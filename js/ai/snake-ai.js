/* =====================================================================
   SNAKE-AI.JS — Snake-specific state encoding and action mapping
   =====================================================================
   This module is the bridge between the generic NeuralNetwork
   (js/ai/neural-network.js) and the actual Snake game (js/games/snake.js).

   It is responsible for:
     - encoding a raw Snake board state into a fixed-size numeric input
       vector the Neural Network can consume
     - translating the Neural Network's output (a relative turn decision)
       into an absolute board direction

   It does NOT run the game loop, does NOT know about rendering, and does
   NOT know about training/fitness. Those live in js/games/snake.js and
   js/ai/neuroevolution.js respectively.

   The Neural Network is never given the raw canvas or the entire board
   grid -- only this compact sensor representation (spec: no cheating,
   no information beyond what a normal player could reasonably use).
   ===================================================================== */

const SNAKE_AI_CONFIG = {
  INPUT_SIZE: 16,
  HIDDEN_SIZES: [24, 16],
  OUTPUT_SIZE: 3, // [TURN_LEFT, STRAIGHT, TURN_RIGHT]
  VISION_RANGE: 8 // how many cells ahead each directional sensor looks (capped, not board-size-dependent)
};

// The 8 directional sensors, expressed as {x,y} board-space deltas.
// Order is fixed and always the same regardless of the snake's current
// heading -- these are ABSOLUTE board directions, not relative to the
// snake, which keeps the sensor encoding simple and consistent.
const SNAKE_AI_SENSOR_DIRECTIONS = [
  { x: 0, y: -1 },  // N
  { x: 1, y: -1 },  // NE
  { x: 1, y: 0 },   // E
  { x: 1, y: 1 },   // SE
  { x: 0, y: 1 },   // S
  { x: -1, y: 1 },  // SW
  { x: -1, y: 0 },  // W
  { x: -1, y: -1 }  // NW
];

/**
 * Encodes a snake's surroundings into a fixed 16-value input vector.
 *
 * @param {Object} params
 * @param {{x:number,y:number}[]} params.snakeBody - the snake's own body, head first
 * @param {{x:number,y:number}} params.food - food position
 * @param {{x:number,y:number}} params.direction - current movement direction (unit vector)
 * @param {number} params.gridSize - board width/height (assumed square)
 * @param {{x:number,y:number}[]} [params.otherSnakeBody] - opposing snake's body, if any (treated as an obstacle)
 * @returns {number[]} length-16 input vector, values normalized to roughly [-1, 1] or [0, 1]
 */
function encodeSnakeState({ snakeBody, food, direction, gridSize, otherSnakeBody }) {
  const head = snakeBody[0];

  // Build a single obstacle lookup covering walls (implicitly, via bounds
  // checks below), this snake's own body, and the opposing snake's body
  // if present. Both count as "must avoid" -- the network doesn't need to
  // distinguish which kind of obstacle it is, only how far away it is.
  const occupied = new Set();
  for (let i = 1; i < snakeBody.length; i++) { // skip the head itself
    occupied.add(`${snakeBody[i].x},${snakeBody[i].y}`);
  }
  if (otherSnakeBody) {
    for (const seg of otherSnakeBody) {
      occupied.add(`${seg.x},${seg.y}`);
    }
  }

  // 1-8: directional obstacle/space sensors. Each value is the normalized
  // distance to the nearest obstacle (wall or body) in that direction,
  // where 1.0 = completely clear for the full vision range and 0.0 =
  // obstacle immediately adjacent.
  const sensors = SNAKE_AI_SENSOR_DIRECTIONS.map(dir => {
    let cx = head.x;
    let cy = head.y;

    for (let step = 1; step <= SNAKE_AI_CONFIG.VISION_RANGE; step++) {
      cx += dir.x;
      cy += dir.y;

      const hitWall = (cx < 0 || cx >= gridSize || cy < 0 || cy >= gridSize);
      const hitBody = occupied.has(`${cx},${cy}`);

      if (hitWall || hitBody) {
        // Obstacle found at this step. Normalize: 0 = obstacle immediately
        // adjacent (step 1), approaching 1 = obstacle at the edge of vision.
        return (step - 1) / SNAKE_AI_CONFIG.VISION_RANGE;
      }
    }

    // Nothing found within the full vision range -- treat as fully clear.
    return 1.0;
  });

  // 9-12: food direction relative to head, as four independent signals
  // (food is up / down / left / right of the head). Using simple directional
  // flags instead of an angle keeps the encoding easy to reason about and
  // avoids the network needing to learn trigonometry.
  const foodUp = food.y < head.y ? 1 : 0;
  const foodDown = food.y > head.y ? 1 : 0;
  const foodLeft = food.x < head.x ? 1 : 0;
  const foodRight = food.x > head.x ? 1 : 0;

  // 13-16: current direction, one-hot (UP, DOWN, LEFT, RIGHT). This gives
  // the network the context it needs to translate its relative-turn output
  // (TURN_LEFT/STRAIGHT/TURN_RIGHT) correctly, and to avoid oscillating.
  const dirUp = (direction.x === 0 && direction.y === -1) ? 1 : 0;
  const dirDown = (direction.x === 0 && direction.y === 1) ? 1 : 0;
  const dirLeft = (direction.x === -1 && direction.y === 0) ? 1 : 0;
  const dirRight = (direction.x === 1 && direction.y === 0) ? 1 : 0;

  return [
    ...sensors,
    foodUp, foodDown, foodLeft, foodRight,
    dirUp, dirDown, dirLeft, dirRight
  ];
}

function decodeSnakeAction(outputs, currentDirection) {
  const actionIndex = outputs.indexOf(Math.max(...outputs)); // 0=left, 1=straight, 2=right

  // Rotate the current direction vector 90 degrees left or right.
  // Left turn: (x,y) -> (y, -x). Right turn: (x,y) -> (-y, x).
  if (actionIndex === 0) {
    return { x: currentDirection.y, y: -currentDirection.x };
  } else if (actionIndex === 2) {
    return { x: -currentDirection.y, y: currentDirection.x };
  }
  return { x: currentDirection.x, y: currentDirection.y }; // straight
}

/** Convenience: builds a fresh NeuralNetwork with Snake AI's fixed architecture. */
function createSnakeBrain() {
  return new NeuralNetwork([
    SNAKE_AI_CONFIG.INPUT_SIZE,
    ...SNAKE_AI_CONFIG.HIDDEN_SIZES,
    SNAKE_AI_CONFIG.OUTPUT_SIZE
  ]);
}
