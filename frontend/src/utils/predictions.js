// frontend/src/utils/predictions.js

const MIN_HISTORY = 30;
const MAX_HISTORY = 200;


/* =========================================================
   GET LAST DIGIT
========================================================= */

function getLastDigit(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 9
  ) {
    return value;
  }

  if (typeof value === 'object') {
    if (value.digit !== undefined) {
      const d = Number(value.digit);

      if (Number.isInteger(d) && d >= 0 && d <= 9) {
        return d;
      }
    }

    if (value.lastDigit !== undefined) {
      const d = Number(value.lastDigit);

      if (Number.isInteger(d) && d >= 0 && d <= 9) {
        return d;
      }
    }

    value =
      value.quote ??
      value.price ??
      value.tick ??
      value.value;
  }

  const text = String(value);

  const digits = text.replace(/\D/g, '');

  if (!digits.length) {
    return null;
  }

  return Number(digits[digits.length - 1]);
}


/* =========================================================
   EXTRACT LAST DIGITS FROM DERIV TICKS
========================================================= */

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


/* =========================================================
   DIGIT FREQUENCY
========================================================= */

function frequencyAnalysis(digits) {
  const counts = Array(10).fill(0);

  digits.forEach(digit => {
    if (digit >= 0 && digit <= 9) {
      counts[digit]++;
    }
  });

  return counts;
}


/* =========================================================
   RECENT FREQUENCY
========================================================= */

function recentFrequencyAnalysis(digits) {
  const recent = digits.slice(-20);

  return frequencyAnalysis(recent);
}


/* =========================================================
   LAST DIGIT RUN
========================================================= */

function getCurrentRun(digits) {
  if (!digits.length) {
    return {
      digit: null,
      length: 0
    };
  }

  const last =
    digits[digits.length - 1];

  let length = 1;

  for (
    let i = digits.length - 2;
    i >= 0;
    i--
  ) {
    if (digits[i] === last) {
      length++;
    } else {
      break;
    }
  }

  return {
    digit: last,
    length
  };
}


/* =========================================================
   X2X / PAIR PATTERN ANALYSIS

   Example:

   5 2 5
   4 2 4
   7 3 7

   Detects cases where the first and third digits
   are identical.
========================================================= */

function x2xAnalysis(digits) {
  const scores = Array(10).fill(0);

  if (digits.length < 3) {
    return scores;
  }

  for (let i = 0; i < digits.length - 2; i++) {
    const a = digits[i];
    const b = digits[i + 1];
    const c = digits[i + 2];

    if (a === c && a !== b) {
      scores[a]++;
    }
  }

  return scores;
}


/* =========================================================
   WHAT DIGIT FOLLOWED THE LAST DIGIT?
========================================================= */

function transitionAnalysis(digits) {
  const scores = Array(10).fill(0);

  if (digits.length < 2) {
    return scores;
  }

  const latest =
    digits[digits.length - 1];

  for (
    let i = 0;
    i < digits.length - 1;
    i++
  ) {
    if (digits[i] === latest) {
      const next = digits[i + 1];

      if (next >= 0 && next <= 9) {
        scores[next]++;
      }
    }
  }

  return scores;
}


/* =========================================================
   TWO-DIGIT TRANSITION
========================================================= */

function pairTransitionAnalysis(digits) {
  const scores = Array(10).fill(0);

  if (digits.length < 3) {
    return scores;
  }

  const a =
    digits[digits.length - 2];

  const b =
    digits[digits.length - 1];

  for (
    let i = 0;
    i < digits.length - 2;
    i++
  ) {
    if (
      digits[i] === a &&
      digits[i + 1] === b
    ) {
      const next =
        digits[i + 2];

      if (next >= 0 && next <= 9) {
        scores[next]++;
      }
    }
  }

  return scores;
}


/* =========================================================
   ABSENCE / GAP ANALYSIS
========================================================= */

function absenceAnalysis(digits) {
  const scores = Array(10).fill(0);

  const recent =
    digits.slice(-50);

  const lastSeen =
    Array(10).fill(-1);

  recent.forEach((digit, index) => {
    lastSeen[digit] = index;
  });

  for (let digit = 0; digit <= 9; digit++) {
    if (lastSeen[digit] === -1) {
      scores[digit] =
        recent.length;
    } else {
      scores[digit] =
        recent.length -
        lastSeen[digit];
    }
  }

  return scores;
}


/* =========================================================
   NORMALIZE
========================================================= */

function normalize(values) {
  const max =
    Math.max(...values);

  const min =
    Math.min(...values);

  if (max === min) {
    return Array(values.length).fill(0);
  }

  return values.map(
    value =>
      (value - min) /
      (max - min)
  );
}


/* =========================================================
   MAIN LDP ANALYZER
========================================================= */

export function analyzeDigitMatch(inputDigits) {
  const digits =
    Array.isArray(inputDigits)
      ? inputDigits
          .map(getLastDigit)
          .filter(
            d =>
              Number.isInteger(d) &&
              d >= 0 &&
              d <= 9
          )
          .slice(-MAX_HISTORY)
      : [];


  /* -------------------------------------------------------
     Need enough live history
  ------------------------------------------------------- */

  if (digits.length < MIN_HISTORY) {
    return {
      prediction: null,
      confidence: 0,
      status: 'WAIT',
      reason:
        `Waiting for ${MIN_HISTORY} live digits`,
      historyLength:
        digits.length
    };
  }


  /* -------------------------------------------------------
     Run all analyses
  ------------------------------------------------------- */

  const frequency =
    frequencyAnalysis(digits);

  const recentFrequency =
    recentFrequencyAnalysis(digits);

  const transition =
    transitionAnalysis(digits);

  const pairTransition =
    pairTransitionAnalysis(digits);

  const x2x =
    x2xAnalysis(digits);

  const absence =
    absenceAnalysis(digits);

  const run =
    getCurrentRun(digits);


  /* -------------------------------------------------------
     Normalize
  ------------------------------------------------------- */

  const frequencyN =
    normalize(frequency);

  const recentN =
    normalize(recentFrequency);

  const transitionN =
    normalize(transition);

  const pairN =
    normalize(pairTransition);

  const x2xN =
    normalize(x2x);

  const absenceN =
    normalize(absence);


  /* -------------------------------------------------------
     Combine scores
  ------------------------------------------------------- */

  const scores =
    Array(10).fill(0);


  for (let digit = 0; digit <= 9; digit++) {

    scores[digit] =

      // Historical frequency
      frequencyN[digit] * 0.15 +

      // Recent frequency
      recentN[digit] * 0.15 +

      // What followed the latest digit
      transitionN[digit] * 0.25 +

      // What followed the latest pair
      pairN[digit] * 0.20 +

      // X2X pattern
      x2xN[digit] * 0.15 +

      // Gap / absence
      absenceN[digit] * 0.10;
  }


  /* -------------------------------------------------------
     Current run adjustment
  ------------------------------------------------------- */

  if (
    run.length >= 3 &&
    run.digit !== null
  ) {
    /*
      Do not blindly predict the same digit again
      simply because it has repeated.
    */

    scores[run.digit] *= 0.80;
  }


  /* -------------------------------------------------------
     Rank candidates
  ------------------------------------------------------- */

  const ranked =
    scores
      .map(
        (score, digit) => ({
          digit,
          score
        })
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );


  const best =
    ranked[0];

  const second =
    ranked[1];


  if (!best || !second) {
    return {
      prediction: null,
      confidence: 0,
      status: 'WAIT',
      reason: 'No candidates'
    };
  }


  /* -------------------------------------------------------
     Signal strength

     IMPORTANT:
     This is NOT a probability of winning.
  ------------------------------------------------------- */

  const spread =
    Math.max(
      0,
      best.score -
      second.score
    );


  let confidence =
    50 +
    spread * 100;


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


  /* -------------------------------------------------------
     Require meaningful separation
  ------------------------------------------------------- */

  const strongSignal =
    spread >= 0.05;


  if (!strongSignal) {
    return {
      prediction: null,

      confidence,

      status: 'WAIT',

      reason:
        'Candidates are too close',

      historyLength:
        digits.length,

      candidates:
        ranked.slice(0, 5)
    };
  }


  /* -------------------------------------------------------
     RETURN LDP
  ------------------------------------------------------- */

  return {
    prediction:
      best.digit,

    confidence,

    status:
      'SIGNAL',

    latestDigit:
      digits[digits.length - 1],

    currentRun:
      run,

    historyLength:
      digits.length,

    spread:

      Number(
        spread.toFixed(4)
      ),

    candidates:
      ranked.slice(0, 10),

    analysis: {
      frequency,
      recentFrequency,
      transition,
      pairTransition,
      x2x,
      absence
    },

    reason:
      'LDP multi-pattern analysis'
  };
}


/* =========================================================
   FREQUENCY HELPER
========================================================= */

export function getDigitFrequency(
  inputDigits
) {
  const digits =
    extractLastDigits(
      inputDigits
    );

  return frequencyAnalysis(
    digits
  );
}


/* =========================================================
   EXPORT
========================================================= */

export default {
  analyzeDigitMatch,
  extractLastDigits,
  getDigitFrequency
};
