import Tick from '../models/Tick.js';
import Prediction from '../models/Prediction.js';

/*
 * ==========================================
 * ADAPTIVE DIGIT PREDICTION ENGINE
 * ==========================================
 *
 * Learns from:
 *
 * 1. Global digit frequency
 * 2. Current-digit transitions
 * 3. Repeated 3-digit patterns
 * 4. Historical WIN/LOSS results
 * 5. WIN/LOSS results for the SAME pattern
 *
 * IMPORTANT:
 * This is a statistical model.
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

const PATTERN_LENGTH = 3;


/*
 * Pattern evidence does not become dominant
 * merely because one occurrence exists.
 */
const PATTERN_PRIOR_STRENGTH = 10;


/*
 * Transition evidence reliability.
 */
const TRANSITION_PRIOR_STRENGTH = 20;


/*
 * Learning weights.
 */
const GLOBAL_WEIGHT = 0.20;

const TRANSITION_WEIGHT = 0.35;

const PATTERN_WEIGHT = 0.30;


/*
 * Maximum influence of WIN/LOSS learning.
 *
 * This is NOT a confidence floor.
 */
const PERFORMANCE_STRENGTH = 0.50;


/*
 * Signal thresholds.
 *
 * Ten digits gives a rough 10% baseline.
 *
 * These thresholds do NOT alter probability.
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
 * CURRENT DIGIT TRANSITION MEMORY
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
 *
 * Therefore:
 *
 * P(3 | 7) = 2 / 3
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
 * Current pattern:
 *
 * [7, 3, 7]
 *
 * Historical occurrences:
 *
 * [7,3,7] -> 2
 * [7,3,7] -> 5
 * [7,3,7] -> 2
 *
 * Therefore:
 *
 * P(next=2 | 7,3,7) = 2/3
 */

function calculatePatternMemory(ticks) {
  const counts =
    Array(DIGIT_COUNT).fill(0);

  let total = 0;

  const emptyResult = {
    counts,
    probabilities:
      Array(DIGIT_COUNT).fill(0),
    total,
    pattern: []
  };

  if (
    ticks.length <
    PATTERN_LENGTH
  ) {
    return emptyResult;
  }

  /*
   * Current pattern.
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

  if (
    currentPattern.length !==
      PATTERN_LENGTH ||
    currentPattern.some(
      digit => digit === null
    )
  ) {
    return {
      ...emptyResult,
      pattern: currentPattern
    };
  }

  /*
   * Search historical occurrences.
   *
   * We intentionally exclude the current
   * live pattern occurrence.
   */
  for (
    let i = 0;
    i <
      ticks.length -
        PATTERN_LENGTH;
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
          ticks[i + j]?.digit
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
     * The digit immediately after
     * the historical pattern.
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
     * Never use the current final
     * occurrence as historical evidence.
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
    pattern: currentPattern
  };
}


/*
 * ==========================================
 * WIN/LOSS MEMORY
 * ==========================================
 *
 * TWO LEVELS OF MEMORY:
 *
 * LEVEL 1:
 * Same pattern + same predicted digit
 *
 * LEVEL 2:
 * Same current digit + same predicted digit
 *
 * If exact-pattern evidence exists,
 * it takes priority.
 *
 * Otherwise the broader current-digit
 * history is used as fallback.
 */

async function calculatePerformanceMemory(
  symbol,
  currentDigit,
  currentPattern
) {
  const contextCounts =
    Array(DIGIT_COUNT).fill(0);

  const contextWins =
    Array(DIGIT_COUNT).fill(0);

  const contextLosses =
    Array(DIGIT_COUNT).fill(0);

  const generalCounts =
    Array(DIGIT_COUNT).fill(0);

  const generalWins =
    Array(DIGIT_COUNT).fill(0);

  const generalLosses =
    Array(DIGIT_COUNT).fill(0);


  /*
   * ========================================
   * EXACT PATTERN PERFORMANCE
   * ========================================
   *
   * Example:
   *
   * Pattern = [7,3,7]
   * Prediction = 2
   *
   * WIN
   * WIN
   * LOSS
   *
   * Context win rate = 2/3
   */

  const contextPredictions =
    await Prediction.find({
      symbol,

      pattern:
        currentPattern,

      result: {
        $in: [
          'WIN',
          'LOSS'
        ]
      },

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
    const prediction of
      contextPredictions
  ) {
    const digit =
      validDigit(
        prediction.predictedDigit
      );

    if (digit === null) {
      continue;
    }

    contextCounts[digit]++;

    if (
      prediction.result ===
      'WIN'
    ) {
      contextWins[digit]++;
    }

    if (
      prediction.result ===
      'LOSS'
    ) {
      contextLosses[digit]++;
    }
  }


  /*
   * ========================================
   * GENERAL CURRENT-DIGIT PERFORMANCE
   * ========================================
   *
   * This keeps older predictions useful,
   * including records created before the
   * pattern field was added.
   */

  const generalPredictions =
    await Prediction.find({
      symbol,

      currentDigit,

      result: {
        $in: [
          'WIN',
          'LOSS'
        ]
      },

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
    const prediction of
      generalPredictions
  ) {
    const digit =
      validDigit(
        prediction.predictedDigit
      );

    if (digit === null) {
      continue;
    }

    generalCounts[digit]++;

    if (
      prediction.result ===
      'WIN'
    ) {
      generalWins[digit]++;
    }

    if (
      prediction.result ===
      'LOSS'
    ) {
      generalLosses[digit]++;
    }
  }


  /*
   * ========================================
   * SELECT PERFORMANCE SOURCE
   * ========================================
   *
   * Exact pattern evidence wins.
   *
   * If no exact-pattern record exists
   * for a digit, use general evidence.
   */

  const counts =
    Array(DIGIT_COUNT).fill(0);

  const wins =
    Array(DIGIT_COUNT).fill(0);

  const losses =
    Array(DIGIT_COUNT).fill(0);

  const probabilities =
    Array(DIGIT_COUNT).fill(0);

  const sources =
    Array(DIGIT_COUNT).fill('none');


  for (
    let digit = 0;
    digit < DIGIT_COUNT;
    digit++
  ) {
    if (
      contextCounts[digit] > 0
    ) {
      counts[digit] =
        contextCounts[digit];

      wins[digit] =
        contextWins[digit];

      losses[digit] =
        contextLosses[digit];

      sources[digit] =
        'pattern';
    } else {
      counts[digit] =
        generalCounts[digit];

      wins[digit] =
        generalWins[digit];

      losses[digit] =
        generalLosses[digit];

      sources[digit] =
        generalCounts[digit] > 0
          ? 'current-digit'
          : 'none';
    }

    /*
     * Bayesian-style smoothing.
     *
     * This prevents tiny samples such as
     * 1/1 from becoming 100%.
     *
     * Example:
     *
     * 3 wins / 4 samples
     *
     * becomes:
     *
     * (3 + 1) / (4 + 2)
     *
     * = 66.67%
     *
     * while still being recognized as
     * positive evidence.
     */
    if (
      counts[digit] > 0
    ) {
      probabilities[digit] =
        (
          wins[digit] + 1
        ) /
        (
          counts[digit] + 2
        );
    }
  }


  return {
    counts,
    wins,
    losses,
    probabilities,
    sources,

    contextCounts,
    contextWins,
    contextLosses,

    generalCounts,
    generalWins,
    generalLosses,

    totalPredictions:
      generalPredictions.length,

    contextPredictions:
      contextPredictions.length
  };
}


/*
 * ==========================================
 * COMBINE MEMORY SOURCES
 * ==========================================
 *
 * Global + transition + pattern form the
 * market/context probability.
 *
 * WIN/LOSS memory then adjusts that estimate
 * according to historical performance.
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
   * ========================================
   * EVIDENCE RELIABILITY
   * ========================================
   */

  const transitionReliability =
    transition.total /
    (
      transition.total +
      TRANSITION_PRIOR_STRENGTH
    );

  const patternReliability =
    pattern.total /
    (
      pattern.total +
      PATTERN_PRIOR_STRENGTH
    );


  /*
   * Pattern and transition weights are
   * reduced when their sample sizes are small.
   */

  const effectiveTransitionWeight =
    transition.total > 0
      ? TRANSITION_WEIGHT *
        transitionReliability
      : 0;

  const effectivePatternWeight =
    pattern.total > 0
      ? PATTERN_WEIGHT *
        patternReliability
      : 0;


  /*
   * Whatever weight is not used by
   * transition/pattern goes back to global.
   *
   * This prevents weak evidence from
   * artificially increasing confidence.
   */

  const effectiveGlobalWeight =
    Math.max(
      0,
      1 -
      effectiveTransitionWeight -
      effectivePatternWeight
    );


  /*
   * ========================================
   * BASE PROBABILITY
   * ========================================
   */

  const baseProbabilities =
    Array(DIGIT_COUNT).fill(0);


  for (
    let digit = 0;
    digit < DIGIT_COUNT;
    digit++
  ) {
    const globalProbability =
      global.probabilities[digit] ??
      0;

    const transitionProbability =
      transition.probabilities[digit] ??
      0;

    const patternProbability =
      pattern.probabilities[digit] ??
      0;


    baseProbabilities[digit] =
      (
        globalProbability *
        effectiveGlobalWeight
      ) +

      (
        transitionProbability *
        effectiveTransitionWeight
      ) +

      (
        patternProbability *
        effectivePatternWeight
      );
  }


  /*
   * ========================================
   * APPLY WIN/LOSS LEARNING
   * ========================================
   *
   * Performance modifies the probability
   * instead of replacing it.
   *
   * A digit with a strong historical WIN
   * record gets a boost.
   *
   * A digit with repeated LOSS gets reduced.
   *
   * Sample reliability grows gradually.
   */

  for (
    let digit = 0;
    digit < DIGIT_COUNT;
    digit++
  ) {
    const sampleCount =
      performance.counts[digit] ?? 0;

    if (
      sampleCount <= 0
    ) {
      probabilities[digit] =
        baseProbabilities[digit];

      continue;
    }


    const winRate =
      performance.probabilities[digit] ??
      0.5;


    /*
     * Reliability approaches 1 as the
     * sample count becomes large.
     */
    const reliability =
      sampleCount /
      (
        sampleCount + 10
      );


    /*
     * Convert win rate around the 50%
     * midpoint into an adjustment.
     *
     * 50% = neutral
     * >50% = boost
     * <50% = reduction
     */

    const performanceAdjustment =
      1 +
      (
        PERFORMANCE_STRENGTH *
        reliability *
        (
          (winRate - 0.5) * 2
        )
      );


    probabilities[digit] =
      baseProbabilities[digit] *
      performanceAdjustment;
  }


  /*
   * ========================================
   * NORMALIZE
   * ========================================
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
   * ========================================
   * LOAD HISTORY
   * ========================================
   */

  const ticks =
    await getHistoricalTicks(
      symbol,
      HISTORY_LIMIT
    );


  /*
   * ========================================
   * MINIMUM HISTORY
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

      contextPerformanceSamples:
        0,

      ready:
        false,

      reason:
        `Need at least ${MIN_HISTORY} historical ticks`
    };
  }


  /*
   * ========================================
   * CURRENT DIGIT
   * ========================================
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

      contextPerformanceSamples:
        0,

      ready:
        false,

      reason:
        'Latest historical tick has an invalid digit'
    };
  }


  /*
   * ========================================
   * GLOBAL MEMORY
   * ========================================
   */

  const global =
    calculateGlobalMemory(
      ticks
    );


  /*
   * ========================================
   * TRANSITION MEMORY
   * ========================================
   */

  const transition =
    calculateTransitionMemory(
      ticks,
      currentDigit
    );


  /*
   * ========================================
   * PATTERN MEMORY
   * ========================================
   */

  const pattern =
    calculatePatternMemory(
      ticks
    );


  /*
   * ========================================
   * WIN/LOSS MEMORY
   * ========================================
   */

  const performance =
    await calculatePerformanceMemory(
      symbol,
      currentDigit,
      pattern.pattern
    );


  /*
   * ========================================
   * COMBINE EVERYTHING
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
   * ========================================
   * SUPPORT
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
      global.counts[digit] +
      transition.counts[digit] +
      pattern.counts[digit] +
      performance.counts[digit];
  }


  /*
   * ========================================
   * SELECT
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

    contextPerformanceSamples:
      performance.contextPredictions,

    ready:
      true,

    /*
     * Detailed learning information.
     */
    learning: {
      selectedDigit:
        best.digit,

      selectedDigitProbability:
        Number(
          (
            best.probability *
            100
          ).toFixed(2)
        ),

      selectedDigitPerformanceSamples:
        performance.counts[
          best.digit
        ],

      selectedDigitWins:
        performance.wins[
          best.digit
        ],

      selectedDigitLosses:
        performance.losses[
          best.digit
        ],

      selectedDigitWinRate:
        performance.counts[
          best.digit
        ] > 0
          ? Number(
              (
                performance.probabilities[
                  best.digit
                ] * 100
              ).toFixed(2)
            )
          : null,

      selectedDigitPerformanceSource:
        performance.sources[
          best.digit
        ]
    },

    /*
     * Probability breakdown for every digit.
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
            ],

          performanceWinRate:
            performance.counts[
              digit
            ] > 0
              ? Number(
                  (
                    performance.probabilities[
                      digit
                    ] * 100
                  ).toFixed(2)
                )
              : null,

          performanceSource:
            performance.sources[
              digit
            ]
        })
      )
  };
}
