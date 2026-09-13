/* =====================================================================
   GAME5-DIALOGUE.JS — Dialogue content for Game #5 (Trust Me)
   =====================================================================
   Pure content. trust-me.js decides WHAT happened (guess closeness,
   behavior pattern, win/loss, streaks, level progression) and calls
   Dialogue.pick() on the appropriate pool below.
   ===================================================================== */

const GAME5_DIALOGUE = {
  opening: [
    "Let's see what you've got.",
    "Pick a number.",
    "Go ahead. Surprise me.",
    "This should be interesting.",
    "Your move.",
    "Try not to embarrass yourself.",
    "Alright, impress me."
  ],

  far: [
    "That wasn't even close.",
    "Were you guessing or just clicking?",
    "Bold strategy.",
    "You're going to need a better idea than that.",
    "That's... a number. Sure."
  ],

  close: [
    "Getting warmer.",
    "Okay, you're getting somewhere.",
    "Not bad.",
    "You're circling it now."
  ],

  veryClose: [
    "Okay... that was actually good.",
    "Now you're getting it.",
    "One away. Don't mess this up.",
    "So close I can feel it."
  ],

  // --- Behavioral: pattern detection ---
  random: [
    "Do you have a strategy?",
    "Because I can't find it.",
    "Are you guessing or exploring?",
    "Interesting approach. Very... chaotic."
  ],

  sameDirection: [
    "You really like going that way, huh?",
    "You're committed to that direction, huh?",
    "Maybe try thinking instead of marching."
  ],

  tinySteps: [
    "One number at a time?",
    "You're taking the scenic route.",
    "You know you can make bigger moves, right?"
  ],

  binarySearch: [
    "Okay... you're actually using logic.",
    "That's a pretty good strategy.",
    "Now we're playing seriously.",
    "You're narrowing that range fast."
  ],

  strategyShift: [
    "Oh? New strategy?",
    "Finally figured something out?",
    "Changing tactics now?"
  ],

  impressed: [
    "Okay, you're good.",
    "I'll admit it. That was smart.",
    "That was actually impressive.",
    "You're getting annoyingly good at this.",
    "Okay... respect.",
    "Maybe I underestimated you."
  ],

  // --- Win/loss outcomes ---
  winSlow: [
    "Eventually.",
    "You got it.",
    "Finally."
  ],

  winAverage: [
    "Not bad.",
    "Okay, I'll give you that one.",
    "That was actually pretty good."
  ],

  winEfficient: [
    "Okay, that was good.",
    "Alright, I'm impressed.",
    "You're narrowing that range fast."
  ],

  winFirstTry: [
    "First try?!",
    "...Seriously?",
    "Okay, I wasn't expecting that."
  ],

  winStreak: [
    "Okay, that wasn't luck.",
    "Alright, stop showing off.",
    "You're getting annoyingly good at this."
  ],

  loss: [
    "Out of guesses.",
    "You were getting there. Sort of.",
    "Close enough... except it wasn't.",
    "You almost had it.",
    "Maybe next time."
  ],

  // --- Level progression / pacing commentary ---
  levelUp: [
    "New range. Good luck.",
    "Let's raise the stakes.",
    "Onward. It gets harder from here."
  ],

  fastDecision: [
    "That was fast.",
    "No hesitation, huh?",
    "Confident guess."
  ],

  slowDecision: [
    "Take your time. Really.",
    "Still thinking?",
    "No rush. I've got all day."
  ]
};
