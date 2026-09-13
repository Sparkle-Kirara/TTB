/* =====================================================================
   DIALOGUE/AIM-DIALOGUE.JS — Game #12 "Outsmart the Target" content
   =====================================================================
   Pure content only. No game logic lives here. js/games/aim.js decides
   WHEN each category applies and calls Dialogue.pick(pool, historyKey).
   ===================================================================== */

const AIM_DIALOGUE = {
  // Player keeps shooting near the center of the board.
  centerHabit: [
    '"You really like the middle."',
    '"Center again? Predictable."',
    '"I could set my watch by your aim."'
  ],

  // Player has missed several shots in a row.
  missStreak: [
    '"Your aim is... ambitious."',
    '"Close. Not close enough."',
    '"Maybe try looking at the target."'
  ],

  // Player is shooting very quickly after each target appears.
  fastShooter: [
    '"You shoot before thinking."',
    '"Trigger happy, huh?"',
    '"No hesitation. I respect that."'
  ],

  // Player just changed strategy after a recognizable habit was tracked.
  strategyChange: [
    '"...Oh?"',
    '"Wait, that\'s new."',
    '"You changed."',
    '"Interesting choice."'
  ],

  // Phase 2: player frequently aims toward the left side of the board.
  leftBias: [
    '"You keep favoring that side."',
    '"Left again?"',
    '"I see where you like to stand."'
  ],

  // Phase 2: player frequently aims toward the right side of the board.
  rightBias: [
    '"You keep favoring that side."',
    '"Right again?"',
    '"I see where you like to stand."'
  ],

  // Phase 2: player consistently waits before shooting.
  patientShooter: [
    '"You\'re taking your time now."',
    '"Patient. Interesting."',
    '"Still waiting for the perfect shot?"'
  ],

  // Phase 2: player tends to fire fast right after a miss (panic shooting).
  panicShooter: [
    '"Panic shooting?"',
    '"Slow down."',
    '"That one was rushed."'
  ],

  // Phase 2: player consistently lands high-precision shots.
  precisionPlayer: [
    '"You\'re not just hitting them. You\'re placing them."',
    '"That\'s not luck anymore."',
    '"Every shot, right where you want it."'
  ],

  // The AI's prediction paid off (target dodged into empty space, player missed).
  predictionHit: [
    '"I knew you\'d aim there."',
    '"Called it."',
    '"Too easy."'
  ],

  // Player broke the AI's expectation and landed a hit anyway.
  predictionBroken: [
    '"Okay. You got me."',
    '"Didn\'t see that coming."',
    '"Fine. That one was good."'
  ],

  // Player is maintaining high accuracy over the run.
  highAccuracy: [
    '"That\'s annoyingly precise."',
    '"You\'re making this look easy."',
    '"Okay, show-off."'
  ],

  // Shown once near the start of a run.
  intro: [
    '"Let\'s see how you aim."',
    '"I\'m watching. Always."',
    '"Show me your habits."'
  ],

  // v2: player landed a precise (GREAT-tier) shot.
  accurateShot: [
    '"Okay... that was clean."',
    '"Right in the middle."',
    '"You actually aimed properly."'
  ],

  // v2: player landed a BULLSEYE-tier shot.
  bullseye: [
    '"..."',
    '"Bullseye."',
    '"Fine. That was impressive."'
  ],

  // v2: player's combo just crossed the "high combo" threshold.
  highCombo: [
    '"Oh."',
    '"You\'re getting dangerous."',
    '"Okay, I see you."'
  ],

  // v2: player missed right after building a high combo.
  missAfterCombo: [
    '"And there it goes."',
    '"You were doing so well..."',
    '"That hurt more than it hurt me."'
  ],

  // Game over lines.
  gameOver: [
    '"Not bad."',
    '"You\'ll do better next time. Probably."',
    '"I learned a lot about you today."'
  ],

  // Phase 3: Neural Duel dialogue. Distinct from Classic mode's lines
  // above -- these react to the AI's OWN evasion outcomes, not the
  // player's target-shooting behavior.
  neuralIntro: [
    '"Let\'s see if you can hit me."',
    '"I\'m watching your cursor. Always."',
    '"Try to predict what I\'ll do. I\'ll try to predict you first."'
  ],

  // AI successfully predicted and evaded with minimal movement.
  neuralTinyEvasion: [
    '"Barely."',
    '"I knew you were going there."',
    '"Close. Not close enough."'
  ],

  // AI evaded, but with a larger/less confident movement.
  neuralPredicted: [
    '"I saw that coming."',
    '"Nice try."',
    '"Almost had me."'
  ],

  // AI moved unnecessarily (Case C) -- panicked when there was no real threat.
  neuralPanicMovement: [
    '"Okay, that was unnecessary."',
    '"I didn\'t need to do that."',
    '"...that was a bit much."'
  ],

  // The player successfully hit the AI.
  neuralGotHit: [
    '"...You got me."',
    '"Fine. That one counts."',
    '"Didn\'t see that coming."'
  ],

  // The player has hit the AI several times this run.
  neuralRepeatedlyHit: [
    '"I still don\'t understand you."',
    '"You\'re making this look easy."',
    '"I need to rethink this."'
  ],

  // End-of-run lines for Neural Duel.
  neuralOutro: [
    '"I\'m starting to see a pattern."',
    '"Next time, I\'ll know better."',
    '"You made me work for that."'
  ]
};
