/* =====================================================================
   GAME7-DIALOGUE.JS — Content for Game #7 (Don't Blink)
   =====================================================================
   Pure content. dont-blink.js only knows how to pick from these pools
   (via Dialogue.pick when available) and render the chosen line -- it
   has no AI lines of its own.

   This game has no branching story, so unlike wake-up-dialogue.js there
   are no "scenes" -- just flat pools of lines keyed by moment/behavior,
   matching the shape already used by earlier games (see game5-dialogue.js
   for the sibling pattern this follows).
   ===================================================================== */

const GAME7_DIALOGUE = {
  // Said right before the observation window starts, each round.
  observe: [
    "Don't blink.",
    "Watch carefully.",
    "Try to remember this.",
    "Look closely.",
    "Pay attention now."
  ],

  // Occasionally shown during harder rounds, layered on top of `observe`.
  duringHard: [
    "This one's easy.",
    "...Probably.",
    "Shouldn't be too bad.",
    "You'll be fine. Maybe."
  ],

  correct: [
    "Nice.",
    "You actually noticed.",
    "Okay, that was good.",
    "Sharp eyes.",
    "There you go."
  ],

  wrong: [
    "You blinked, didn't you?",
    "It was right there.",
    "Seriously?",
    "Maybe look next time.",
    "...Close. Not really. But close-ish."
  ],

  // Behavior-aware yaps (spec section 5), layered after the base
  // correct/wrong line above, not a replacement for it.
  fastCorrect: ["That was fast.", "Suspiciously fast."],
  slowCorrect: ["Eventually.", "But I'll give you that one."],
  streak: ["Okay, okay.", "You're getting good at this."],
  repeatMistakes: ["Do you actually look at the screen?", "The changes are right there, you know."],
  fastWrong: ["Are you even thinking?", "That wasn't even a guess, that was a reflex."],

  // Distraction lines (spec section 6). `bait` plays before the visual
  // changes, `dismiss` plays right after -- dont-blink.js is responsible
  // for the timing, this file only supplies the two halves of the line.
  distractionBait: [
    "By the way, did you know that—",
    "Actually, hold on, I was going to say—",
    "Random thought, but—"
  ],
  distractionDismiss: [
    "...Never mind.",
    "...Forget I said anything.",
    "...Anyway. Focus."
  ],

  levelStart: ["Alright. New round.", "Next one.", "Here we go again."],

  gameOverIntro: [
    "Okay, that's enough for now.",
    "And that's a wrap.",
    "Alright, we're done here."
  ]
};

/**
 * Game-over summary lines, picked by final score tier rather than a
 * fixed scene id (there's no branching to key off, unlike Wake Up).
 */
const GAME7_ENDINGS = {
  low: {
    title: "GAME OVER",
    closingLines: "\"You blinked a lot.\"\n\nRound {round} of Don't Blink. There's always another try."
  },
  mid: {
    title: "GAME OVER",
    closingLines: "\"Not bad. Not great. Not bad.\"\n\nYou made it to round {round}. The AI is cautiously impressed."
  },
  high: {
    title: "GAME OVER",
    closingLines: "\"Okay. Actually impressive.\"\n\nRound {round}. You barely blinked at all."
  }
};
