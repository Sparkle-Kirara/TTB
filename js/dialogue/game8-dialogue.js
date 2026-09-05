/* =====================================================================
   GAME8-DIALOGUE.JS — Content for Game #8 (Hot or Not)
   =====================================================================
   Pure content. hot-or-not.js only knows how to pick from these pools
   (via Dialogue.pick when available) and render the chosen line -- it
   has no AI lines of its own.

   The AI's OPINION lines (what it says before the reveal) are separate
   from its REACTION lines (what it says after), and reactions are split
   along two axes per spec section 7:
     - was the player's prediction correct or wrong
     - did the player follow the AI's opinion or go against it
   That gives four reaction pools: correctFollowed, correctIgnored,
   wrongFollowed, wrongIgnored -- each capturing a different flavor of
   "told you so" / "annoyed to be right" / "annoyed to be wrong".
   ===================================================================== */

const GAME8_DIALOGUE = {
  // AI opinion, shown BEFORE the player predicts. hot-or-not.js picks a
  // confidence tier (confident/uncertain/vague) based on how reliable
  // the AI is choosing to be this round -- see rollAiOpinion() in
  // hot-or-not.js for how tier and correctness are decided.
  opinionConfident: [
    "I'm pretty sure about this one.",
    "This one. Trust me.",
    "Easy pick, honestly."
  ],
  opinionUncertain: [
    "Maybe this one?",
    "I have a feeling about this one.",
    "This one, probably."
  ],
  opinionVague: [
    "One of them looks better.",
    "Don't ask me why.",
    "Hard to say. I'll guess this one though."
  ],

  // Reactions after the reveal, split by (correct/wrong) x (followed/ignored AI).
  correctFollowed: [
    "See? Sometimes I'm useful.",
    "Nice. Good call trusting me.",
    "Told you."
  ],
  correctIgnored: [
    "Oh.",
    "You didn't listen. And you were right.",
    "Annoying."
  ],
  wrongFollowed: [
    "...Okay.",
    "Let's pretend that didn't happen.",
    "In my defense, I only said 'maybe'."
  ],
  wrongIgnored: [
    "That was your choice.",
    "I suggested something else.",
    "You really trusted that one?"
  ],

  // Behavior-pattern lines (spec section 6), layered in occasionally
  // instead of a normal reaction line when a pattern is detected.
  alwaysFollowsAi: ["You really trust me that much?", "You just do whatever I say now, huh."],
  alwaysIgnoresAi: ["At this point, why am I even here?", "You never listen to me. Ever."],
  streak: ["Okay, you're on a roll.", "Alright, I see you."],

  levelStart: ["New round.", "Next one.", "Let's see this one."]
};

/**
 * Game-over summary lines, picked by final score tier.
 */
const GAME8_ENDINGS = {
  low: {
    title: "GAME OVER",
    closingLines: "\"Rough round.\"\n\nScore: {score}. Trust, judgment, or luck -- something didn't line up."
  },
  mid: {
    title: "GAME OVER",
    closingLines: "\"Not bad.\"\n\nScore: {score}. You read some of them right. Some of me too, maybe."
  },
  high: {
    title: "GAME OVER",
    closingLines: "\"Okay, that was actually good.\"\n\nScore: {score}. You know when to listen and when not to."
  }
};
