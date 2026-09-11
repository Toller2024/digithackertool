// frontend/src/utils/predictions.js

/**
 * Digit Match NEXT prediction engine
 *
 * Input:
 *   digits = [0, 3, 7, 7, 1, ...]
 *
 * Returns:
 * {
 *   prediction: 0-9,
 *   confidence: 0-100,
 *   signal: "STRONG" | "MEDIUM" | "WEAK" | "WAIT",
 *   sampleSize: number
 * }
 *
 * This predicts the NEXT digit. It does not guarantee the outcome.
 */

const MIN_HISTORY = 30;
const MAX_HISTORY = 200;

function cleanDigits(input) {
  if (!Array.isArray(input)) return [];

  return input
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 9);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Recency weighting.
 * Newer ticks receive more weight than older ticks.
 */
function recencyScore(digits) {
  const scores = Array(10).fill(0);
  const n = digits.length;

  digits.forEach((digit, index) => {
    const age = n - index;
    const weight = Math.exp(-age / 35);
    scores[digit] += weight;
  });

  return scores;
}

/**
 * Frequency in different windows.
 */
function windowScores(digits) {
  const scores = Array(10).fill(0);

  const windows = [
    { size: 20, weight: 0.50 },
    { size: 50, weight: 0.30 },
    { size: 100, weight: 0.20 },
  ];

  windows.forEach(({ size, weight }) => {
    const window = digits.slice(-size);

    if (!window.length) return;

    const counts = Array(10).fill(0);

    window.forEach((digit) => {
      counts[digit]++;
    });

    window.forEach((_, index) => {
      // normalized frequency
      for (let digit = 0; digit <= 9; digit++) {
        scores[digit] +=
          (counts[digit] / window.length) * weight;
      }
    });
  });

  return scores;
}

/**
 * How long each digit has been absent.
 *
 * Absence is only a small signal. We deliberately do NOT
 * assume that an absent digit must appear next.
 */
function absenceScore(digits) {
  const scores = Array(10).fill(0);

  for (let digit = 0; digit <= 9; digit++) {
    let distance = 0;

    for (let i = digits.length - 1; i >= 0; i--) {
      if (digits[i] === digit) {
        break;
      }

      distance++;
    }

    scores[digit] = Math.min(distance / 30, 1);
  }

  return scores;
}

/**
 * Transition model:
 *
 * Which digit historically followed the current digit?
 */
function transitionScores(digits) {
  const scores = Array(10).fill(0);

  if (digits.length < 2) return scores;

  const lastDigit = digits[digits.length - 1];

  let total = 0;

  for (let i = 0; i < digits.length - 1; i++) {
    if (digits[i] === lastDigit) {
      const nextDigit = digits[i + 1];

      // Recent transitions receive more weight.
      const age = digits.length - i;
      const weight = Math.exp(-age / 60);

      scores[nextDigit] += weight;
      total += weight;
    }
  }

  if (total > 0) {
    for (let digit = 0; digit <= 9; digit++) {
      scores[digit] /= total;
    }
  }

  return scores;
}

/**
 * Pair/sequence transition:
 *
 * Looks at the last two digits and checks what historically
 * followed the same pair.
 */
function pairTransitionScores(digits) {
  const scores = Array(10).fill(0);

  if (digits.length < 3) return scores;

  const a = digits[digits.length - 2];
  const b = digits[digits.length - 1];

  let total = 0;

  for (let i = 0; i < digits.length - 2; i++) {
    if (digits[i] === a && digits[i + 1] === b) {
      const nextDigit = digits[i + 2];

      const age = digits.length - i;
      const weight = Math.exp(-age / 80);

      scores[nextDigit] += weight;
      total += weight;
    }
  }

  if (total > 0) {
    for (let digit = 0; digit <= 9; digit++) {
      scores[digit] /= total;
    }
  }

  return scores;
}

/**
 * Recent run behavior.
 */
function runScore(digits) {
  const scores = Array(10).fill(0);

  if (!digits.length) return scores;

  const last = digits[digits.length - 1];

  let run = 0;

  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] === last) {
      run++;
    } else {
      break;
    }
  }

  // A small counter-pressure against blindly predicting
  // the same digit after an unusually long run.
  if (run >= 3) {
    for (let digit = 0; digit <= 9; digit++) {
      scores[digit] = digit === last ? -0.08 : 0.01;
    }
  }

  return scores;
}

function normalize(scores) {
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  if (max === min) {
    return scores.map(() => 0.5);
  }

  return scores.map((value) => (value - min) / (max - min));
}

/**
 * Main Digit Match predictor.
 */
export function analyzeDigitMatch(inputDigits) {
  let digits = cleanDigits(inputDigits);

  if (digits.length > MAX_HISTORY) {
    digits = digits.slice(-MAX_HISTORY);
  }

  if (digits.length < MIN_HISTORY) {
    return {
      prediction: null,
      confidence: 0,
      signal: "WAIT",
      sampleSize: digits.length,
      message: `Collecting data: ${MIN_HISTORY - digits.length} more ticks needed`,
    };
  }

  const recent = normalize(recencyScore(digits));
  const frequency = normalize(windowScores(digits));
  const absence = normalize(absenceScore(digits));
  const transition = normalize(transitionScores(digits));
  const pairTransition = normalize(pairTransitionScores(digits));
  const run = runScore(digits);

  const finalScores = Array(10).fill(0);

  for (let digit = 0; digit <= 9; digit++) {
    finalScores[digit] =
      recent[digit] * 0.20 +
      frequency[digit] * 0.15 +
      absence[digit] * 0.10 +
      transition[digit] * 0.25 +
      pairTransition[digit] * 0.25 +
      run[digit];
  }

  /**
   * Add a tiny deterministic tie-breaker based on the latest
   * digit so equal scores don't constantly favor digit 0.
   */
  const latest = digits[digits.length - 1];

  for (let digit = 0; digit <= 9; digit++) {
    const distance = Math.abs(digit - latest);
    finalScores[digit] += (10 - distance) * 0.000001;
  }

  const ranked = finalScores
    .map((score, digit) => ({
      digit,
      score,
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1];

  /**
   * Convert model separation into a confidence score.
   * This is model confidence, NOT probability of guaranteed success.
   */
  const separation =
    best.score - second.score;

  const confidence = clamp(
    Math.round(50 + separation * 100),
    1,
    95
  );

  let signal = "WEAK";

  if (confidence >= 75) {
    signal = "STRONG";
  } else if (confidence >= 60) {
    signal = "MEDIUM";
  }

  return {
    prediction: best.digit,
    confidence,
    signal,
    sampleSize: digits.length,
    scores: ranked.map((item) => ({
      digit: item.digit,
      score: Number(item.score.toFixed(4)),
    })),
    latestDigit: latest,
  };
}

/**
 * Helper for when the dashboard stores tick objects instead
 * of raw digits.
 *
 * Supports:
 *   { digit: 7 }
 *   { lastDigit: 7 }
 *   { quote: 123.47 }
 *   { tick: 123.47 }
 */
export function extractLastDigits(ticks) {
  if (!Array.isArray(ticks)) return [];

  return ticks
    .map((tick) => {
      if (typeof tick === "number") {
        return Math.abs(Math.floor(tick * 10)) % 10;
      }

      if (tick && Number.isInteger(Number(tick.digit))) {
        return Number(tick.digit);
      }

      if (tick && Number.isInteger(Number(tick.lastDigit))) {
        return Number(tick.lastDigit);
      }

      const value =
        tick?.quote ??
        tick?.tick ??
        tick?.price ??
        tick?.value;

      if (value === undefined || value === null) {
        return null;
      }

      const stringValue = String(value);

      const digitsOnly = stringValue.replace(/\D/g, "");

      if (!digitsOnly.length) return null;

      return Number(digitsOnly[digitsOnly.length - 1]);
    })
    .filter(
      (digit) =>
        Number.isInteger(digit) &&
        digit >= 0 &&
        digit <= 9
    );
}

export default analyzeDigitMatch;
