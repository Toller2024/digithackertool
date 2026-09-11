// ============================================================
// DIGIT HACKER TOOL - PREDICTION ENGINE
// ============================================================

// Extract the actual final displayed digit from a Deriv tick.
//
// IMPORTANT:
// We use pip_size when Deriv provides it instead of assuming
// every volatility index has the same decimal precision.
const getLastDigit = (tick) => {
  if (!tick || tick.quote === undefined || tick.quote === null) {
    return null;
  }

  const quote = Number(tick.quote);

  if (!Number.isFinite(quote)) {
    return null;
  }

  // Use Deriv's pip_size when available.
  if (tick.pip_size !== undefined && tick.pip_size !== null) {
    const pipSize = Number(tick.pip_size);

    if (Number.isFinite(pipSize) && pipSize > 0) {
      const decimals = Math.max(
        0,
        Math.round(-Math.log10(pipSize))
      );

      const formatted = quote.toFixed(decimals);
      const lastDigit = formatted.charAt(formatted.length - 1);

      if (/^\d$/.test(lastDigit)) {
        return Number(lastDigit);
      }
    }
  }

  // Fallback if pip_size is not supplied.
  // Find the final numeric character in the quote.
  const formatted = String(tick.quote);

  for (let i = formatted.length - 1; i >= 0; i--) {
    if (/\d/.test(formatted[i])) {
      return Number(formatted[i]);
    }
  }

  return null;
};


// ============================================================
// REAL CONFIDENCE
// ============================================================
//
// NO artificial minimum.
// 3 / 30 = 10%
// 18 / 30 = 60%
// 30 / 30 = 100%
//
// The displayed confidence is the actual calculated value.
// ============================================================

const calculateConfidence = (count, total) => {
  if (!total || total <= 0) {
    return 0;
  }

  return Math.round((count / total) * 100);
};


// ============================================================
// ENTRY SCORE
// ============================================================
//
// This is a signal-quality score, NOT a guarantee of winning.
//
// 100 = all programmed entry conditions are satisfied.
// It must never be presented as a guaranteed 100% win chance.
// ============================================================

const calculateEntryScore = ({
  confidence,
  stability,
  sampleSize
}) => {
  let score = 0;

  // Confidence
  if (confidence >= 80) {
    score += 50;
  } else if (confidence >= 70) {
    score += 40;
  } else if (confidence >= 60) {
    score += 25;
  } else {
    score += 10;
  }

  // Stability
  if (stability >= 3) {
    score += 30;
  } else if (stability >= 2) {
    score += 20;
  } else {
    score += 5;
  }

  // Sample size
  if (sampleSize >= 30) {
    score += 20;
  } else if (sampleSize >= 20) {
    score += 15;
  } else {
    score += 5;
  }

  return Math.min(100, score);
};


// ============================================================
// EVEN / ODD
// ============================================================

export const analyzeEvenOdd = (ticks) => {
  if (!ticks || ticks.length < 10) {
    return null;
  }

  const digits = ticks
    .map(getLastDigit)
    .filter(d => d !== null)
    .slice(-30);

  if (digits.length < 10) {
    return null;
  }

  const evenCount = digits.filter(
    d => d % 2 === 0
  ).length;

  const oddCount = digits.length - evenCount;

  const prediction =
    evenCount > oddCount ? 'EVEN' : 'ODD';

  const winningCount =
    Math.max(evenCount, oddCount);

  const confidence = calculateConfidence(
    winningCount,
    digits.length
  );

  return {
    prediction,
    confidence
  };
};


// ============================================================
// OVER / UNDER
// ============================================================

export const analyzeOverUnder = (ticks) => {
  if (!ticks || ticks.length < 10) {
    return null;
  }

  const digits = ticks
    .map(getLastDigit)
    .filter(d => d !== null)
    .slice(-30);

  if (digits.length < 10) {
    return null;
  }

  // Digits 5-9 = OVER
  // Digits 0-4 = UNDER
  const OVER_RANGE = [5, 6, 7, 8, 9];
  const UNDER_RANGE = [0, 1, 2, 3, 4];

  const overCount = digits.filter(
    d => OVER_RANGE.includes(d)
  ).length;

  const underCount = digits.filter(
    d => UNDER_RANGE.includes(d)
  ).length;

  const total = overCount + underCount;

  if (total === 0) {
    return null;
  }

  const prediction =
    overCount > underCount
      ? 'OVER'
      : 'UNDER';

  const winningCount =
    Math.max(overCount, underCount);

  const confidence = calculateConfidence(
    winningCount,
    total
  );

  return {
    prediction,
    confidence,
    recommendedRuns: 1
  };
};


// ============================================================
// DIGIT MATCH
// ============================================================

export const analyzeDigitMatch = (ticks) => {
  if (!ticks || ticks.length < 10) {
    return null;
  }

  // Extract actual final digits.
  const digits = ticks
    .map(getLastDigit)
    .filter(d => d !== null)
    .slice(-30);

  if (digits.length < 10) {
    return null;
  }


  // ----------------------------------------------------------
  // Count every digit from 0-9
  // ----------------------------------------------------------

  const frequency = {};

  for (let digit = 0; digit <= 9; digit++) {
    frequency[digit] = 0;
  }

  digits.forEach(digit => {
    frequency[digit]++;
  });


  // ----------------------------------------------------------
  // Find most frequent digit
  // ----------------------------------------------------------

  let prediction = 0;
  let maxCount = -1;

  for (let digit = 0; digit <= 9; digit++) {
    if (frequency[digit] > maxCount) {
      maxCount = frequency[digit];
      prediction = digit;
    }
  }


  // ----------------------------------------------------------
  // REAL CONFIDENCE
  // ----------------------------------------------------------
  //
  // Example:
  // 3 occurrences / 30 ticks = 10%
  //
  // NO 55% FLOOR.
  // NO RANDOM INCREASE.
  // ----------------------------------------------------------

  const confidence = calculateConfidence(
    maxCount,
    digits.length
  );


  // ----------------------------------------------------------
  // STABILITY
  // ----------------------------------------------------------
  //
  // Check whether the same predicted digit remains
  // the strongest digit across multiple rolling windows.
  // ----------------------------------------------------------

  let stability = 1;

  const windows = [
    digits.slice(-10),
    digits.slice(-20),
    digits.slice(-30)
  ];

  const windowPredictions = windows.map(window => {
    if (window.length === 0) {
      return null;
    }

    const counts = {};

    window.forEach(digit => {
      counts[digit] =
        (counts[digit] || 0) + 1;
    });

    let bestDigit = null;
    let bestCount = -1;

    Object.entries(counts).forEach(
      ([digit, count]) => {
        if (count > bestCount) {
          bestCount = count;
          bestDigit = Number(digit);
        }
      }
    );

    return bestDigit;
  });

  if (
    windowPredictions[0] === prediction
  ) {
    stability++;
  }

  if (
    windowPredictions[1] === prediction
  ) {
    stability++;
  }


  // ----------------------------------------------------------
  // ENTRY SCORE
  // ----------------------------------------------------------

  const entryScore = calculateEntryScore({
    confidence,
    stability,
    sampleSize: digits.length
  });


  // ----------------------------------------------------------
  // ENTRY CONDITIONS
  // ----------------------------------------------------------
  //
  // A green ENTRY requires:
  //
  // 1. At least 30 ticks
  // 2. At least 70% calculated confidence
  // 3. Stable prediction
  //
  // IMPORTANT:
  // This is NOT a guaranteed winning probability.
  // ----------------------------------------------------------

  const qualifiesForEntry =
    confidence >= 70 &&
    stability >= 2 &&
    digits.length >= 30;


  let signal = 'NO ENTRY';

  if (qualifiesForEntry) {
    signal = 'ENTRY';
  } else if (confidence >= 50) {
    signal = 'WAIT';
  }


  // ----------------------------------------------------------
  // RUN CONTROL
  // ----------------------------------------------------------
  //
  // One qualifying signal = ONE run.
  //
  // No automatic 5-15 runs.
  // No random number of runs.
  // No loss chasing.
  // After the signal is used, the UI should wait for
  // a fresh qualifying signal.
  // ----------------------------------------------------------

  const recommendedRuns =
    signal === 'ENTRY'
      ? 1
      : 0;


  // ----------------------------------------------------------
  // ENTRY WINDOW
  // ----------------------------------------------------------
  //
  // The PredictionCard will use this to start the
  // visual entry countdown.
  //
  // This is a timing window, NOT a guarantee.
  // ----------------------------------------------------------

  const entryWindowSeconds =
    signal === 'ENTRY'
      ? 3
      : 0;


  return {
    prediction,
    confidence,

    // Signal-quality score.
    entryScore,

    // ENTRY / WAIT / NO ENTRY
    signal,

    // Always 1 for a new qualifying signal.
    recommendedRuns,

    // Countdown used by PredictionCard.
    entryWindowSeconds,

    // Number of rolling windows supporting prediction.
    stability,

    // Number of valid ticks analyzed.
    sampleSize: digits.length,

    // Number of times predicted digit appeared.
    frequency: maxCount,

    // Full frequency table for debugging/display.
    frequencyTable: frequency
  };
};
