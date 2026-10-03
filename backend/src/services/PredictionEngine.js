import Tick from '../models/Tick.js';
import Prediction from '../models/Prediction.js';
import { findTimePatternAlert } from './TimePatternMemoryService.js';

/*
 * ==========================================
 * ADAPTIVE MULTI-SCALE DIGIT ENGINE
 * ==========================================
 *
 * The engine learns from:
 *
 * 1. Global digit frequency
 * 2. Current digit transitions
 * 3. 2-digit patterns
 * 4. 3-digit patterns
 * 5. 4-digit patterns
 * 6. 5-digit patterns
 * 7. 6-digit patterns
 * 8. Historical WIN/LOSS performance
 * 9. Exact-pattern WIN/LOSS performance
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

const HISTORY_LIMIT = 10000;

const PERFORMANCE_LIMIT = 500;

const DIGIT_COUNT = 10;

const MIN_HISTORY = 30;


/*
 * Pattern lengths used simultaneously.
 */
const PATTERN_LENGTHS = [
  2,
  3,
  4,
  5,
  6
];


/*
 * Longer patterns require more evidence
 * before they receive strong influence.
 */
const PATTERN_PRIOR_STRENGTH = 10;


/*
 * Transition evidence reliability.
 */
const TRANSITION_PRIOR_STRENGTH = 20;


/*
 * Base learning weights.
 */
const GLOBAL_WEIGHT = 0.20;

const TRANSITION_WEIGHT = 0.30;

const PATTERN_WEIGHT = 0.40;

/*
 * Established recurring time-pattern evidence.
 * This is intentionally small so time memory cannot
 * overpower the tick/pattern model.
 */
const TIME_PATTERN_WEIGHT = 0.15;


/*
 * Maximum influence of WIN/LOSS learning.
 *
 * This is NOT a confidence floor.
 */
const PERFORMANCE_STRENGTH = 0.50;


/*
 * Minimum probability for signal labels.
 *
 * These do not modify probability.
 */
const ENTRY_PROBABILITY = 0.15;

const WAIT_PROBABILITY = 0.12;


/*
 * Strong disagreement protection.
 *
 * If the leading digit has very weak support
 * compared with the alternatives, the engine
 * can return WAIT instead of forcing ENTRY.
 */
const MIN_PATTERN_AGREEMENT = 2;


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
 * P(next=3 | current=7)
 *
 * = 2/3
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
 * MULTI-SCALE PATTERN MEMORY
 * ==========================================
 *
 * Builds:
 *
 * 2-digit context
 * 3-digit context
 * 4-digit context
 * 5-digit context
 * 6-digit context
 *
 * Example current sequence:
 *
 * 7 3 7 2 5 8
 *
 * 2-digit:
 * 5 8
 *
 * 3-digit:
 * 2 5 8
 *
 * 4-digit:
 * 7 2 5 8
 *
 * 5-digit:
 * 3 7 2 5 8
 *
 * 6-digit:
 * 7 3 7 2 5 8
 */

function calculatePatternMemory(ticks) {
  const results = {};

  for (const length of PATTERN_LENGTHS) {
    results[length] = {
      counts: Array(DIGIT_COUNT).fill(0),
      probabilities: Array(DIGIT_COUNT).fill(0),
      total: 0,
      pattern: [],
      reliability: 0
    };
  }

  /*
   * Build the current contexts once.
   */
  for (const length of PATTERN_LENGTHS) {
    if (ticks.length >= length) {
      results[length].pattern =
        ticks
          .slice(ticks.length - length)
          .map(tick => validDigit(tick.digit));
    }
  }

  /*
   * One pass through history.
   *
   * For every historical position, count the digit
   * immediately following each 2-6 digit context.
   *
   * This replaces five separate full-history scans.
   */
  const maps = {};

  for (const length of PATTERN_LENGTHS) {
    maps[length] = new Map();
  }

  for (let i = 0; i < ticks.length; i++) {
    for (const length of PATTERN_LENGTHS) {
      const nextIndex = i + length;

      if (nextIndex >= ticks.length - 1) {
        continue;
      }

      if (nextIndex >= ticks.length) {
        continue;
      }

      const next = validDigit(ticks[nextIndex]?.digit);

      if (next === null) {
        continue;
      }

      const context = [];

      let valid = true;

      for (let j = 0; j < length; j++) {
        const digit = validDigit(ticks[i + j]?.digit);

        if (digit === null) {
          valid = false;
          break;
        }

        context.push(digit);
      }

      if (!valid) {
        continue;
      }

      const key = context.join(',');

      let counts = maps[length].get(key);

      if (!counts) {
        counts = Array(DIGIT_COUNT).fill(0);
        maps[length].set(key, counts);
      }

      counts[next]++;
    }
  }

  /*
   * Convert only the five CURRENT contexts into
   * probability distributions.
   */
  for (const length of PATTERN_LENGTHS) {
    const pattern = results[length].pattern;

    if (
      pattern.length !== length ||
      pattern.some(digit => digit === null)
    ) {
      continue;
    }

    const counts =
      maps[length].get(pattern.join(',')) ||
      Array(DIGIT_COUNT).fill(0);

    results[length].counts = [...counts];

    results[length].total =
      counts.reduce((sum, value) => sum + value, 0);

    if (results[length].total > 0) {
      for (let digit = 0; digit < DIGIT_COUNT; digit++) {
        results[length].probabilities[digit] =
          counts[digit] / results[length].total;
      }
    }

    results[length].reliability =
      results[length].total /
      (results[length].total + PATTERN_PRIOR_STRENGTH);
  }

  return results;
}

/*
 * ==========================================
 * WIN/LOSS PERFORMANCE MEMORY
 * ==========================================
 *
 * Two levels:
 *
 * 1. EXACT PATTERN + PREDICTED DIGIT
 *
 * 2. CURRENT DIGIT + PREDICTED DIGIT
 *
 * Exact pattern evidence takes priority.
 */

async function calculatePerformanceMemory(
  symbol,
  currentDigit,
  currentPatterns
) {
  const counts = Array(DIGIT_COUNT).fill(0);
  const wins = Array(DIGIT_COUNT).fill(0);
  const losses = Array(DIGIT_COUNT).fill(0);
  const probabilities = Array(DIGIT_COUNT).fill(0);
  const sources = Array(DIGIT_COUNT).fill('none');

  /*
   * General performance for the current digit.
   */
  const generalPredictions =
    await Prediction.find({
      symbol,
      currentDigit,
      result: { $in: ['WIN', 'LOSS'] },
      predictedDigit: { $gte: 0, $lte: 9 }
    })
      .sort({ resolvedAt: -1 })
      .limit(PERFORMANCE_LIMIT)
      .lean();

  const generalCounts = Array(DIGIT_COUNT).fill(0);
  const generalWins = Array(DIGIT_COUNT).fill(0);
  const generalLosses = Array(DIGIT_COUNT).fill(0);

  for (const prediction of generalPredictions) {
    const digit = validDigit(prediction.predictedDigit);

    if (digit === null) continue;

    generalCounts[digit]++;

    if (prediction.result === 'WIN') {
      generalWins[digit]++;
    } else if (prediction.result === 'LOSS') {
      generalLosses[digit]++;
    }
  }

  /*
   * Prediction.js currently stores the 3-digit context.
   * Therefore exact-pattern WIN/LOSS learning is based
   * on that stored 3-digit context only. This avoids
   * pretending that 2/4/5/6-digit performance history
   * exists when it is not stored in Prediction documents.
   */
  const exactPattern =
    Array.isArray(currentPatterns[3]?.pattern)
      ? currentPatterns[3].pattern
      : [];

  const contextCounts = Array(DIGIT_COUNT).fill(0);
  const contextWins = Array(DIGIT_COUNT).fill(0);
  const contextLosses = Array(DIGIT_COUNT).fill(0);

  let contextPredictions = [];

  if (
    exactPattern.length === 3 &&
    exactPattern.every(digit => validDigit(digit) !== null)
  ) {
    contextPredictions =
      await Prediction.find({
        symbol,
        pattern: exactPattern,
        result: { $in: ['WIN', 'LOSS'] },
        predictedDigit: { $gte: 0, $lte: 9 }
      })
        .sort({ resolvedAt: -1 })
        .limit(PERFORMANCE_LIMIT)
        .lean();

    for (const prediction of contextPredictions) {
      const digit = validDigit(prediction.predictedDigit);

      if (digit === null) continue;

      contextCounts[digit]++;

      if (prediction.result === 'WIN') {
        contextWins[digit]++;
      } else if (prediction.result === 'LOSS') {
        contextLosses[digit]++;
      }
    }
  }

  /*
   * Exact 3-digit context takes priority.
   * Otherwise use broader current-digit performance.
   */
  for (let digit = 0; digit < DIGIT_COUNT; digit++) {
    if (contextCounts[digit] > 0) {
      counts[digit] = contextCounts[digit];
      wins[digit] = contextWins[digit];
      losses[digit] = contextLosses[digit];
      sources[digit] = 'exact-pattern';
    } else if (generalCounts[digit] > 0) {
      counts[digit] = generalCounts[digit];
      wins[digit] = generalWins[digit];
      losses[digit] = generalLosses[digit];
      sources[digit] = 'current-digit';
    }

    /*
     * Laplace smoothing prevents tiny samples such as
     * 1/1 from becoming 100% performance certainty.
     */
    if (counts[digit] > 0) {
      probabilities[digit] =
        (wins[digit] + 1) /
        (counts[digit] + 2);
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

    totalPredictions: generalPredictions.length,

    contextPredictions: contextPredictions.length
  };
}

/*
 * ==========================================
 * MULTI-SCALE PATTERN AGREEMENT
 * ==========================================
 *
 * Count how many pattern lengths support
 * each digit.
 *
 * Example:
 *
 * 2-digit -> 4
 * 3-digit -> 4
 * 4-digit -> 4
 * 5-digit -> 7
 * 6-digit -> 9
 *
 * Digit 4 has strong agreement.
 */

function calculatePatternAgreement(
  patternMemories
) {
  const agreement =
    Array(DIGIT_COUNT).fill(0);

  const weightedAgreement =
    Array(DIGIT_COUNT).fill(0);

  for (
    const length of PATTERN_LENGTHS
  ) {
    const memory =
      patternMemories[length];

    if (
      !memory ||
      memory.total <= 0
    ) {
      continue;
    }


    /*
     * Find the strongest digit for
     * this pattern length.
     */
    let bestDigit = 0;

    let bestProbability = -1;

    for (
      let digit = 0;
      digit < DIGIT_COUNT;
      digit++
    ) {
      const probability =
        memory.probabilities[
          digit
        ] ?? 0;

      if (
        probability >
        bestProbability
      ) {
        bestProbability =
          probability;

        bestDigit =
          digit;
      }
    }


    /*
     * Only count a pattern as agreement
     * when it has meaningful evidence.
     */
    if (
      bestProbability <= 0
    ) {
      continue;
    }

    agreement[bestDigit]++;

    weightedAgreement[bestDigit] +=
      memory.reliability;
  }

  return {
    agreement,
    weightedAgreement
  };
}


/*
 * ==========================================
 * COMBINE MEMORY SOURCES
 * ==========================================
 */

function combineMemories({
  global,
  transition,
  patterns,
  performance,
  timePattern
}) {
  /*
   * Evidence-weighted ensemble.
   *
   * The weights are applied to probability distributions,
   * then normalized. No probability is artificially raised
   * to a target confidence range.
   */
  const transitionReliability =
    transition.total /
    (transition.total + TRANSITION_PRIOR_STRENGTH);

  const transitionWeight =
    transition.total > 0
      ? TRANSITION_WEIGHT * transitionReliability
      : 0;

  const patternWeights = {};
  let totalPatternWeight = 0;

  for (const length of PATTERN_LENGTHS) {
    const memory = patterns[length];

    if (!memory || memory.total <= 0) {
      patternWeights[length] = 0;
      continue;
    }

    const specificity = length / 6;

    const weight =
      memory.reliability * specificity;

    patternWeights[length] = weight;
    totalPatternWeight += weight;
  }

  if (totalPatternWeight > 0) {
    for (const length of PATTERN_LENGTHS) {
      patternWeights[length] =
        (
          patternWeights[length] /
          totalPatternWeight
        ) * PATTERN_WEIGHT;
    }
  }

  const usedPatternWeight =
    PATTERN_LENGTHS.reduce(
      (sum, length) =>
        sum + (patternWeights[length] || 0),
      0
    );

  const globalWeight =
    Math.max(
      0,
      1 -
      transitionWeight -
      usedPatternWeight
    );

  const base = Array(DIGIT_COUNT).fill(0);

  for (let digit = 0; digit < DIGIT_COUNT; digit++) {
    base[digit] =
      (global.probabilities[digit] || 0) *
      globalWeight;

    if (transitionWeight > 0) {
      base[digit] +=
        (transition.probabilities[digit] || 0) *
        transitionWeight;
    }

    for (const length of PATTERN_LENGTHS) {
      const weight =
        patternWeights[length] || 0;

      if (weight <= 0) continue;

      base[digit] +=
        (patterns[length].probabilities[digit] || 0) *
        weight;
    }
  }

  /*
   * WIN/LOSS learning is an evidence adjustment, not
   * a confidence boost. Small samples have little influence.
   */
  const adjusted = [...base];

  for (let digit = 0; digit < DIGIT_COUNT; digit++) {
    const samples = performance.counts[digit] || 0;

    if (samples <= 0) continue;

    const winRate =
      performance.probabilities[digit];

    const reliability =
      samples / (samples + 10);

    const adjustment =
      1 +
      (
        PERFORMANCE_STRENGTH *
        reliability *
        ((winRate - 0.5) * 2)
      );

    adjusted[digit] =
      base[digit] * adjustment;
  }

  /*
   * Established time-pattern evidence.
   *
   * Only an ESTABLISHED record can influence the
   * probability distribution. LEARNING/DEVELOPING
   * records remain informational and contribute zero.
   */
  if (
    timePattern?.status === 'ESTABLISHED' &&
    validDigit(timePattern.digit) !== null
  ) {
    const timeDigit = validDigit(timePattern.digit);
    const timeWeight = TIME_PATTERN_WEIGHT;

    for (let digit = 0; digit < DIGIT_COUNT; digit++) {
      adjusted[digit] *= (1 - timeWeight);
    }

    adjusted[timeDigit] += timeWeight;
  }

  const total =
    adjusted.reduce(
      (sum, value) => sum + value,
      0
    );

  const probabilities =
    Array(DIGIT_COUNT).fill(0);

  if (total > 0) {
    for (let digit = 0; digit < DIGIT_COUNT; digit++) {
      probabilities[digit] =
        adjusted[digit] / total;
    }
  } else {
    /*
     * Defensive fallback. With valid historical data this
     * should not normally be reached.
     */
    for (let digit = 0; digit < DIGIT_COUNT; digit++) {
      probabilities[digit] = 1 / DIGIT_COUNT;
    }
  }

  return {
    probabilities,
    baseProbabilities: base,
    transitionReliability,
    patternWeights,
    globalWeight,
    transitionWeight,
    usedPatternWeight,
    timePatternWeight:
      timePattern?.status === 'ESTABLISHED'
        ? TIME_PATTERN_WEIGHT
        : 0
  };
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
        probabilities[digit] ||
        0
      );

    const support =
      Number(
        supportCounts[digit] ||
        0
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
  probability,
  patternAgreement
) {
  /*
   * Strong probability but no pattern
   * agreement should not automatically
   * become ENTRY.
   */

  if (
    probability >=
      ENTRY_PROBABILITY &&
    patternAgreement >=
      MIN_PATTERN_AGREEMENT
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
        'adaptive-multi-scale-learning',

      historySize:
        ticks.length,

      currentDigit:
        null,

      pattern:
        [],

      patternSamples:
        0,

      transitionSamples:
        0,

      performanceSamples:
        0,

      contextPerformanceSamples:
        0,

      timePattern: null,

      patternAgreement:
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
        'adaptive-multi-scale-learning',

      historySize:
        ticks.length,

      currentDigit:
        null,

      pattern:
        [],

      patternSamples:
        0,

      transitionSamples:
        0,

      performanceSamples:
        0,

      contextPerformanceSamples:
        0,

      timePattern: null,

      patternAgreement:
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
   * MULTI-SCALE PATTERNS
   * ========================================
   */

  const patterns =
    calculatePatternMemory(
      ticks
    );


  /*
   * ========================================
   * PATTERN AGREEMENT
   * ========================================
   */

  const patternAgreement =
    calculatePatternAgreement(
      patterns
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
      patterns
    );

  /*
   * ========================================
   * TIME-PATTERN MEMORY
   * ========================================
   *
   * Only established recurring 10-second
   * patterns are allowed to influence the
   * probability model. This keeps immature
   * 3/3 or 4/4 streaks from becoming signals.
   */
  const timePattern =
    await findTimePatternAlert({
      symbol,
      epoch: lastTick.epoch
    });


  /*
   * ========================================
   * COMBINE EVERYTHING
   * ========================================
   */

  const combined =
    combineMemories({
      global,

      transition,

      patterns,

      performance,

      timePattern
    });


  const probabilities =
    combined.probabilities;


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
      performance.counts[digit];


    for (
      const length of
        PATTERN_LENGTHS
    ) {
      supportCounts[digit] +=
        patterns[length]
          ?.counts[digit] ||
        0;
    }
  }


  /*
   * ========================================
   * SELECT BEST DIGIT
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
      best.probability,

      patternAgreement
        .agreement[
          best.digit
        ] || 0
    );


  /*
   * ========================================
   * SELECTED PERFORMANCE
   * ========================================
   */

  const selectedPerformanceSamples =
    performance.counts[
      best.digit
    ] || 0;


  const selectedWins =
    performance.wins[
      best.digit
    ] || 0;


  const selectedLosses =
    performance.losses[
      best.digit
    ] || 0;


  const selectedWinRate =
    selectedPerformanceSamples > 0
      ? Number(
          (
            performance.probabilities[
              best.digit
            ] *
            100
          ).toFixed(2)
        )
      : null;


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
      'adaptive-multi-scale-learning',

    historySize:
      ticks.length,

    currentDigit,

    /*
     * Keep the 3-digit pattern as the
     * primary stored pattern so it remains
     * compatible with Prediction.js.
     */
    pattern:
      patterns[3]?.pattern ||
      [],

    transitionSamples:
      transition.total,

    patternSamples:
      patterns[3]?.total ||
      0,

    performanceSamples:
      performance.totalPredictions,

    contextPerformanceSamples:
      performance.contextPredictions,

    timePattern:
      timePattern
        ? {
            status: timePattern.status,
            digit: timePattern.digit,
            timeLabel: timePattern.timeLabel,
            timeWindowSeconds: timePattern.timeWindowSeconds,
            predictionSamples: timePattern.predictionSamples,
            wins: timePattern.wins,
            losses: timePattern.losses,
            winRate: timePattern.winRate,
            currentWinStreak: timePattern.currentWinStreak,
            bestWinStreak: timePattern.bestWinStreak
          }
        : null,

    patternAgreement:
      patternAgreement.agreement[
        best.digit
      ] || 0,

    ready:
      true,


    /*
     * ======================================
     * LEARNING SUMMARY
     * ======================================
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
        selectedPerformanceSamples,

      selectedDigitWins:
        selectedWins,

      selectedDigitLosses:
        selectedLosses,

      selectedDigitWinRate:
        selectedWinRate,

      selectedDigitPerformanceSource:
        performance.sources[
          best.digit
        ],

      patternAgreement:
        patternAgreement.agreement[
          best.digit
        ] || 0,

      weightedPatternAgreement:
        Number(
          (
            patternAgreement
              .weightedAgreement[
                best.digit
              ] || 0
          ).toFixed(3)
        )
    },


    /*
     * ======================================
     * MULTI-SCALE PATTERN INFORMATION
     * ======================================
     */

    patternAnalysis:
      PATTERN_LENGTHS.map(
        length => ({
          length,

          pattern:
            patterns[length]
              ?.pattern ||
            [],

          samples:
            patterns[length]
              ?.total ||
            0,

          reliability:
            Number(
              (
                (
                  patterns[length]
                    ?.reliability ||
                  0
                ) *
                100
              ).toFixed(2)
            ),

          strongestDigit:
            (() => {
              const memory =
                patterns[length];

              if (
                !memory ||
                memory.total <= 0
              ) {
                return null;
              }

              let digit = 0;

              let probability = -1;

              for (
                let d = 0;
                d < DIGIT_COUNT;
                d++
              ) {
                if (
                  memory
                    .probabilities[d] >
                  probability
                ) {
                  probability =
                    memory
                      .probabilities[d];

                  digit = d;
                }
              }

              return digit;
            })(),

          strongestProbability:
            (() => {
              const memory =
                patterns[length];

              if (
                !memory ||
                memory.total <= 0
              ) {
                return null;
              }

              const highest =
                Math.max(
                  ...memory
                    .probabilities
                );

              return Number(
                (
                  highest *
                  100
                ).toFixed(2)
              );
            })()
        })
      ),


    /*
     * ======================================
     * ALL DIGIT PROBABILITIES
     * ======================================
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
                    performance
                      .probabilities[
                        digit
                      ] *
                    100
                  ).toFixed(2)
                )
              : null,

          performanceSource:
            performance.sources[
              digit
            ],

          patternAgreement:
            patternAgreement
              .agreement[
                digit
              ] || 0,

          weightedPatternAgreement:
            Number(
              (
                patternAgreement
                  .weightedAgreement[
                    digit
                  ] || 0
              ).toFixed(3)
            ),

          pattern2Samples:
            patterns[2]
              ?.counts[digit] ||
            0,

          pattern3Samples:
            patterns[3]
              ?.counts[digit] ||
            0,

          pattern4Samples:
            patterns[4]
              ?.counts[digit] ||
            0,

          pattern5Samples:
            patterns[5]
              ?.counts[digit] ||
            0,

          pattern6Samples:
            patterns[6]
              ?.counts[digit] ||
            0,

          timePatternMatch:
            timePattern?.status === 'ESTABLISHED' &&
            validDigit(timePattern.digit) === digit
        })
      )
  };
}
