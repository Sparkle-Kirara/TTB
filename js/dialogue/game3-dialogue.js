/* =====================================================================
   GAME3-DIALOGUE.JS — Dialogue content for Game #3 (Where Is It?)
   =====================================================================
   Pure content. where-is-it.js decides WHAT happened (fast/slow correct
   guess, wrong guess, repeated wrong guesses, recovery after failure,
   level progression) and calls Dialogue.pick() on the appropriate pool
   below.
   ===================================================================== */

const GAME3_DIALOGUE = {
  correctFast: [
    "That was fast.",
    "You're actually paying attention.",
    "No hesitation. I like that.",
    "Instant. Nicely done."
  ],

  correctNormal: [
    "Correct.",
    "There it is.",
    "You got it.",
    "Nice tracking."
  ],

  correctSlow: [
    "Took you a while, but you got there.",
    "A little hesitant, but correct.",
    "Better late than wrong."
  ],

  correctAfterFailure: [
    "Finally.",
    "There we go. Redemption.",
    "Okay, back on track.",
    "You're getting better."
  ],

  wrong: [
    "Not even close.",
    "You really thought that was it?",
    "Nope. Try again.",
    "Wrong cup. Watch closer next time."
  ],

  repeatedWrong: [
    "That's twice now.",
    "Struggling a bit today, huh?",
    "Okay, let's slow down and focus.",
    "This is becoming a pattern."
  ],

  levelUp: [
    "Level up. It gets trickier from here.",
    "Nice work. Let's speed things up.",
    "Onward. Pay closer attention now."
  ],

  hesitation: [
    "Take your time. No rush.",
    "Still deciding?",
    "Any day now."
  ]
};
