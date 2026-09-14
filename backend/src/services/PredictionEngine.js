import Tick from '../models/Tick.js';

/*
 * DIGIT PREDICTION ENGINE
 *
 * The engine uses historical ticks to estimate
 * the probability of each digit appearing NEXT.
 *
 * It does NOT use the tick that it is trying to
 * predict.
 *
 * The initial model combines:
 *
 * 1. Overall historical digit frequency
 * 2. What digit historically followed the
 *    current last digit
 *
 * This is intentionally transparent so we can
 * measure whether it actually works.
 */

const HISTORY_LIMIT = 500;

/*
 * Equal probability for 10 digits.
 *
 * 0.10 = 10%
 */
const BASELINE_PROBABILITY = 0.10;

/*
 * Minimum historical ticks required before
 * creating a prediction.
 */
const MIN_HISTORY = 30;

/*
 * Minimum probability required before the
 * system calls something an ENTRY.
 *
 * IMPORTANT:
 *
 * This is NOT fake confidence.
 *
 * If the historical probability is 14%,
 * the system displays 14%.
 *
 * It will NOT turn 14% into 55% or 95%.
 */
const ENTRY_PROBABILITY = 0.15;

/*
 * WAIT threshold.
 *
 * Between 10% and 15% means the model sees
 * only a small edge and should wait.
 */
const WAIT_PROBABILITY = 0.12;

/*
 * Safely convert a value to a valid digit.
 */
function validDigit(value) {
  const digit = Number(value);

  if (
    !Number.isInteger(digit) ||
    digit < 0 ||
    digit > 9
  ) {
    return null;
  }

  return digit;
}

/*
 * Find the digit with the highest probability.
 *
 * In case of a tie, the digit with the stronger
 * transition count is preferred.
 */
function selectBestDigit(probabilities) {
  let bestDigit = null;
  let bestProbability = -1;

  for (let digit = 0; digit <= 9; digit++) {
    const probability =
      probabilities[digit] ?? 0;

    if (probability > bestProbability) {
      bestProbability = probability;
      bestDigit = digit;
    }
  }

  return {
    digit: bestDigit,
    probability: bestProbability
  };
}

/*
 * Get recent historical ticks.
 */
export async function getHistoricalTicks(
  symbol,
  limit = HISTORY_LIMIT
) {
  const ticks =
    await Tick.find({
      symbol
    })
      .sort({
        epoch: -1
      })
      .limit(limit)
      .lean();

  /*
   * MongoDB gives newest first.
   *
   * Reverse so the sequence is chronological:
   *
   * oldest -> newest
   */
  return ticks.reverse();
}

/*
 * Build overall digit frequencies.
 */
function calculateGlobalProbabilities(
  ticks
) {
  const counts =
    Array(10).fill(0);

  let total = 0;

  for (const tick of ticks) {
    const digit =
      validDigit(tick.digit);

    if (digit === null) {
      continue;
    }

    counts[digit]++;
    total++;
  }

  const probabilities =
    Array(10).fill(0);

  if (total === 0) {
    return {
      counts,
      probabilities,
      total
    };
  }

  for (let digit = 0; digit <= 9; digit++) {
    probabilities[digit] =
      counts[digit] / total;
  }

  return {
    counts,
    probabilities,
    total
  };
}

/*
 * Calculate which digits historically followed
 * the CURRENT last digit.
 *
 * Example:
 *
 * Current digit = 7
 *
 * Historical sequence:
 *
 * 7 -> 3
 * 7 -> 5
 * 7 -> 3
 * 7 -> 3
 *
 * Then:
 *
 * P(next=3 | current=7) = 75%
 */
function calculateTransitionProbabilities(
  ticks,
  currentDigit
) {
  const counts =
    Array(10).fill(0);

  let totalTransitions = 0;

  for (
    let i = 0;
    i < ticks.length - 1;
    i++
  ) {
    const current =
      validDigit(ticks[i].digit);

    const next =
      validDigit(ticks[i + 1].digit);

    if (
      current === null ||
      next === null
    ) {
      continue;
    }

    if (
      current === currentDigit
    ) {
      counts[next]++;
      totalTransitions++;
    }
  }

  const probabilities =
    Array(10).fill(0);

  if (totalTransitions === 0) {
    return {
      counts,
      probabilities,
      totalTransitions
    };
  }

  for (let digit = 0; digit <= 9; digit++) {
    probabilities[digit] =
      counts[digit] /
      totalTransitions;
  }

  return {
    counts,
    probabilities,
    totalTransitions
  };
}

/*
 * Blend the two sources of information.
 *
 * 70%:
 *   transition probability
 *
 * 30%:
 *   overall historical frequency
 *
 * If there is no transition history for the
 * current digit, we fall back to global history.
 */
function combineProbabilities(
  globalProbabilities,
  transitionProbabilities,
  transitionCount
) {
  const probabilities =
    Array(10).fill(0);

  for (let digit = 0; digit <= 9; digit++) {
    if (transitionCount > 0) {
      probabilities[digit] =
        (
          transitionProbabilities[digit] *
          0.70
        ) +
        (
          globalProbabilities[digit] *
          0.30
        );
    } else {
      probabilities[digit] =
        globalProbabilities[digit];
    }
  }

  return probabilities;
}

/*
 * Decide whether the historical evidence is
 * strong enough to call ENTRY.
 */
function getSignal(probability) {
  if (
    probability >= ENTRY_PROBABILITY
  ) {
    return 'ENTRY';
  }

  if (
    probability >= WAIT_PROBABILITY
  ) {
    return 'WAIT';
  }

  return 'NO_ENTRY';
}

/*
 * MAIN PREDICTION FUNCTION
 */
export async function predictNextDigit(
  symbol
) {
  if (!symbol) {
    throw new Error(
      'Symbol is required for prediction'
    );
  }

  const ticks =
    await getHistoricalTicks(
      symbol,
      HISTORY_LIMIT
    );

  if (
    ticks.length <
    MIN_HISTORY
  ) {
    return {
      symbol,
      prediction: null,
      probability: 0,
      probabilityPercent: 0,
      signal: 'NO_ENTRY',
      strategy: 'digit-transition',
      historySize: ticks.length,
      currentDigit: null,
      transitionSamples: 0,
      ready: false,
      reason:
        `Need at least ${MIN_HISTORY} historical ticks`
    };
  }

  /*
   * The CURRENT digit is the last digit that
   * has already happened.
   *
   * We predict what comes AFTER it.
   */
  const lastTick =
    ticks[ticks.length - 1];

  const currentDigit =
    validDigit(lastTick.digit);

  if (currentDigit === null) {
    return {
      symbol,
      prediction: null,
      probability: 0,
      probabilityPercent: 0,
      signal: 'NO_ENTRY',
      strategy: 'digit-transition',
      historySize: ticks.length,
      currentDigit: null,
      transitionSamples: 0,
      ready: false,
      reason:
        'Latest historical tick has an invalid digit'
    };
  }

  /*
   * Overall history.
   */
  const global =
    calculateGlobalProbabilities(
      ticks
    );

  /*
   * What historically followed the current
   * digit?
   */
  const transition =
    calculateTransitionProbabilities(
      ticks,
      currentDigit
    );

  /*
   * Combine both sources.
   */
  const probabilities =
    combineProbabilities(
      global.probabilities,
      transition.probabilities,
      transition.totalTransitions
    );

  /*
   * Choose the strongest candidate.
   */
  const best =
    selectBestDigit(
      probabilities
    );

  const signal =
    getSignal(best.probability);

  return {
    symbol,

    /*
     * This is the predicted NEXT digit.
     */
    prediction: best.digit,

    /*
     * Raw empirical probability.
     *
     * Example:
     *
     * 0.17 = 17%
     */
    probability:
      best.probability,

    /*
     * Display value.
     *
     * Example:
     *
     * 17
     */
    probabilityPercent:
      Number(
        (
          best.probability * 100
        ).toFixed(2)
      ),

    signal,

    strategy:
      'digit-transition',

    historySize:
      ticks.length,

    currentDigit,

    transitionSamples:
      transition.totalTransitions,

    ready: true,

    /*
     * Useful for debugging and later learning
     * analysis.
     */
    probabilities:
      probabilities.map(
        (probability, digit) => ({
          digit,
          probability:
            Number(
              (
                probability * 100
              ).toFixed(2)
            )
        })
      )
  };
}
