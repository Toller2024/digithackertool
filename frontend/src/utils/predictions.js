/**
 * Digit Hacker Tool
 * Live Deriv tick analysis
 *
 * IMPORTANT:
 * This module does NOT claim to know the next digit with certainty.
 * It analyses the actual digits received from the Deriv tick stream.
 *
 * The functions below are intentionally independent of the WebSocket.
 * Your existing tick-stream code can continue feeding ticks into these
 * functions.
 */
/* ============================================================
   CONFIGURATION
   ============================================================ */
const DEFAULT_HISTORY_SIZE = 100;
const MIN_ANALYSIS_TICKS = 20;
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
/* ============================================================
   INTERNAL HELPERS
   ============================================================ */
/**
 * Convert a Deriv quote/tick value into its last digit.
 *
 * Examples:
 * 123.45 -> 5
 * "123.45" -> 5
 *
 * We use the string representation instead of floating-point
 * multiplication so that decimal precision is not accidentally
 * changed by JavaScript.
 */
export function getLastDigit(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value);
  // Remove scientific notation where possible.
  const decimalPart = text.split(".")[1];
  if (decimalPart && decimalPart.length > 0) {
    const digitsOnly = decimalPart.replace(/\D/g, "");
    if (digitsOnly.length > 0) {
      return Number(digitsOnly[digitsOnly.length - 1]);
    }
  }
  // Fallback for integer-like values.
  const numbersOnly = text.replace(/\D/g, "");
  if (!numbersOnly.length) {
    return null;
  }
  return Number(numbersOnly[numbersOnly.length - 1]);
}
/**
 * Extract quote from several possible Deriv tick formats.
 *
 * Supports:
 * tick.quote
 * tick.tick.quote
 * tick.price
 * tick.value
 */
export function getQuote(tick) {
  if (tick === null || tick === undefined) {
    return null;
  }
  if (typeof tick === "number" || typeof tick === "string") {
    return tick;
  }
  if (tick.quote !== undefined) {
    return tick.quote;
  }
  if (tick.tick?.quote !== undefined) {
    return tick.tick.quote;
  }
  if (tick.price !== undefined) {
    return tick.price;
  }
  if (tick.value !== undefined) {
    return tick.value;
  }
  return null;
}
/**
 * Convert incoming ticks into digits.
 */
export function extractDigits(ticks = []) {
  return ticks
    .map(getQuote)
    .map(getLastDigit)
    .filter((digit) => DIGITS.includes(digit));
}
/**
 * Keep only the most recent N digits.
 */
export function limitHistory(digits, size = DEFAULT_HISTORY_SIZE) {
  return digits.slice(-size);
}
/* ============================================================
   DIGIT STATISTICS
   ============================================================ */
/**
 * Count occurrences of every digit.
 */
export function getDigitCounts(digits = []) {
  const counts = {};
  DIGITS.forEach((digit) => {
    counts[digit] = 0;
  });
  digits.forEach((digit) => {
    if (DIGITS.includes(digit)) {
      counts[digit]++;
    }
  });
  return counts;
}
/**
 * Calculate percentage occurrence for every digit.
 */
export function getDigitPercentages(digits = []) {
  const counts = getDigitCounts(digits);
  const total = digits.length;
  const percentages = {};
  DIGITS.forEach((digit) => {
    percentages[digit] =
      total > 0 ? Number(((counts[digit] / total) * 100).toFixed(2)) : 0;
  });
  return percentages;
}
/**
 * Calculate how many ticks have passed since each digit appeared.
 */
export function getDigitRecency(digits = []) {
  const recency = {};
  DIGITS.forEach((digit) => {
    recency[digit] = null;
  });
  for (let i = digits.length - 1; i >= 0; i--) {
    const digit = digits[i];
    if (recency[digit] === null) {
      recency[digit] = digits.length - 1 - i;
    }
  }
  return recency;
}
/* ============================================================
   PATTERN ANALYSIS
   ============================================================ */
/**
 * Find repeated two-digit patterns.
 *
 * Example:
 * 7,2,7,4,7,2,7
 *
 * gives patterns such as:
 * 72
 * 27
 */
export function getTwoDigitPatterns(digits = []) {
  const patterns = {};
  for (let i = 0; i < digits.length - 1; i++) {
    const pattern = `${digits[i]}${digits[i + 1]}`;
    patterns[pattern] = (patterns[pattern] || 0) + 1;
  }
  return patterns;
}
/**
 * Find repeated three-digit patterns.
 */
export function getThreeDigitPatterns(digits = []) {
  const patterns = {};
  for (let i = 0; i < digits.length - 2; i++) {
    const pattern = `${digits[i]}${digits[i + 1]}${digits[i + 2]}`;
    patterns[pattern] = (patterns[pattern] || 0) + 1;
  }
  return patterns;
}
/**
 * Look for the same two-digit pattern appearing previously
 * and examine what digit followed it.
 */
export function getFollowingDigitStats(digits = []) {
  const stats = {};
  for (let i = 0; i < digits.length - 2; i++) {
    const pattern = `${digits[i]}${digits[i + 1]}`;
    const nextDigit = digits[i + 2];
    if (!stats[pattern]) {
      stats[pattern] = {};
    }
    stats[pattern][nextDigit] =
      (stats[pattern][nextDigit] || 0) + 1;
  }
  return stats;
}
/**
 * Find the most recent two-digit pattern and determine what
 * digits followed the same pattern historically.
 */
export function analyzeRecentPattern(digits = []) {
  if (digits.length < 3) {
    return {
      pattern: null,
      candidates: [],
      confidence: 0,
    };
  }
  const lastTwo = `${digits[digits.length - 2]}${digits[digits.length - 1]}`;
  const followingStats = getFollowingDigitStats(digits);
  const stats = followingStats[lastTwo] || {};
  const candidates = Object.entries(stats)
    .map(([digit, count]) => ({
      digit: Number(digit),
      count,
    }))
    .sort((a, b) => b.count - a.count);
  const total = candidates.reduce(
    (sum, candidate) => sum + candidate.count,
    0
  );
  if (!total) {
    return {
      pattern: lastTwo,
      candidates: [],
      confidence: 0,
    };
  }
  const top = candidates[0];
  return {
    pattern: lastTwo,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      probability: Number(
        ((candidate.count / total) * 100).toFixed(2)
      ),
    })),
    confidence: Number(
      ((top.count / total) * 100).toFixed(2)
    ),
  };
}
/* ============================================================
   PREDICTION ENGINE
   ============================================================ */
/**
 * Generate a score for every digit.
 *
 * This combines:
 *
 * 1. Historical frequency
 * 2. Recent frequency
 * 3. Recency
 * 4. Historical continuation of the current two-digit pattern
 *
 * It is deliberately a scoring model, NOT a claim that the
 * next digit is guaranteed.
 */
export function scoreDigits(digits = []) {
  if (digits.length < MIN_ANALYSIS_TICKS) {
    return DIGITS.map((digit) => ({
      digit,
      score: 0,
      frequency: 0,
      recentFrequency: 0,
      recency: null,
      patternProbability: 0,
    }));
  }
  const counts = getDigitCounts(digits);
  const percentages = getDigitPercentages(digits);
  const recency = getDigitRecency(digits);
  // Give the most recent 30 ticks additional weight.
  const recentDigits = digits.slice(-30);
  const recentPercentages = getDigitPercentages(recentDigits);
  const patternAnalysis = analyzeRecentPattern(digits);
  const patternMap = {};
  patternAnalysis.candidates.forEach((candidate) => {
    patternMap[candidate.digit] = candidate.probability;
  });
  return DIGITS.map((digit) => {
    const frequencyScore = percentages[digit];
    const recentScore = recentPercentages[digit];
    const patternScore = patternMap[digit] || 0;
    /*
     * Recency contributes only modestly.
     *
     * We deliberately don't treat a digit being "due" as proof
     * that it must appear next.
     */
    let recencyScore = 0;
    if (recency[digit] !== null) {
      recencyScore = Math.min(recency[digit], 20);
    }
    const score =
      frequencyScore * 0.30 +
      recentScore * 0.30 +
      patternScore * 0.30 +
      recencyScore * 0.10;
    return {
      digit,
      score: Number(score.toFixed(4)),
      frequency: Number(frequencyScore.toFixed(2)),
      recentFrequency: Number(recentScore.toFixed(2)),
      recency: recency[digit],
      patternProbability: Number(patternScore.toFixed(2)),
      historicalCount: counts[digit],
    };
  }).sort((a, b) => b.score - a.score);
}
/**
 * Main Digit Match analyzer.
 */
export function analyzeDigitMatch(ticks = []) {
  const digits = extractDigits(ticks);
  if (digits.length < MIN_ANALYSIS_TICKS) {
    return {
      type: "DIGITMATCH",
      prediction: null,
      confidence: 0,
      status: "collecting",
      sampleSize: digits.length,
      requiredSample: MIN_ANALYSIS_TICKS,
      digits,
      scores: [],
      message: `Collecting ticks: ${digits.length}/${MIN_ANALYSIS_TICKS}`,
    };
  }
  const scores = scoreDigits(digits);
  const best = scores[0];
  const second = scores[1];
  /*
   * Confidence is based on the separation between the first
   * and second candidate rather than pretending the score is
   * a real probability.
   */
  const scoreTotal = scores.reduce(
    (sum, item) => sum + Math.max(item.score, 0),
    0
  );
  const rawProbability =
    scoreTotal > 0 ? (best.score / scoreTotal) * 100 : 0;
  const separation =
    best.score > 0
      ? ((best.score - second.score) / best.score) * 100
      : 0;
  const confidence = Math.min(
    99,
    Math.max(
      0,
      rawProbability * 0.7 + separation * 0.3
    )
  );
  return {
    type: "DIGITMATCH",
    // This is the digit our statistical model currently selects.
    prediction: best.digit,
    confidence: Number(confidence.toFixed(2)),
    status: "ready",
    sampleSize: digits.length,
    lastDigit: digits[digits.length - 1],
    previousDigits: digits.slice(-20),
    scores,
    pattern: analyzeRecentPattern(digits),
    message: `Model candidate: ${best.digit}`,
  };
}
/* ============================================================
   EVEN / ODD
   ============================================================ */
export function analyzeEvenOdd(ticks = []) {
  const digits = extractDigits(ticks);
  if (digits.length < MIN_ANALYSIS_TICKS) {
    return {
      type: "EVENODD",
      prediction: null,
      confidence: 0,
      status: "collecting",
      sampleSize: digits.length,
    };
  }
  const even = digits.filter((digit) => digit % 2 === 0).length;
  const odd = digits.length - even;
  const evenPercentage = (even / digits.length) * 100;
  const oddPercentage = (odd / digits.length) * 100;
  const prediction =
    evenPercentage >= oddPercentage ? "EVEN" : "ODD";
  const confidence =
    prediction === "EVEN"
      ? evenPercentage
      : oddPercentage;
  return {
    type: "EVENODD",
    prediction,
    confidence: Number(confidence.toFixed(2)),
    status: "ready",
    sampleSize: digits.length,
    even,
    odd,
    evenPercentage: Number(evenPercentage.toFixed(2)),
    oddPercentage: Number(oddPercentage.toFixed(2)),
  };
}
/* ============================================================
   OVER / UNDER
   ============================================================ */
export function analyzeOverUnder(ticks = []) {
  const digits = extractDigits(ticks);
  if (digits.length < MIN_ANALYSIS_TICKS) {
    return {
      type: "OVERUNDER",
      prediction: null,
      confidence: 0,
      status: "collecting",
      sampleSize: digits.length,
    };
  }
  const under = digits.filter((digit) => digit < 5).length;
  const over = digits.filter((digit) => digit > 4).length;
  const underPercentage = (under / digits.length) * 100;
  const overPercentage = (over / digits.length) * 100;
  const prediction =
    overPercentage >= underPercentage
      ? "OVER"
      : "UNDER";
  const confidence =
    prediction === "OVER"
      ? overPercentage
      : underPercentage;
  return {
    type: "OVERUNDER",
    prediction,
    confidence: Number(confidence.toFixed(2)),
    status: "ready",
    sampleSize: digits.length,
    over,
    under,
    overPercentage: Number(overPercentage.toFixed(2)),
    underPercentage: Number(underPercentage.toFixed(2)),
  };
}
/* ============================================================
   COMPLETE ANALYSIS
   ============================================================ */
export function analyzeAll(ticks = []) {
  return {
    digitMatch: analyzeDigitMatch(ticks),
    evenOdd: analyzeEvenOdd(ticks),
    overUnder: analyzeOverUnder(ticks),
  };
}
/* ============================================================
   LIVE HISTORY HELPER
   ============================================================ */
/**
 * Add a new tick to an existing history array.
 *
 * Example:
 *
 * history = addTick(history, tick);
 */
export function addTick(
  history = [],
  tick,
  maxSize = DEFAULT_HISTORY_SIZE
) {
  const quote = getQuote(tick);
  const digit = getLastDigit(quote);
  if (digit === null) {
    return history;
  }
  return limitHistory(
    [...history, digit],
    maxSize
  );
}
/**
 * Return useful information for the PredictionCard.
 */
export function getPredictionSummary(ticks = []) {
  const result = analyzeDigitMatch(ticks);
  return {
    prediction: result.prediction,
    confidence: result.confidence,
    status: result.status,
    sampleSize: result.sampleSize,
    lastDigit: result.lastDigit,
    message: result.message,
  };
}
export default {
  getLastDigit,
  getQuote,
  extractDigits,
  limitHistory,
  getDigitCounts,
  getDigitPercentages,
  getDigitRecency,
  getTwoDigitPatterns,
  getThreeDigitPatterns,
  getFollowingDigitStats,
  analyzeRecentPattern,
  scoreDigits,
  analyzeDigitMatch,
  analyzeEvenOdd,
  analyzeOverUnder,
  analyzeAll,
  addTick,
  getPredictionSummary,
};
