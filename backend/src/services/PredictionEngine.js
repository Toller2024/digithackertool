import Tick from '../models/Tick.js';
import Prediction from '../models/Prediction.js';

/*
 * ==========================================
 * ADAPTIVE DIGIT PREDICTION ENGINE
 * ==========================================
 *
 * The engine learns from:
 *
 * 1. Historical digit frequency
 * 2. Current-digit transitions
 * 3. Recent digit sequences
 * 4. Previous WIN/LOSS performance
 *
 * The model NEVER forces confidence to 55%, 75%,
 * 95%, etc.
 *
 * Probability remains an empirical estimate.
 *
 * IMPORTANT:
 * This is a statistical learning system.
 * It cannot guarantee the next digit.
 */

/*
 * ==========================================
 * SETTINGS
 * ==========================================
 */

const HISTORY_LIMIT = 1000;

const PERFORMANCE_LIMIT = 500;

const DIGIT_COUNT = 10;

const MIN_HISTORY = 30;

const MIN_PATTERN_SAMPLES = 5;

const MIN_PERFORMANCE_SAMPLES = 5;

/*
 * Number of previous digits used to define
 * a recent pattern.
 *
 * Example:
 *
 * 7, 3, 7
 *
 * predicts the digit after that sequence.
 */
const PATTERN_LENGTH = 3;

/*
 * Learning weights.
 *
 * These are evidence weights, not confidence
 * guarantees.
 */
const GLOBAL_WEIGHT = 0.20;

const TRANSITION_WEIGHT = 0.35;

const PATTERN_WEIGHT = 0.30;

const PERFORMANCE_WEIGHT = 0.15;

/*
 * Signal thresholds.
 *
 * With ten equally likely digits the baseline
 * is approximately 10%.
 *
 * These thresholds are NOT confidence floors.
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

  return ticks.reverse();
}


/*
 * ==========================================
 * GLOBAL DIGIT MEMORY
 * ==========================================
 */

function calculateGlobalMemory(ticks) {
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
    Array(DIGIT_COUNT).fill(0);

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
 * CURRENT DIGIT TRANSITION MEMORY
 * ==========================================
 *
 * Example:
 *
 * 7 -> 3
 * 7 -> 5
 * 7 -> 3
 *
 * P(next=3 | current=7)
 *
 * is 2 / 3.
 */

function calculateTransitionMemory(
  ticks,
  currentDigit
) {
  const counts =
    Array(DIGIT_COUNT).fill(0);

  let total = 0;

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
      current !== currentDigit
    ) {
      continue;
    }

    counts[next]++;
    total++;
  }

  const probabilities =
    Array(DIGIT_COUNT).fill(0);

  if (total > 0) {
    for (
      let digit = 0;
      digit < DIGIT_COUNT;
      digit++
    ) {
      probabilities[digit] =
        counts[digit] / total;
    }
  }

  return {
    counts,
    probabilities,
    total
  };
}


/*
 * ==========================================
 * RECENT PATTERN MEMORY
 * ==========================================
 *
 * Example:
 *
 * Pattern:
 *
 * 7 -> 3 -> 7
 *
 * Historical occurrences:
 *
 * 7,3,7 -> 2
 * 7,3,7 -> 5
 * 7,3,7 -> 2
 *
 * Therefore:
 *
 * P(next=2 | 7,3,7) = 2/3
 *
 * This allows the model to recognize repeated
 * short-term contexts.
 */

function calculatePatternMemory(
  ticks,
  currentDigit
) {
  const counts =
    Array(DIGIT_COUNT).fill(0);

  let total = 0;

  if (
    ticks.length <
    PATTERN_LENGTH + 1
  ) {
    return {
      counts,
      probabilities:
        Array(DIGIT_COUNT).fill(0),
      total,
      pattern: []
    };
  }

  /*
   * The current prediction context is the
   * last PATTERN_LENGTH digits.
   */
  const currentPattern =
    ticks
      .slice(
        ticks.length -
          PATTERN_LENGTH
      )
      .map(
        tick =>
          validDigit(
            tick.digit
          )
      );

  /*
   * Make sure the current pattern is valid.
   */
  if (
    currentPattern.length !==
      PATTERN_LENGTH ||
    currentPattern.some(
      digit => digit === null
    )
  ) {
    return {
      counts,
      probabilities:
        Array(DIGIT_COUNT).fill(0),
      total,
      pattern:
        currentPattern
    };
  }

  /*
   * Search historical occurrences of the
   * exact same pattern.
   */
  for (
    let i = 0;
    i <=
      ticks.length -
        PATTERN_LENGTH -
        1;
    i++
  ) {
    let matches = true;

    for (
      let j = 0;
      j < PATTERN_LENGTH;
      j++
    ) {
      const digit =
        validDigit(
          ticks[
            i + j
          ]?.digit
        );

      if (
        digit !==
        currentPattern[j]
      ) {
        matches = false;
        break;
      }
    }

    if (!matches) {
      continue;
    }

    /*
     * The digit immediately after the
     * matching pattern.
     */
    const next =
      validDigit(
        ticks[
          i + PATTERN_LENGTH
        ]?.digit
      );

    if (next === null) {
      continue;
    }

    /*
     * Don't use the current live occurrence
     * as historical evidence.
     *
     * The final pattern occurrence belongs to
     * the current prediction context.
     */
    if (
      i + PATTERN_LENGTH >=
      ticks.length - 1
    ) {
      continue;
    }

    counts[next]++;
    total++;
  }

  const probabilities =
    Array(DIGIT_COUNT).fill(0);

  if (total > 0) {
    for (
      let digit = 0;
      digit < DIGIT_COUNT;
      digit++
    ) {
      probabilities[digit] =
        counts[digit] / total;
    }
  }

  return {
    counts,
    probabilities,
    total,
    pattern:
      currentPattern
  };
}


/*
 * ==========================================
 * PREDICTION PERFORMANCE MEMORY
 * ==========================================
 *
 * Learn from the tool's own previous
 * predictions.
 *
 * Example:
 *
 * Current digit = 7
 * Predicted digit = 3
 *
 * Previous results:
 *
 * 7 -> predicted 3 -> WIN
 * 7 -> predicted 3 -> WIN
 * 7 -> predicted 3 -> LOSS
 *
 * Performance estimate:
 *
 * 2 / 3 = 66.67%
 */

async function calculatePerformanceMemory(
  symbol,
  currentDigit
) {
  const counts =
    Array(DIGIT_COUNT).fill(0);

  const wins =
    Array(DIGIT_COUNT).fill(0);

  const losses =
    Array(DIGIT_COUNT).fill(0);

  const predictions =
    await Prediction.find({
      symbol,

      result: {
        $in: [
          'WIN',
          'LOSS'
        ]
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
      prediction.result ===
      'WIN'
    ) {
      wins[predictedDigit]++;
    }

    if (
      prediction.result ===
      'LOSS'
    ) {
      losses[predictedDigit]++;
    }
  }

  const probabilities =
    Array(DIGIT_COUNT).fill(0);

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
 * COMBINE LEARNING SOURCES
 * ==========================================
 */

function combineMemories({
  global,
  transition,
  pattern,
  performance
}) {
  const probabilities =
    Array(DIGIT_COUNT).fill(0);

  /*
   * Effective weights.
   *
   * If a pattern does not have enough
   * evidence, redistribute its weight.
   *
   * If performance memory does not have
   * enough evidence, redistribute its weight.
   */
  let globalWeight =
    GLOBAL_WEIGHT;

  let transitionWeight =
    TRANSITION_WEIGHT;

  let patternWeight =
    pattern.total >=
    MIN_PATTERN_SAMPLES
      ? PATTERN_WEIGHT
      : 0;

  let performanceWeight =
    performance.counts.some(
      count =>
        count >=
        MIN_PERFORMANCE_SAMPLES
    )
      ? PERFORMANCE_WEIGHT
      : 0;

  let totalWeight =
    globalWeight +
    transitionWeight +
    patternWeight +
    performanceWeight;

  /*
   * If there is no transition evidence,
   * remove its weight.
   */
  if (
    transition.total === 0
  ) {
    transitionWeight = 0;
  }

  /*
   * Recalculate available weight.
   */
  totalWeight =
    globalWeight +
    transitionWeight +
    patternWeight +
    performanceWeight;

  if (
    totalWeight <= 0
  ) {
    return probabilities;
  }

  for (
    let digit = 0;
    digit < DIGIT_COUNT;
    digit++
  ) {
    const globalProbability =
      global.probabilities[
        digit
      ] ?? 0;

    const transitionProbability =
      transition.probabilities[
        digit
      ] ?? 0;

    const patternProbability =
      pattern.probabilities[
        digit
      ] ?? 0;

    const performanceProbability =
      performance.probabilities[
        digit
      ] ?? 0;

    let score = 0;

    score +=
      globalProbability *
      globalWeight;

    if (
      transitionWeight > 0
    ) {
      score +=
        transitionProbability *
        transitionWeight;
    }

    if (
      patternWeight > 0
    ) {
      score +=
        patternProbability *
        patternWeight;
    }

    if (
      performanceWeight > 0
    ) {
      score +=
        performanceProbability *
        performanceWeight;
    }

    probabilities[digit] =
      score /
      totalWeight;
  }

  /*
   * Normalize.
   */
  const total =
    probabilities.reduce(
      (sum, value) =>
        sum + value,
      0
    );

  if (
    total > 0
  ) {
    for (
      let digit = 0;
      digit < DIGIT_COUNT;
      digit++
    ) {
      probabilities[digit] /=
        total;
    }
  }

  return probabilities;
}


/*
 * ==========================================
 * SELECT BEST DIGIT
 * ==========================================
 */

function selectBestDigit(
  probabilities,
  supportCounts
) {
  let bestDigit = 0;

  let bestProbability =
    -1;

  let bestSupport =
    -1;

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
      Number(
        supportCounts[digit] ?? 0
      );

    if (
      probability >
        bestProbability ||
      (
        probability ===
          bestProbability &&
        support >
          bestSupport
      )
    ) {
      bestDigit =
        digit;

      bestProbability =
        probability;

      bestSupport =
        support;
    }
  }

  return {
    digit:
      bestDigit,

    probability:
      bestProbability,

    support:
      bestSupport
  };
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
 * MAIN PREDICTION
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
   * Load up to 1,000 historical ticks.
   */
  const ticks =
    await getHistoricalTicks(
      symbol,
      HISTORY_LIMIT
    );

  /*
   * Minimum history.
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
        'adaptive-context-learning',

      historySize:
        ticks.length,

      currentDigit:
        null,

      pattern:
        [],

      transitionSamples:
        0,

      patternSamples:
        0,

      performanceSamples:
        0,

      ready: false,

      reason:
        `Need at least ${MIN_HISTORY} historical ticks`
    };
  }

  /*
   * Current known digit.
   *
   * This is NOT predicted.
   *
   * We predict the digit AFTER it.
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
        'adaptive-context-learning',

      historySize:
        ticks.length,

      currentDigit:
        null,

      pattern:
        [],

      transitionSamples:
        0,

      patternSamples:
        0,

      performanceSamples:
        0,

      ready: false,

      reason:
        'Latest historical tick has an invalid digit'
    };
  }

  /*
   * ========================================
   * LEARN FROM GLOBAL HISTORY
   * ========================================
   */

  const global =
    calculateGlobalMemory(
      ticks
    );

  /*
   * ========================================
   * LEARN CURRENT DIGIT TRANSITIONS
   * ========================================
   */

  const transition =
    calculateTransitionMemory(
      ticks,
      currentDigit
    );

  /*
   * ========================================
   * LEARN RECENT PATTERN
   * ========================================
   */

  const pattern =
    calculatePatternMemory(
      ticks,
      currentDigit
    );

  /*
   * ========================================
   * LEARN FROM OWN RESULTS
   * ========================================
   */

  const performance =
    await calculatePerformanceMemory(
      symbol,
      currentDigit
    );

  /*
   * ========================================
   * COMBINE ALL MEMORY
   * ========================================
   */

  const probabilities =
    combineMemories({
      global,
      transition,
      pattern,
      performance
    });

  /*
   * Support is used only to break exact
   * probability ties.
   */
  const supportCounts =
    Array(DIGIT_COUNT).fill(0);

  for (
    let digit = 0;
    digit < DIGIT_COUNT;
    digit++
  ) {
    supportCounts[digit] =
      global.counts[digit] +
      transition.counts[digit] +
      pattern.counts[digit] +
      performance.counts[digit];
  }

  /*
   * ========================================
   * SELECT NEXT DIGIT
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
   * RETURN
   * ========================================
   */

  return {
    symbol,

    prediction:
      best.digit,

    probability:
      best.probability,

    probabilityPercent:
      Number(
        (
          best.probability *
          100
        ).toFixed(2)
      ),

    signal,

    strategy:
      'adaptive-context-learning',

    historySize:
      ticks.length,

    currentDigit,

    pattern:
      pattern.pattern,

    transitionSamples:
      transition.total,

    patternSamples:
      pattern.total,

    performanceSamples:
      performance.totalPredictions,

    ready:
      true,

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

          globalSamples:
            global.counts[
              digit
            ],

          transitionSamples:
            transition.counts[
              digit
            ],

          patternSamples:
            pattern.counts[
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
