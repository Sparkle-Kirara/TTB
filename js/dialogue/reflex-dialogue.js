/* =====================================================================
   REFLEX-DIALOGUE.JS — Content for Game #9 ("Don't Trust the Signal")
   =====================================================================
   Pure content. reflex.js only knows how to pick from these pools (via
   Dialogue.pick when available) and render the chosen line -- it has no
   AI lines of its own.

   Per spec section 11: dialogue is occasional and context-sensitive, NOT
   constant. reflex.js decides WHEN to speak (see shouldReflexAiSpeak())
   and WHICH pool fits the moment; this file only supplies the lines.
   ===================================================================== */

const REFLEX_DIALOGUE = {
  // Player tapped a valid signal unusually fast (impulsive reaction).
  tooFast: [
    "Calm down.",
    "You don't have to attack everything.",
    "Easy there."
  ],

  // Player correctly reacted, but slower than their own average.
  tooSlow: [
    "Were you sleeping?",
    "Eventually.",
    "Any day now."
  ],

  // Player tapped a fake signal (the core "gotcha" moment).
  fellForFake: [
    "You really trusted that?",
    "I showed you NOTHING.",
    "That wasn't even close to real."
  ],

  // Player missed a valid signal (let the window expire without tapping).
  missedValid: [
    "It was right there.",
    "You just... didn't.",
    "That one was free."
  ],

  // Milestone streak lines (spec: "long streak").
  longStreak: [
    "Okay... you're getting annoying.",
    "Still going, huh.",
    "This is getting suspicious."
  ],

  // Several recent mistakes in a short span.
  repeatMistakes: [
    "I'm starting to understand you.",
    "That's twice now.",
    "Pattern noticed."
  ],

  // The AI just deliberately targeted a detected habit and it worked.
  exploitedHabit: [
    "Predictable.",
    "Called it.",
    "You always do that."
  ],

  // Player is doing unusually well overall (high accuracy, decent length run).
  impressed: [
    "...Okay. That was actually impressive.",
    "Huh. Not bad.",
    "Alright, I'll give you that."
  ],

  countdown: ["Ready?", "Here we go.", "Watch closely."]
};

/**
 * Game-over line, picked by whether this run beat the stored best score.
 * {score} / {best} / {reaction} are replaced by reflex.js.
 */
const REFLEX_ENDINGS = {
  newBest: "\"New best. Fine, that one was good.\"",
  normal: "\"Game over.\"\n\nScore {score}. Best is still {best}.",
  first: "\"Game over.\"\n\nFirst run: {score}. Now you have something to beat."
};
