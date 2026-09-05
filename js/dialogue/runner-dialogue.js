/* =====================================================================
   RUNNER-DIALOGUE.JS — Content for Game #10 ("Run From AI")
   =====================================================================
   Pure content. runner.js only knows how to pick from these pools (via
   Dialogue.pick when available) and render the chosen line -- it has no
   AI lines of its own.

   Per spec section 13: dialogue is occasional, not constant. runner.js
   decides WHEN to speak (rate-limited, only at meaningful moments) and
   WHICH pool fits; this file only supplies the lines.
   ===================================================================== */

const RUNNER_DIALOGUE = {
  // Player has spent a long stretch in one lane without switching.
  comfortZone: [
    "Comfort zone?",
    "You really don't want to move, huh.",
    "Staying put. Bold."
  ],

  // Player shows a strong lean toward one particular lane over time.
  laneObsession: {
    LEFT: ["You really like the left side.", "Left again. Of course."],
    CENTER: ["Middle lane loyalist.", "Always the center. Noted."],
    RIGHT: ["Right side, every time.", "You've picked a favorite."]
  },

  // Player alternates lanes in a simple, predictable rhythm.
  alternating: [
    "Left. Right. Left. Right. Pick one.",
    "That's a pattern. I noticed.",
    "Very rhythmic. Very predictable."
  ],

  // AI has detected a genuine shift in the player's habits.
  behaviorChange: [
    "...Interesting.",
    "Oh, that's new.",
    "Changing it up now?"
  ],

  // Player successfully adjusts after the AI starts targeting a habit.
  adaptedWell: [
    "Okay. You adapted.",
    "Fine. That actually worked.",
    "...Not bad."
  ],

  // Player has survived a notably long stretch.
  longSurvival: [
    "You're making this difficult.",
    "Still going.",
    "Okay, this is taking a while."
  ],

  // Right at the moment of collision.
  death: [
    "I knew you'd go there.",
    "Called it.",
    "There it is."
  ],

  runStart: ["Let's see how you move.", "Go."]
};

/**
 * Game-over line, picked by whether this run beat the stored best
 * distance. {distance} / {best} are replaced by runner.js.
 */
const RUNNER_ENDINGS = {
  newBest: "\"New best. Fine, that one was good.\"",
  normal: "\"Game over.\"\n\n{distance}m. Best is still {best}m.",
  first: "\"Game over.\"\n\nFirst run: {distance}m. Now you have something to beat."
};
