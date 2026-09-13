/* =====================================================================
   PHYSICS-DIALOGUE.JS — Content for Game #11 ("Don't Drop It")
   =====================================================================
   Pure content. physics.js only knows how to pick from these pools (via
   Dialogue.pick when available) and render the chosen line -- it has no
   AI lines of its own.

   Per spec section 10: dialogue is sparse, not constant. physics.js
   decides WHEN to speak (rate-limited, only at meaningful moments) and
   WHICH pool fits; this file only supplies the lines.
   ===================================================================== */

const PHYSICS_DIALOGUE = {
  // Player is holding a direction hard / moving at high speed.
  tooAggressive: [
    "Easy.",
    "You don't need to full-send every move.",
    "Careful."
  ],

  // Player reverses direction very frequently (over-correcting).
  overCorrecting: [
    "You really don't trust your own movement.",
    "Pick a direction.",
    "That's a lot of second-guessing."
  ],

  // Player barely lands on a platform edge / narrowly avoids falling.
  closeCall: [
    "That was close.",
    "Barely.",
    "You felt that one, didn't you."
  ],

  // AI has detected a repeated habit (e.g. panicking near gaps, favoring one side).
  habitDetected: [
    "You always panic there.",
    "You do this every time.",
    "I've seen this before."
  ],

  // Player changes their approach after the AI starts adjusting to them.
  adapted: [
    "...You changed your strategy.",
    "Huh. Different approach.",
    "That's new."
  ],

  // Player has survived a notably long stretch.
  longSurvival: [
    "Okay. You're getting good at this.",
    "Still going.",
    "This is taking a while."
  ],

  // Right at the moment of falling/crashing.
  death: [
    "That was... avoidable.",
    "You had time.",
    "Well. That happened."
  ],

  runStart: ["Don't drop it.", "Here we go."]
};

/**
 * Game-over line, picked by whether this run beat the stored best
 * distance. {distance} / {best} are replaced by physics.js.
 */
const PHYSICS_ENDINGS = {
  newBest: "\"New best. Fine, that one was good.\"",
  normal: "\"Game over.\"\n\n{distance}m. Best is still {best}m.",
  first: "\"Game over.\"\n\nFirst run: {distance}m. Now you have something to beat."
};
