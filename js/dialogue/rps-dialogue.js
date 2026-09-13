/* =====================================================================
   RPS-DIALOGUE.JS — Dialogue content for Game #1 (Rock Paper Scissors)
   =====================================================================
   Pure content. No gameplay logic lives here -- rps.js decides WHAT
   happened (win/lose/draw, level-0 struggle, repeated choices, streaks,
   hint usage) and calls Dialogue.pick() on the appropriate pool below.
   ===================================================================== */

const RPS_DIALOGUE = {
  level0Prompts: [
    "Make your choice.",
    "Choose your move.",
    "Rock, Paper, or Scissors?",
    "Your move.",
    "Pick one.",
    "What will you choose?",
    "Choose wisely.",
    "Show me what you've got.",
    "No hints yet. Let's see how you do.",
    "Go ahead, surprise me."
  ],

  level0HintReactions: [
    "Two rounds and you still haven't won? Fine. Here's a hint.",
    "Still struggling? I'll help you this time.",
    "Two chances. Zero wins. You need a little help?",
    "Alright, alright... I'll give you a hint.",
    "You had two chances. Let's make this easier.",
    "Okay, you clearly need some assistance.",
    "I'll spot you a hint. Just this once."
  ],

  winReactions: [
    "You actually won?",
    "Don't get too excited.",
    "Enjoy your little victory.",
    "Was that intentional?",
    "Fine. That one's yours.",
    "Huh. Didn't see that coming.",
    "Okay, I'll give you that."
  ],

  lossReactions: [
    "That was almost too easy.",
    "Predictable.",
    "I saw that coming from a mile away.",
    "Better luck next time. You'll need it.",
    "That wasn't even close.",
    "I could do this all day."
  ],

  drawReactions: [
    "We're going nowhere.",
    "Still tied?",
    "Neither of us wanted to win, apparently.",
    "A draw. How thrilling.",
    "Let's try that again."
  ],

  // --- Behavioral: player pattern detection ---
  repeatedRock: [
    "You really like Rock, huh?",
    "Rock again? Bold.",
    "Rock, Rock, Rock. Any other moves?",
    "You're a creature of habit, aren't you?"
  ],

  repeatedPaper: [
    "Paper. Again.",
    "You really trust Paper, huh?",
    "Same move as last time. Interesting.",
    "Paper's your comfort zone, I see."
  ],

  repeatedScissors: [
    "That's your third Scissors.",
    "Scissors, huh? Sticking with a theme.",
    "You're really committed to Scissors.",
    "Same move again. Sensing a pattern."
  ],

  changingStrategy: [
    "You're changing your strategy now?",
    "Oh, a different move. Bold choice.",
    "Switching it up? Let's see if it works.",
    "New move, who dis?"
  ],

  unexpectedChoice: [
    "Interesting choice.",
    "Didn't expect that one.",
    "Okay, that was unexpected.",
    "Well, that's a curveball."
  ],

  followedHint: [
    "You actually listened to the hint?",
    "Trusting me now? Bold move.",
    "You went with the hint. Let's see how that pans out.",
    "Following instructions, I see."
  ],

  ignoredHint: [
    "Ignoring my hint? Your call.",
    "You know I told you what I'd play, right?",
    "Bold of you to ignore free information.",
    "I literally told you. But sure, do your own thing."
  ],

  // --- Streaks ---
  playerWinStreak: [
    "Three wins in a row. Can it be four?",
    "You're getting confident.",
    "Okay, this is starting to feel less like luck.",
    "A streak? Didn't see that coming.",
    "You're on a roll. Annoyingly so."
  ],

  playerLossStreak: [
    "Another loss. Are we learning anything?",
    "This is starting to feel repetitive. For you.",
    "You might want to try a new strategy.",
    "At this point I'm just going through the motions.",
    "Still losing. Consistency, I suppose."
  ],

  // --- Personality / general commentary ---
  longSession: [
    "Still here? Dedicated.",
    "We've been at this a while.",
    "You're really committed to beating me, huh?",
    "This is turning into a marathon."
  ],

  finallyDecent: [
    "Finally, a decent move.",
    "Okay, that one was actually smart.",
    "Alright, I'll admit that was good thinking.",
    "Now THAT was a real move."
  ]
};
