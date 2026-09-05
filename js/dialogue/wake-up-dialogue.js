/* =====================================================================
   WAKE-UP-DIALOGUE.JS — Content for Game #6 (Wake Up)
   =====================================================================
   Pure content. wake-up.js only knows how to walk this data and render
   it / score it -- it has no puzzle text or AI lines of its own.

   GAME SHAPE (see spec): this is a reasoning-puzzle game, not a visual
   novel. Each level presents a short situation, an AI hint, and a row
   of DOORS. The player picks a door based on reasoning about the hint
   vs. the door symbols -- not based on narrative branching.

   WAKEUP_LEVELS[i] = {
     id, label,
     situation: "1-line context, not prose",
     visual: "ascii door row (kept under ~20 chars/line for mobile)",
     hints: [easiestPhrasing, harderPhrasing, hardestPhrasing],
       // wake-up.js picks by how many mistakes the player has made on
       // THIS level (0 mistakes -> hints[0], 1 -> hints[1], 2+ -> hints[2])
     doors: [
       { emoji, label, outcome, reaction }
     ]
   }

   outcome is one of:
     'correct'   -> advances to the next level
     'wrongRetry'-> AI reacts, player retries the SAME level (learn from it)
     'deadEnd'   -> immediately ends the run with a specific ending id
     'secret'    -> immediately ends the run with the secret ending

   reaction is a short AI line said right after that specific door is
   opened -- distinct from the general behavior-based yapping in
   WAKEUP_YAPS, which reacts to patterns across the whole run.
   ===================================================================== */

const WAKEUP_LEVELS = [
  // LEVEL 0 -- obvious, 3 choices, teaches the loop
  {
    id: 'lvl0',
    label: 'Level 1',
    situation: "A hallway. Three doors. You need somewhere to stand.",
    visual:
`🚪1   🚪2   🚪3
🌊    🌋    🌲`,
    hints: [
      "Don't choose the hot one.",
      "I wouldn't want to stand somewhere with lava.",
      "Think about what happens when things get too hot."
    ],
    doors: [
      { emoji: '🌊', label: 'River', outcome: 'correct', reaction: "Water. Safe. Boring. Fine." },
      { emoji: '🌋', label: 'Volcano', outcome: 'wrongRetry', reaction: "...Interesting. You chose that." },
      { emoji: '🌲', label: 'Forest', outcome: 'wrongRetry', reaction: "Not wrong exactly. Just not what I meant." }
    ]
  },

  // LEVEL 1 -- still 3 choices, slightly less direct
  {
    id: 'lvl1',
    label: 'Level 2',
    situation: "New hallway. You're thirsty, apparently.",
    visual:
`🚪1   🚪2   🚪3
❄️     🏜️     🌊`,
    hints: [
      "You'll probably want somewhere with water.",
      "One of these is famous for having none.",
      "Ice doesn't count if you can't reach it."
    ],
    doors: [
      { emoji: '❄️', label: 'Glacier', outcome: 'wrongRetry', reaction: "Technically water. Not helpfully, though." },
      { emoji: '🏜️', label: 'Desert', outcome: 'wrongRetry', reaction: "Bold choice. Wrong, but bold." },
      { emoji: '🌊', label: 'River', outcome: 'correct', reaction: "There you go." }
    ]
  },

  // LEVEL 2 -- 4 choices, more similar-looking options
  {
    id: 'lvl2',
    label: 'Level 3',
    situation: "Four doors this time. Something's chasing you. Hypothetically.",
    visual:
`🚪1  🚪2  🚪3  🚪4
🪨   🕳️   🌳   🧱`,
    hints: [
      "Pick somewhere you could actually hide.",
      "A hole in the ground works both ways.",
      "Some of these hide you. Some of these trap you."
    ],
    doors: [
      { emoji: '🪨', label: 'Boulder', outcome: 'correct', reaction: "Good instinct. Cover, not a corner." },
      { emoji: '🕳️', label: 'Hole', outcome: 'deadEnd', endingId: 'lvl2_hole', reaction: "Huh." },
      { emoji: '🌳', label: 'Tree', outcome: 'wrongRetry', reaction: "Visible from everywhere. But sure." },
      { emoji: '🧱', label: 'Wall', outcome: 'wrongRetry', reaction: "A wall. A dead-end wall. Bold." }
    ]
  },

  // LEVEL 3 -- 4-5 choices, indirect, compare options
  {
    id: 'lvl3',
    label: 'Level 4',
    situation: "A locked door ahead. You need to get through it, not around it.",
    visual:
`🚪1  🚪2  🚪3  🚪4
🗝️   🔨   🪞   📦`,
    hints: [
      "You need something that opens locks, not breaks them.",
      "One of these was made for exactly this door.",
      "The loud option isn't always the smart one."
    ],
    doors: [
      { emoji: '🗝️', label: 'Key', outcome: 'correct', reaction: "Obviously. But still. Nice." },
      { emoji: '🔨', label: 'Hammer', outcome: 'wrongRetry', reaction: "Effective. Also extremely loud." },
      { emoji: '🪞', label: 'Mirror', outcome: 'secret', reaction: "...oh. Oh, you actually looked." },
      { emoji: '📦', label: 'Box', outcome: 'wrongRetry', reaction: "It's empty. Was that a surprise?" }
    ]
  },

  // LEVEL 4 -- ambiguous, relationships between choices, callback to L0
  {
    id: 'lvl4',
    label: 'Level 5',
    situation: "Getting warmer in here. You remember somewhere that wasn't.",
    visual:
`🚪1  🚪2  🚪3  🚪4
🔥   🧊   🌊   ☀️`,
    hints: [
      "Remember what happened when you chose the hot place, back at the start?",
      "You want the opposite of that volcano.",
      "Cold beats hot. That's really the whole hint."
    ],
    doors: [
      { emoji: '🔥', label: 'Fire', outcome: 'deadEnd', endingId: 'lvl4_fire', reaction: "You really didn't learn anything, did you." },
      { emoji: '🧊', label: 'Ice', outcome: 'correct', reaction: "See? You remembered. Growth." },
      { emoji: '🌊', label: 'River', outcome: 'wrongRetry', reaction: "Not wrong. Not right either." },
      { emoji: '☀️', label: 'Sun', outcome: 'wrongRetry', reaction: "Also hot. You're 0 for 2 on 'hot'." }
    ]
  },

  // LEVEL 5 -- final gate, misleading wording, 4 choices
  {
    id: 'lvl5',
    label: 'Level 6',
    situation: "Last door. Whatever's behind it, that's the way out.",
    visual:
`🚪1  🚪2  🚪3  🚪4
🕯️   💡   🔦   🌑`,
    hints: [
      "You want the brightest option, not just any light.",
      "A flicker isn't the same as a light that stays on.",
      "One of these is barely a light at all."
    ],
    doors: [
      { emoji: '🕯️', label: 'Candle', outcome: 'wrongRetry', reaction: "Charming. Insufficient." },
      { emoji: '💡', label: 'Lamp', outcome: 'correct', reaction: "There it is. That's the door." },
      { emoji: '🔦', label: 'Flashlight', outcome: 'wrongRetry', reaction: "Close. It flickers. You'd have noticed if you looked twice." },
      { emoji: '🌑', label: 'Darkness', outcome: 'deadEnd', endingId: 'lvl5_dark', reaction: "...Why." }
    ]
  }
];

/**
 * General AI reactions keyed by behavior pattern (spec section 8). These
 * are picked by wake-up.js based on tracked state, layered ON TOP of the
 * per-door `reaction` line above -- not a replacement for it.
 */
const WAKEUP_YAPS = {
  streak3: ["Okay, you're on a roll.", "Three in a row. Noted."],
  streak5: ["Okay, show-off.", "Alright, I'm mildly impressed."],
  comeback: ["Oh.", "You're actually learning."],
  repeatMistakes: ["I can't make this much easier.", "The hints are supposed to help, you know."],
  veryFast: ["That was fast.", "Did you actually think about it?"],
  verySlow: ["Take your time.", "...I'll wait.", "Apparently patience is part of the game now."],
  repeatedSymbol: ["You really like that one, huh?"],
  levelStart: ["Alright. New problem.", "Next one.", "Moving on."]
};

/**
 * Ending presentation data. `title` and `closingLines` are the only
 * things wake-up.js needs to render an ending screen. Endings are chosen
 * by wake-up.js based on run stats (or triggered directly by a
 * 'deadEnd'/'secret' door outcome via that door's own `endingId`).
 */
const WAKEUP_ENDINGS = {
  // triggered directly by specific deadEnd doors
  lvl2_hole: {
    title: "DOWN THE HOLE",
    closingLines: "\"Huh.\"\n\nThat wasn't cover. That was a hole. You're still falling, probably."
  },
  lvl4_fire: {
    title: "SAME MISTAKE, TWICE",
    closingLines: "\"You really didn't learn anything, did you.\"\n\nSome lessons don't take the first time. Or the second."
  },
  lvl5_dark: {
    title: "INTO THE DARK",
    closingLines: "\"...Why.\"\n\nThere was no reason to pick that one. That's what makes it worse."
  },
  // triggered directly by the one secret door
  secret: {
    title: "THE MIRROR",
    closingLines: "\"...oh. Oh, you actually looked.\"\n\nSome things aren't meant to be found through logic. You found this one anyway."
  },
  // computed at the very end from overall run stats
  escapeClean: {
    title: "ESCAPE",
    closingLines: "\"You made it.\"\n\n\"...Was that even hard for you?\"\n\nYou're out. Clean run. The AI sounds almost disappointed there's nothing left to comment on."
  },
  escapeMessy: {
    title: "ESCAPE, EVENTUALLY",
    closingLines: "\"You made it. Eventually.\"\n\nIt took a few wrong doors. You're out anyway. That still counts."
  },
  trustedAi: {
    title: "GOOD LISTENER",
    closingLines: "\"You actually listened to me the whole way.\"\n\n\"...I don't know how to feel about that.\"\n\nEvery hint, taken. Every door, the safe one."
  },
  ignoredAi: {
    title: "DID IT YOUR WAY",
    closingLines: "\"You ignored basically everything I said.\"\n\n\"It worked out anyway. I hate that.\"\n\nYou made it out mostly by guessing. The AI is not thrilled about this."
  }
};
