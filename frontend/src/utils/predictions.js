// ============================================================
// DIGIT HACKER TOOL - PREDICTION ENGINE
// ============================================================

// Get the actual final digit of a Deriv quote.
const getLastDigit = (tick) => {
  if (!tick || tick.quote === undefined || tick.quote === null) {
    return null;
  }

  const quote = Number(tick.quote);

  if (!Number.isFinite(quote)) {
    return null;
  }

  // Use Deriv pip_size when available.
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

  // Fallback.
  const formatted = String(tick.quote);

  for (let i = formatted.length - 1; i >= 0; i--) {
    if (/\d/.test(formatted[i])) {
      return Number(formatted[i]);
    }
  }

  return null;
};


// ============================================================
// BASIC HELPERS
// ============================================================

const calculatePercentage = (count, total) => {
  if (!total) return 0;

  return Math.round((count / total) * 100);
};


const countDigits = (digits) => {
  const frequency = {};

  for (let digit = 0; digit <= 9; digit++) {
    frequency[digit] = 0;
  }

  digits.forEach((digit) => {
    if (digit >= 0 && digit <= 9) {
      frequency[digit]++;
    }
  });

  return frequency;
};


// ============================================================
// FIND STRONGEST DIGIT
// ============================================================

const findBestDigit = (frequency) => {
  let bestDigit = 0;
  let bestCount = -1;

  for (let digit = 0; digit <= 9; digit++) {
    if (frequency[digit] > bestCount) {
      bestCount = frequency[digit];
      bestDigit = digit;
    }
  }

  return {
    digit: bestDigit,
    count: bestCount
  };
};


// ============================================================
// DIGIT MATCH
// ============================================================
//
// IMPORTANT:
//
// Frequency is NOT the same thing as probability of winning.
//
// Example:
// 6 occurrences of digit 5 in 30 ticks = 20% observed frequency.
//
// It does NOT mean the next tick has a 20% guaranteed chance
// of being 5.
//
// Therefore we keep:
//   observedFrequency
//   signalStrength
//
// separate.
//
// ============================================================

export const analyzeDigitMatch = (ticks) => {
  if (!ticks || ticks.length < 10) {
    return null;
  }

  const digits = ticks
    .map(getLastDigit)
    .filter((digit) => digit !== null)
    .slice(-30);

  if (digits.length < 10) {
    return null;
  }

  // ----------------------------------------------------------
  // Count ALL 10 digits
  // ----------------------------------------------------------

  const frequency = countDigits(digits);

  // ----------------------------------------------------------
  // Find strongest digit
  // ----------------------------------------------------------

  const best = findBestDigit(frequency);

  const prediction = best.digit;
  const frequencyCount = best.count;

  const observedFrequency = calculatePercentage(
    frequencyCount,
    digits.length
  );

  // ----------------------------------------------------------
  // SECOND-BEST DIGIT
  // ----------------------------------------------------------

  let secondBestCount = 0;

  for (let digit = 0; digit <= 9; digit++) {
    if (digit !== prediction) {
      secondBestCount = Math.max(
        secondBestCount,
        frequency[digit]
      );
    }
  }

  // ----------------------------------------------------------
  // EDGE OVER SECOND-BEST DIGIT
  // ----------------------------------------------------------

  const edge = frequencyCount - secondBestCount;

  // ----------------------------------------------------------
  // STABILITY
  // ----------------------------------------------------------

  const windows = [
    digits.slice(-10),
    digits.slice(-20),
    digits.slice(-30)
  ];

  const windowPredictions = windows.map((window) => {
    if (!window.length) {
      return null;
    }

    const windowFrequency = countDigits(window);
    return findBestDigit(windowFrequency).digit;
  });

  let stability = 0;

  windowPredictions.forEach((digit) => {
    if (digit === prediction) {
      stability++;
    }
  });

  // ----------------------------------------------------------
  // SIGNAL STRENGTH
  // ----------------------------------------------------------
  //
  // This is NOT winning probability.
  //
  // It measures how strong the current setup is based on:
  //
  // - observed frequency
  // - distance from second-best digit
  // - stability
  // - sample size
  //
  // Maximum 100.
  // ----------------------------------------------------------

  let signalStrength = 0;

  // Frequency component
  if (observedFrequency >= 30) {
    signalStrength += 35;
  } else if (observedFrequency >= 25) {
    signalStrength += 28;
  } else if (observedFrequency >= 20) {
    signalStrength += 20;
  } else if (observedFrequency >= 15) {
    signalStrength += 10;
  }

  // Edge component
  if (edge >= 4) {
    signalStrength += 30;
  } else if (edge >= 3) {
    signalStrength += 24;
  } else if (edge >= 2) {
    signalStrength += 16;
  } else if (edge >= 1) {
    signalStrength += 8;
  }

  // Stability component
  if (stability === 3) {
    signalStrength += 25;
  } else if (stability === 2) {
    signalStrength += 15;
  } else if (stability === 1) {
    signalStrength += 5;
  }

  // Sample-size component
  if (digits.length >= 30) {
    signalStrength += 10;
  }

  signalStrength = Math.min(100, signalStrength);

  // ----------------------------------------------------------
  // ENTRY CONDITIONS
  // ----------------------------------------------------------
  //
  // We require:
  //
  // 30 valid ticks
  // strong enough frequency
  // meaningful edge
  // stable prediction
  //
  // This is deliberately strict.
  // ----------------------------------------------------------

  const qualifiesForEntry =
    digits.length >= 30 &&
    observedFrequency >= 20 &&
    edge >= 2 &&
    stability >= 2;

  let signal = 'NO ENTRY';

  if (qualifiesForEntry) {
    signal = 'ENTRY';
  } else if (
    digits.length >= 20 &&
    observedFrequency >= 15 &&
    stability >= 2
  ) {
    signal = 'WAIT';
  }

  // ----------------------------------------------------------
  // ONE RUN ONLY
  // ----------------------------------------------------------

  const recommendedRuns =
    signal === 'ENTRY'
      ? 1
      : 0;

  // ----------------------------------------------------------
  // ENTRY WINDOW
  // ----------------------------------------------------------

  const entryWindowSeconds =
    signal === 'ENTRY'
      ? 3
      : 0;

  // ----------------------------------------------------------
  // RETURN
  // ----------------------------------------------------------

  return {
    prediction,

    // This is actual occurrence frequency,
    // NOT a guaranteed probability.
    confidence: observedFrequency,

    observedFrequency,

    frequency: frequencyCount,

    frequencyTable: frequency,

    secondBestCount,

    edge,

    stability,

    sampleSize: digits.length,

    signalStrength,

    entryScore: signalStrength,

    signal,

    recommendedRuns,

    entryWindowSeconds
  };
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
    .filter((digit) => digit !== null)
    .slice(-30);

  if (digits.length < 10) {
    return null;
  }

  const evenCount = digits.filter(
    (digit) => digit % 2 === 0
  ).length;

  const oddCount =
    digits.length - evenCount;

  const prediction =
    evenCount > oddCount
      ? 'EVEN'
      : 'ODD';

  const winningCount =
    Math.max(evenCount, oddCount);

  return {
    prediction,
    confidence: calculatePercentage(
      winningCount,
      digits.length
    )
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
    .filter((digit) => digit !== null)
    .slice(-30);

  if (digits.length < 10) {
    return null;
  }

  const overCount = digits.filter(
    (digit) => digit >= 5
  ).length;

  const underCount = digits.filter(
    (digit) => digit <= 4
  ).length;

  const prediction =
    overCount > underCount
      ? 'OVER'
      : 'UNDER';

  const winningCount =
    Math.max(overCount, underCount);

  return {
    prediction,
    confidence: calculatePercentage(
      winningCount,
      digits.length
    ),
    recommendedRuns: 1
  };
};
