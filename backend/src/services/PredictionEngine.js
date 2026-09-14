import Tick from '../models/Tick.js';
import Prediction from '../models/Prediction.js';

/*
 * ==========================================
 * DIGIT PREDICTION ENGINE
 * ==========================================
 *
 * Uses:
 *
 * 1. MARKET MEMORY
 *    - Historical digit frequency
 *    - Historical digit transitions
 *
 * 2. PREDICTION PERFORMANCE MEMORY
 *    - Previous WIN / LOSS results
 *    - Performance of predicted digits
 *
 * The probabilities are empirical.
 * No artificial confidence floor is used.
 *
 * IMPORTANT:
 * This is a statistical model.
 * It cannot guarantee the next digit.
 */

/*
 * ==========================================
 * HISTORICAL MEMORY SIZE
 * ==========================================
 *
 * The database can contain more than 10,000
 * ticks per symbol.
 *
 * The prediction engine will use the latest
 * 10,000 historical ticks.
 */
const HISTORY_LIMIT = 10000;

/*
 * Maximum number of resolved predictions
 * used for performance memory.
 */
const PERFORMANCE_LIMIT = 500;

/*
 * Ten possible digits.
 */
const DIGIT_COUNT = 10;

/*
 * Equal baseline probability.
 *
 * 1 / 10 = 10%
 */
const BASELINE_PROBABILITY = 0.10;

/*
 * Minimum history required before prediction.
 */
const MIN_HISTORY = 30;

/*
 * Minimum performance samples required
 * before performance memory influences
 * a candidate.
 */
const MIN_PERFORMANCE_SAMPLES = 5;

/*
 * Weight assigned to transition memory.
 */
const TRANSITION_WEIGHT = 0.60;

/*
 * Weight assigned to global digit frequency.
 */
const GLOBAL_WEIGHT = 0.25;

/*
 * Weight assigned to prediction performance.
 */
const PERFORMANCE_WEIGHT = 0.15;

/*
 * Signal thresholds.
 *
 * These are actual probability thresholds.
 *
 * No artificial confidence floor is applied.
 */
const ENTRY_PROBABILITY = 0.15;
const WAIT_PROBABILITY = 0.12;

/*
 * ==========================================
 * VALIDATE DIGIT
 * ==========================================
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
 * ==========================================
 * SELECT BEST DIGIT
 * ==========================================
 *
 * If probabilities tie, use supporting
 * evidence to make the selection deterministic.
 */
function selectBestDigit(
  probabilities,
  supportCounts = null
) {
  let bestDigit = null;
  let bestProbability = -1;
  let bestSupport = -1;

  for (
    let digit = 0;
    digit < DIGIT_COUNT;
    digit++
  ) {
    const probability =
      Number(
        probabilities[digit] ?? 0
      );

    const support =
      supportCounts
        ? Number(
            supportCounts[digit] ?? 0
          )
        : 0;

    if (
      probability > bestProbability ||
      (
        probability === bestProbability &&
        support > bestSupport
      )
    ) {
      bestProbability =
        probability;

      bestDigit =
        digit;

      bestSupport =
        support;
    }
  }

  return {
    digit: bestDigit,
    probability: bestProbability,
    support: bestSupport
  };
}

/*
 * ==========================================
 * GET HISTORICAL TICKS
 * ==========================================
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
   * MongoDB returns newest first.
   *
   * Reverse into:
   *
   * oldest -> newest
   */
  return ticks.reverse();
}

/*
 * ==========================================
 * GLOBAL DIGIT FREQUENCY
 * ==========================================
 */
function calculateGlobalProbabilities(
  ticks
) {
  const counts =
    Array(DIGIT_COUNT).fill(0);

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
    Array(DIGIT_COUNT).fill(
      BASELINE_PROBABILITY
    );

  if (total === 0) {
    return {
      counts,
      probabilities,
      total
    };
  }

  for (
    let digit = 0;
    digit < DIGIT_COUNT;
    digit++
  ) {
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
 * ==========================================
 * DIGIT TRANSITION MEMORY
 * ==========================================
 *
 * Example:
 *
 * Current digit = 7
 *
 * Historical:
 *
 * 7 -> 3
 * 7 -> 5
 * 7 -> 3
 * 7 -> 3
 *
 * Then:
 *
 * P(3 | 7) = 75%
 */
function calculateTransitionProbabilities(
  ticks,
  currentDigit
) {
  const counts =
    Array(DIGIT_COUNT).fill(0);

  let totalTransitions = 0;

  for (
    let i = 0;
    i < ticks.length - 1;
    i++
  ) {
    const current =
      validDigit(
        ticks[i].digit
      );

    const next =
      validDigit(
        ticks[i + 1].digit
      );

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
    Array(DIGIT_COUNT).fill(0);

  if (
    totalTransitions === 0
  ) {
    return {
      counts,
      probabilities,
      totalTransitions
    };
  }

  for (
    let digit = 0;
    digit < DIGIT_COUNT;
    digit++
  ) {
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
 * ==========================================
 * PREDICTION PERFORMANCE MEMORY
 * ==========================================
 */
async function calculatePerformanceProbabilities(
  symbol,
  currentDigit
) {
  const counts =
    Array(DIGIT_COUNT).fill(0);

  const wins =
    Array(DIGIT_COUNT).fill(0);

  const losses =
    Array(DIGIT_COUNT).fill(0);

  /*
   * Get resolved predictions only.
   */
  const predictions =
    await Prediction.find({
      symbol,
      result: {
        $in: ['WIN', 'LOSS']
      },
      currentDigit,
      predictedDigit: {
        $gte: 0,
        $lte: 9
      }
    })
      .sort({
        resolvedAt: -1
      })
      .limit(
        PERFORMANCE_LIMIT
      )
      .lean();

  for (
    const prediction of predictions
  ) {
    const predictedDigit =
      validDigit(
        prediction.predictedDigit
      );

    if (
      predictedDigit === null
    ) {
      continue;
    }

    counts[predictedDigit]++;

    if (
      prediction.result === 'WIN'
    ) {
      wins[predictedDigit]++;
    }

    if (
      prediction.result === 'LOSS'
    ) {
      losses[predictedDigit]++;
    }
  }

  /*
   * Neutral baseline.
   */
  const probabilities =
    Array(DIGIT_COUNT).fill(
      BASELINE_PROBABILITY
    );

  for (
    let digit = 0;
    digit < DIGIT_COUNT;
    digit++
  ) {
    if (
      counts[digit] >=
      MIN_PERFORMANCE_SAMPLES
    ) {
      probabilities[digit] =
        wins[digit] /
        counts[digit];
    }
  }

  return {
    counts,
    wins,
    losses,
    probabilities,
    totalPredictions:
      predictions.length
  };
}

/*
 * ==========================================
 * COMBINE MARKET + PERFORMANCE MEMORY
 * ==========================================
 */
function combineProbabilities({
  globalProbabilities,
  transitionProbabilities,
  transitionCount,
  performanceProbabilities,
  performanceCounts
}) {
  const probabilities =
    Array(DIGIT_COUNT).fill(0);

  for (
    let digit = 0;
    digit < DIGIT_COUNT;
    digit++
  ) {
    let marketProbability;

    /*
     * If transition evidence exists,
     * combine transition + global frequency.
     */
    if (
      transitionCount > 0
    ) {
      marketProbability =
        (
          transitionProbabilities[digit] *
          TRANSITION_WEIGHT
        ) +
        (
          globalProbabilities[digit] *
          GLOBAL_WEIGHT
        );
    } else {
      /*
       * No transition evidence.
       *
       * Use global history.
       */
      marketProbability =
        globalProbabilities[digit];
    }

    /*
     * Performance memory is only used when
     * enough evidence exists.
     */
    const performanceSampleCount =
      Number(
        performanceCounts[digit] ?? 0
      );

    if (
      performanceSampleCount >=
      MIN_PERFORMANCE_SAMPLES
    ) {
      probabilities[digit] =
        (
          marketProbability *
          (
            TRANSITION_WEIGHT +
            GLOBAL_WEIGHT
          )
        ) +
        (
          performanceProbabilities[digit] *
          PERFORMANCE_WEIGHT
        );
    } else {
      probabilities[digit] =
        marketProbability;
    }
  }

  /*
   * Normalize final distribution.
   */
  const total =
    probabilities.reduce(
      (sum, value) =>
        sum + value,
      0
    );

  if (
    total > 0 &&
    Number.isFinite(total)
  ) {
    for (
      let digit = 0;
      digit < DIGIT_COUNT;
      digit++
    ) {
      probabilities[digit] =
        probabilities[digit] /
        total;
    }
  }

  return probabilities;
}

/*
 * ==========================================
 * SIGNAL
 * ==========================================
 */
function getSignal(
  probability
) {
  if (
    probability >=
    ENTRY_PROBABILITY
  ) {
    return 'ENTRY';
  }

  if (
    probability >=
    WAIT_PROBABILITY
  ) {
    return 'WAIT';
  }

  return 'NO_ENTRY';
}

/*
 * ==========================================
 * MAIN PREDICTION FUNCTION
 * ==========================================
 */
export async function predictNextDigit(
  symbol
) {
  if (!symbol) {
    throw new Error(
      'Symbol is required for prediction'
    );
  }

  /*
   * ========================================
   * LOAD HISTORICAL MEMORY
   * ========================================
   *
   * Up to 10,000 ticks are now available
   * to the prediction model.
   */
  const ticks =
    await getHistoricalTicks(
      symbol,
      HISTORY_LIMIT
    );

  /*
   * ========================================
   * MINIMUM HISTORY CHECK
   * ========================================
   */
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

      strategy:
        'digit-transition-performance',

      historySize:
        ticks.length,

      currentDigit: null,

      transitionSamples: 0,

      performanceSamples: 0,

      ready: false,

      reason:
        `Need at least ${MIN_HISTORY} historical ticks`
    };
  }

  /*
   * ========================================
   * CURRENT DIGIT
   * ========================================
   *
   * This digit has already happened.
   *
   * We predict the NEXT digit.
   */
  const lastTick =
    ticks[
      ticks.length - 1
    ];

  const currentDigit =
    validDigit(
      lastTick.digit
    );

  if (
    currentDigit === null
  ) {
    return {
      symbol,

      prediction: null,

      probability: 0,

      probabilityPercent: 0,

      signal: 'NO_ENTRY',

      strategy:
        'digit-transition-performance',

      historySize:
        ticks.length,

      currentDigit: null,

      transitionSamples: 0,

      performanceSamples: 0,

      ready: false,

      reason:
        'Latest historical tick has an invalid digit'
    };
  }

  /*
   * ========================================
   * GLOBAL MARKET MEMORY
   * ========================================
   */
  const global =
    calculateGlobalProbabilities(
      ticks
    );

  /*
   * ========================================
   * TRANSITION MEMORY
   * ========================================
   */
  const transition =
    calculateTransitionProbabilities(
      ticks,
      currentDigit
    );

  /*
   * ========================================
   * PERFORMANCE MEMORY
   * ========================================
   */
  const performance =
    await calculatePerformanceProbabilities(
      symbol,
      currentDigit
    );

  /*
   * ========================================
   * COMBINE ALL MEMORY
   * ========================================
   */
  const probabilities =
    combineProbabilities({
      globalProbabilities:
        global.probabilities,

      transitionProbabilities:
        transition.probabilities,

      transitionCount:
        transition.totalTransitions,

      performanceProbabilities:
        performance.probabilities,

      performanceCounts:
        performance.counts
    });

  /*
   * ========================================
   * SUPPORT COUNTS
   * ========================================
   */
  const supportCounts =
    Array(DIGIT_COUNT).fill(0);

  for (
    let digit = 0;
    digit < DIGIT_COUNT;
    digit++
  ) {
    supportCounts[digit] =
      transition.counts[digit] +
      performance.counts[digit];
  }

  /*
   * ========================================
   * SELECT BEST CANDIDATE
   * ========================================
   */
  const best =
    selectBestDigit(
      probabilities,
      supportCounts
    );

  /*
   * ========================================
   * SIGNAL
   * ========================================
   */
  const signal =
    getSignal(
      best.probability
    );

  /*
   * ========================================
   * RETURN PREDICTION
   * ========================================
   */
  return {
    symbol,

    /*
     * Predicted NEXT digit.
     */
    prediction:
      best.digit,

    /*
     * Raw probability.
     */
    probability:
      best.probability,

    /*
     * Display percentage.
     */
    probabilityPercent:
      Number(
        (
          best.probability *
          100
        ).toFixed(2)
      ),

    signal,

    strategy:
      'digit-transition-performance',

    /*
     * This will now grow until the model
     * reaches the 10,000-tick history window.
     */
    historySize:
      ticks.length,

    currentDigit,

    transitionSamples:
      transition.totalTransitions,

    performanceSamples:
      performance.totalPredictions,

    ready: true,

    /*
     * Full probability distribution.
     */
    probabilities:
      probabilities.map(
        (
          probability,
          digit
        ) => ({
          digit,

          probability:
            Number(
              (
                probability *
                100
              ).toFixed(2)
            ),

          transitionSamples:
            transition.counts[
              digit
            ],

          performanceSamples:
            performance.counts[
              digit
            ],

          performanceWins:
            performance.wins[
              digit
            ],

          performanceLosses:
            performance.losses[
              digit
            ]
        })
      )
  };
}
