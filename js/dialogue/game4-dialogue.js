/* =====================================================================
   GAME4-DIALOGUE.JS — Dialogue content for Game #4 (Don't Get Caught)
   =====================================================================
   Pure content. dont-get-caught.js decides WHAT happened (near miss,
   escape, catch, goal reached, win/loss streaks, repeated movement,
   direction changes, fast/slow completions, AI mistakes) and calls
   Dialogue.pick() on the appropriate pool below.

   IMPORTANT: this file is personality content only. It has no influence
   on the AI's chase behavior (axis-priority BFS + controlled imperfection
   in dont-get-caught.js) -- that logic is untouched by this task.
   ===================================================================== */

const GAME4_DIALOGUE = {
  // --- Reactive: immediate, in-the-moment reactions ---
  playerStartsMoving: [
    "Let's see where this goes.",
    "Oh, we're doing this now.",
    "Alright, moving already. Bold.",
    "Here we go."
  ],

  playerMovesTowardGoal: [
    "Straight for the goal, huh?",
    "Confident, aren't you.",
    "That's one way to do it."
  ],

  playerMovesAwayFromGoal: [
    "Wrong way.",
    "That's... not toward the goal.",
    "Interesting detour.",
    "Are you lost?"
  ],

  aiStartsChasing: [
    "Here I come.",
    "Let's go.",
    "Time to get to work."
  ],

  aiGetsClose: [
    "Getting closer.",
    "I can almost taste it.",
    "This won't take long.",
    "Nowhere left to run."
  ],

  nearMiss: [
    "So close.",
    "Almost had you.",
    "That was closer than it looked.",
    "One more step and that would've been it."
  ],

  playerEscapes: [
    "Stop doing that.",
    "Okay, that was actually good.",
    "You got lucky.",
    "Again?",
    "You're getting annoying.",
    "Fine. Round two."
  ],

  playerReachesGoal: [
    "You actually made it?",
    "Fine. You win.",
    "Don't get too excited.",
    "I definitely meant to let you through.",
    "Okay, that was well played."
  ],

  aiCatchesPlayer: [
    "Got you.",
    "Too slow.",
    "That was predictable.",
    "Where did you think you were going?",
    "And that's that."
  ],

  // --- Behavioral: pattern detection ---
  playerEscapesRepeatedly: [
    "You keep getting away. It's starting to bother me.",
    "This is becoming a habit.",
    "Third time. I'm taking notes."
  ],

  playerRepeatsMovement: [
    "You keep doing that.",
    "I've seen this one before.",
    "You're really committed to that strategy.",
    "You might want to try something different."
  ],

  playerSuddenDirectionChange: [
    "Oh, changing direction now?",
    "New plan?",
    "Wasn't expecting that turn."
  ],

  playerSurvivesLong: [
    "You're really dragging this out.",
    "Still going, huh.",
    "This is taking a while."
  ],

  playerReachesGoalFast: [
    "That was fast.",
    "Okay, you didn't waste any time.",
    "Efficient. I'll give you that."
  ],

  playerReachesGoalSlow: [
    "That took forever.",
    "Finally.",
    "Took the scenic route, I see."
  ],

  aiMistake: [
    "...Ignore that.",
    "That was intentional.",
    "We're not talking about that.",
    "Okay, that one was my fault."
  ],

  // --- Streaks / progression ---
  playerWinStreak: [
    "Again?",
    "You're starting to get annoying.",
    "Okay, okay. I get it.",
    "Don't let that go to your head.",
    "You're actually learning."
  ],

  playerLossStreak: [
    "Again?",
    "You still haven't figured it out?",
    "Are we learning anything today?",
    "You're making this very easy for me."
  ],

  // --- Personality: general sarcastic commentary, not tied to a specific event ---
  personalityGeneral: [
    "Are you sure you know how this works?",
    "This is painful to watch.",
    "Interesting strategy.",
    "I'm starting to regret playing with you.",
    "You could just... try harder."
  ]
};
