/* =====================================================================
   SNAKE-DIALOGUE.JS — Dialogue content for Game #2 (Snake)
   =====================================================================
   Pure content. snake.js decides WHAT happened (apple eaten, warning
   stage reached, Death Zone entered, near-death escape, game over,
   milestone score, repeated deaths) and calls Dialogue.pick() on the
   appropriate pool below.

   Two families of dialogue, kept conceptually separate (spec section 14
   of the Apple Timeout task, preserved here):
     - AI yapping: only shown while the AI plays solo in "Not me" mode.
     - System messages: Apple Timeout warnings/countdown, shown in BOTH
       "Me" and "Not me" modes since the mechanic applies to both.
   ===================================================================== */

const SNAKE_AI_DIALOGUE = {
  opening: [
    "Watch and learn.",
    "This is how it's done.",
    "Let me show you something.",
    "Front row seat to greatness.",
    "Pay attention. This is educational.",
    "Let's see how this goes."
  ],

  milestone: [
    "Easy.",
    "Was there ever any doubt?",
    "I could do this all day.",
    "Getting good at this, huh? Me, I mean.",
    "Just another day at the office.",
    "Barely broke a sweat. Metaphorically."
  ],

  gameOver: [
    "Okay, that was a mistake.",
    "...We don't talk about that one.",
    "Even I have off days.",
    "That wasn't my best work.",
    "Rude. The wall moved.",
    "In my defense, the board is small.",
    "That one doesn't count."
  ],

  // --- Score gap commentary (compares this run's score against the player's best) ---
  beatingPlayerBest: [
    "Beating your best score. No pressure.",
    "This is already better than your record.",
    "Your best score is in trouble."
  ],

  strugglingVsPlayerBest: [
    "Your best score is safe. For now.",
    "Still behind your record. Working on it.",
    "This run isn't quite there yet."
  ],

  // --- Repeated deaths (multiple GAME_OVER results in a row for the AI) ---
  repeatedFailures: [
    "Okay, that's twice now. Let's not make it three.",
    "This is becoming a pattern. A bad one.",
    "I'm starting to see a trend here. Not a good one.",
    "Again? Really?"
  ],

  // --- Near-death escape (Death Zone almost caught it) ---
  nearDeathEscape: [
    "Okay, that was close.",
    "Cutting it a little close there.",
    "Nearly didn't make that.",
    "That was closer than I'd like to admit."
  ]
};

const SNAKE_SYSTEM_DIALOGUE = {
  warn30: [
    "Eat the apple.",
    "The apple is right there.",
    "You forgot what food is?",
    "Maybe eat the apple?",
    "Any day now.",
    "The apple isn't going to walk to you."
  ],

  warn40: [
    "Still not eating?",
    "It's not going to eat itself.",
    "Are you planning to starve?",
    "This is taking a while.",
    "The apple is still there. Waiting."
  ],

  warn50: [
    "Okay. Ten seconds.",
    "Last warning.",
    "You really want to test this?",
    "Ten seconds. Starting now.",
    "This is your last chance."
  ],

  countdownHigh: [ // roughly 10-6 seconds remaining
    "Don't say I didn't warn you."
  ],

  countdownLow: [ // roughly 5-2 seconds remaining
    "This is your problem now."
  ]
};
