// frontend/src/utils/predictions.js

const MIN_HISTORY = 30;
const MAX_HISTORY = 200;


/* -------------------------------------------------------
   Extract the last digit from a tick/value
------------------------------------------------------- */

function getLastDigit(value) {
  if (value === null || value === undefined) {
    return null;
  }

  // Already a digit
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 9
  ) {
    return value;
  }

  // Tick object
  if (typeof value === 'object') {
    if (value.digit !== undefined) {
      const digit = Number(value.digit);

      if (
        Number.isInteger(digit) &&
        digit >= 0 &&
        digit <= 9
      ) {
        return digit;
      }
    }

    if (value.lastDigit !== undefined) {
      const digit = Number(value.lastDigit);

      if (
        Number.isInteger(digit) &&
        digit >= 0 &&
        digit <= 9
      ) {
        return digit;
      }
    }

    value =
      value.quote ??
      value.price ??
      value.tick ??
      value.value;
  }

  const text = String(value);

  /*
    Remove decimal point and other characters,
    then take the final numerical digit.
  */
  const digits = text.replace(/\D/g, '');

  if (!digits.length) {
    return null;
  }

  return Number(digits[digits.length - 1]);
}


/* -------------------------------------------------------
   Convert raw ticks into clean digits
------------------------------------------------------- */

export function extractLastDigits(ticks) {
  if (!Array.isArray(ticks)) {
    return [];
  }

  return ticks
    .map(getLastDigit)
    .filter(
      digit =>
        Number.isInteger(digit) &&
        digit >= 0 &&
        digit <= 9
    )
    .slice(-MAX_HISTORY);
}


/* -------------------------------------------------------
   Frequency calculation
------------------------------------------------------- */

function getFrequency(digits) {
  const frequency = Array(10).fill(0);

  digits.forEach(digit => {
    if (
      Number.isInteger(digit) &&
      digit >= 0 &&
      digit <= 9
    ) {
      frequency[digit]++;
    }
  });

  return frequency;
}


/* -------------------------------------------------------
   Recency score
------------------------------------------------------- */

function getRecencyScores(digits) {
  const scores = Array(10).fill(0);

  const recent = digits.slice(-30);

  recent.forEach((digit, index) => {
    if (
      Number.isInteger(digit) &&
      digit >= 0 &&
      digit <= 9
    ) {
      /*
        More recent digits receive more weight.
      */
      const weight = index + 1;

      scores[digit] += weight;
    }
  });

  return scores;
}


/* -------------------------------------------------------
   Transition score

   Looks at what digits commonly appear after
   the latest digit.
------------------------------------------------------- */

function getTransitionScores(digits) {
  const scores = Array(10).fill(0);

  if (digits.length < 2) {
    return scores;
  }

  const latestDigit =
    digits[digits.length - 1];

  for (let i = 0; i < digits.length - 1; i++) {
    if (digits[i] === latestDigit) {
      const next = digits[i + 1];

      if (
        Number.isInteger(next) &&
        next >= 0 &&
        next <= 9
      ) {
        scores[next]++;
      }
    }
  }

  return scores;
}


/* -------------------------------------------------------
   Pair transition

   Looks at the last two digits and what historically
   followed similar pairs.
------------------------------------------------------- */

function getPairTransitionScores(digits) {
  const scores = Array(10).fill(0);

  if (digits.length < 3) {
    return scores;
  }

  const a =
    digits[digits.length - 2];

  const b =
    digits[digits.length - 1];

  for (let i = 0; i < digits.length - 2; i++) {
    if (
      digits[i] === a &&
      digits[i + 1] === b
    ) {
      const next =
        digits[i + 2];

      if (
        Number.isInteger(next) &&
        next >= 0 &&
        next <= 9
      ) {
        scores[next]++;
      }
    }
  }

  return scores;
}


/* -------------------------------------------------------
   Run analysis

   Detects whether a digit has appeared repeatedly.
------------------------------------------------------- */

function getRunScores(digits) {
  const scores = Array(10).fill(0);

  if (!digits.length) {
    return scores;
  }

  const last =
    digits[digits.length - 1];

  let runLength = 1;

  for (
    let i = digits.length - 2;
    i >= 0;
    i--
  ) {
    if (digits[i] === last) {
      runLength++;
    } else {
      break;
    }
  }

  /*
    We don't blindly assume that a run will continue.
    Instead we give a small score to other digits when
    a long run is detected.
  */

  if (runLength >= 3) {
    for (let digit = 0; digit <= 9; digit++) {
      if (digit !== last) {
        scores[digit] += runLength;
      }
    }
  }

  return scores;
}


/* -------------------------------------------------------
   Absence score

   Gives some weight to digits that have been absent
   from the recent window.

   IMPORTANT:
   This does NOT mean an absent digit is guaranteed
   to appear next.
------------------------------------------------------- */

function getAbsenceScores(digits) {
  const scores = Array(10).fill(0);

  const recent =
    digits.slice(-50);

  const lastSeen =
    Array(10).fill(-1);

  recent.forEach((digit, index) => {
    if (
      Number.isInteger(digit) &&
      digit >= 0 &&
      digit <= 9
    ) {
      lastSeen[digit] = index;
    }
  });

  for (let digit = 0; digit <= 9; digit++) {
    if (lastSeen[digit] === -1) {
      scores[digit] = recent.length;
    } else {
      scores[digit] =
        recent.length -
        lastSeen[digit];
    }
  }

  return scores;
}


/* -------------------------------------------------------
   Normalize an array to 0–100
------------------------------------------------------- */

function normalizeScores(scores) {
  const max =
    Math.max(...scores);

  const min =
    Math.min(...scores);

  if (
    !Number.isFinite(max) ||
    max === min
  ) {
    return Array(10).fill(50);
  }

  return scores.map(value =>
    ((value - min) /
      (max - min)) *
    100
  );
}


/* -------------------------------------------------------
   Main Digit Match analyzer
------------------------------------------------------- */

export function analyzeDigitMatch(inputDigits) {
  const digits =
    Array.isArray(inputDigits)
      ? inputDigits
          .map(getLastDigit)
          .filter(
            digit =>
              Number.isInteger(digit) &&
              digit >= 0 &&
              digit <= 9
          )
          .slice(-MAX_HISTORY)
      : [];


  /*
    Not enough data.
  */
  if (digits.length < MIN_HISTORY) {
    return {
      prediction: null,
      confidence: 0,
      status: 'WAIT',
      reason:
        `Need at least ${MIN_HISTORY} digits`,
      historyLength: digits.length
    };
  }


  /* ---------------------------------------------
     Individual model components
  --------------------------------------------- */

  const frequency =
    getFrequency(digits);

  const recency =
    getRecencyScores(digits);

  const transition =
    getTransitionScores(digits);

  const pairTransition =
    getPairTransitionScores(digits);

  const run =
    getRunScores(digits);

  const absence =
    getAbsenceScores(digits);


  /* ---------------------------------------------
     Normalize components
  --------------------------------------------- */

  const frequencyN =
    normalizeScores(frequency);

  const recencyN =
    normalizeScores(recency);

  const transitionN =
    normalizeScores(transition);

  const pairTransitionN =
    normalizeScores(pairTransition);

  const runN =
    normalizeScores(run);

  const absenceN =
    normalizeScores(absence);


  /* ---------------------------------------------
     Combined score

     These weights are model heuristics.
     They are NOT mathematical probabilities.
  --------------------------------------------- */

  const scores =
    Array(10).fill(0);

  for (let digit = 0; digit <= 9; digit++) {
    scores[digit] =
      (frequencyN[digit] * 0.20) +
      (recencyN[digit] * 0.20) +
      (transitionN[digit] * 0.25) +
      (pairTransitionN[digit] * 0.20) +
      (runN[digit] * 0.05) +
      (absenceN[digit] * 0.10);
  }


  /* ---------------------------------------------
     Find highest and second-highest candidates
  --------------------------------------------- */

  const ranked =
    scores
      .map((score, digit) => ({
        digit,
        score
      }))
      .sort(
        (a, b) =>
          b.score - a.score
      );


  const best =
    ranked[0];

  const second =
    ranked[1];


  if (!best) {
    return {
      prediction: null,
      confidence: 0,
      status: 'WAIT',
      reason: 'No usable signal',
      historyLength: digits.length
    };
  }


  /* ---------------------------------------------
     Calculate model confidence

     This measures separation between the top
     candidates. It is NOT a true probability.
  --------------------------------------------- */

  const spread =
    Math.max(
      0,
      best.score -
        second.score
    );


  let confidence =
    50 + (spread * 1.5);


  /*
    Small adjustment for amount of history.
  */
  if (digits.length >= 100) {
    confidence += 3;
  } else if (digits.length >= 60) {
    confidence += 2;
  }


  confidence =
    Math.round(
      Math.max(
        0,
        Math.min(
          100,
          confidence
        )
      )
    );


  /* ---------------------------------------------
     Signal quality checks
  --------------------------------------------- */

  const latest =
    digits[digits.length - 1];

  const recent =
    digits.slice(-20);

  const recentFrequency =
    getFrequency(recent);

  const bestRecentCount =
    recentFrequency[
      best.digit
    ];


  /*
    If the top candidate is not meaningfully
    separated from the next candidate, treat
    it as a weak signal.
  */
  const strongSeparation =
    spread >= 5;


  /*
    Avoid treating extremely weak candidates
    as strong predictions.
  */
  const usableSignal =
    strongSeparation &&
    confidence >= 50;


  return {
    prediction:
      usableSignal
        ? best.digit
        : null,

    confidence,

    status:
      usableSignal
        ? 'SIGNAL'
        : 'WAIT',

    latestDigit: latest,

    historyLength:
      digits.length,

    score:
      Number(best.score.toFixed(2)),

    secondScore:
      Number(
        second.score.toFixed(2)
      ),

    spread:
      Number(
        spread.toFixed(2)
      ),

    recentFrequency:
      bestRecentCount,

    candidates:
      ranked.slice(0, 5),

    reason:
      usableSignal
        ? 'Combined digit analysis'
        : 'Weak separation between candidates'
  };
}


/* -------------------------------------------------------
   Optional helper for testing/debugging
------------------------------------------------------- */

export function getDigitFrequency(digits) {
  const clean =
    Array.isArray(digits)
      ? digits
          .map(getLastDigit)
          .filter(
            digit =>
              Number.isInteger(digit) &&
              digit >= 0 &&
              digit <= 9
          )
      : [];

  return getFrequency(clean);
}


/* -------------------------------------------------------
   Default export
------------------------------------------------------- */

export default {
  analyzeDigitMatch,
  extractLastDigits,
  getDigitFrequency
};
