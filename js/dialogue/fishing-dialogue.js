/* =====================================================================
   DIALOGUE/FISHING-DIALOGUE.JS — Game #13 "Fishing" content
   =====================================================================
   Pure content only. No game logic lives here. js/games/fishing.js
   decides WHEN each category applies and calls Dialogue.pick(pool,
   historyKey), same convention as aim-dialogue.js.
   ===================================================================== */

const FISHING_DIALOGUE = {
  // Shown once near the start of a session.
  intro: [
    '"Let\'s see what\'s down there."',
    '"Cast whenever you\'re ready."',
    '"Try not to lose this one."'
  ],

  // Player waited a long time during WAITING with no bite yet.
  longWait: [
    '"Nothing yet. Patience."',
    '"They\'re not in a hurry today."',
    '"Maybe try a different spot next time."'
  ],

  // Player missed the bite reaction window.
  missedBite: [
    '"Too slow."',
    '"It got away before you even started."',
    '"You\'ll need to react faster than that."'
  ],

  // Player successfully hooked the fish.
  goodHook: [
    '"Got it. Now don\'t lose it."',
    '"Nice reaction."',
    '"Okay, now the real part starts."'
  ],

  // Tension is dangerously close to the break threshold.
  nearLineBreak: [
    '"Ease up!"',
    '"That line won\'t hold much more."',
    '"You\'re about to lose this one."'
  ],

  // Player repeatedly pulls too hard across a session (pattern, not one moment).
  repeatedOverpull: [
    '"You always pull too hard."',
    '"Gentler. Every time."',
    '"The line isn\'t the enemy here."'
  ],

  // The fish is making a strong struggle attempt.
  fishStruggle: [
    '"It\'s fighting back."',
    '"Hold steady."',
    '"Here it comes."'
  ],

  // Player caught the fish quickly (short fight duration).
  quickCatch: [
    '"That was fast."',
    '"Barely put up a fight."',
    '"Efficient."'
  ],

  // Player caught a difficult fish (strong/erratic type) after a real fight.
  hardWonCatch: [
    '"That one earned its spot."',
    '"That was NOT easy."',
    '"Finally."'
  ],

  // Line broke.
  lineBroke: [
    '"...Snapped."',
    '"That line is done."',
    '"Too much, too fast."'
  ],

  // Fish escaped (distance reached the far threshold).
  fishEscaped: [
    '"It got away."',
    '"Gone."',
    '"You lost that one."'
  ],

  // Player has lost several fish in a row this session.
  losingStreak: [
    '"Rough session."',
    '"Maybe try holding back a little."',
    '"You\'ll get the next one. Maybe."'
  ]
};
