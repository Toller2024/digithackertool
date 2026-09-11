// Extract last digit from price quote
const getLastDigit = (quote) => Math.floor(quote * 10) % 10;

// Clamp confidence between 55-95%
const clampConfidence = (value) => {
  const clamped = Math.max(55, Math.min(95, value));
  return Math.round(clamped);
};

// Calculate recommended runs based on confidence
const calculateRecommendedRuns = (confidence) => {
  const normalized = (confidence - 85) / 14;
  
  if (normalized > 0.85) {
    return Math.floor(Math.random() * 5) + 11; // 11-15
  } else if (normalized > 0.55) {
    return Math.floor(Math.random() * 6) + 8; // 8-13
  } else {
    return Math.floor(Math.random() * 6) + 5; // 5-10
  }
};

// Analyze Even/Odd pattern
export const analyzeEvenOdd = (ticks) => {
  if (!ticks || ticks.length < 10) return null;
  
  const digits = ticks.map(t => getLastDigit(t.quote)).slice(-30);
  const evenCount = digits.filter(d => d % 2 === 0).length;
  const oddCount = digits.length - evenCount;
  
  const prediction = evenCount > oddCount ? 'EVEN' : 'ODD';
  const ratio = Math.max(evenCount, oddCount) / digits.length;
  const confidence = clampConfidence(ratio * 100);
  
  return { prediction, confidence };
};

// Analyze Over/Under pattern
export const analyzeOverUnder = (ticks) => {
  if (!ticks || ticks.length < 10) return null;
  
  const digits = ticks.map(t => getLastDigit(t.quote)).slice(-30);
  
  const OVER_RANGE = [4, 5, 6, 7];
  const UNDER_RANGE = [2, 3, 4, 5];
  
  const overCount = digits.filter(d => OVER_RANGE.includes(d)).length;
  const underCount = digits.filter(d => UNDER_RANGE.includes(d)).length;
  const totalRelevant = overCount + underCount;
  
  if (totalRelevant === 0) {
    // Random fallback
    const prediction = Math.random() > 0.5 ? 'OVER' : 'UNDER';
    const digit = prediction === 'OVER' ? 6 : 3;
    return {
      prediction,
      label: `${prediction} ${digit}`,
      confidence: 55,
      recommendedRuns: 5
    };
  }
  
  const overRatio = overCount / totalRelevant;
  
  let prediction = 'NEUTRAL';
  let digit = null;
  
  if (overRatio > 0.58) {
    prediction = 'OVER';
    digit = overCount > 18 ? 7 : overCount > 13 ? 6 : 5;
  } else if (overRatio < 0.42) {
    prediction = 'UNDER';
    digit = underCount > 18 ? 2 : underCount > 13 ? 3 : 4;
  }
  
  if (prediction === 'NEUTRAL') return null;
  
  const difference = Math.abs(overCount - underCount);
  const confidenceRaw = totalRelevant > 0 ? (difference / digits.length) * 100 : 0;
  const confidence = clampConfidence(confidenceRaw);
  const recommendedRuns = calculateRecommendedRuns(confidence);
  
  return {
    prediction,
    label: `${prediction} ${digit}`,
    confidence,
    recommendedRuns
  };
};

// Analyze Digit Match pattern
export const analyzeDigitMatch = (ticks) => {
  if (!ticks || ticks.length < 10) return null;
  
  const digits = ticks.map(t => getLastDigit(t.quote)).slice(-30);
  
  // Count frequency of each digit
  const frequency = {};
  digits.forEach(d => {
    frequency[d] = (frequency[d] || 0) + 1;
  });
  
  // Find most frequent digit
  let maxCount = 0;
  let prediction = 0;
  
  Object.entries(frequency).forEach(([digit, count]) => {
    if (count > maxCount) {
      maxCount = count;
      prediction = parseInt(digit);
    }
  });
  
  const confidenceRaw = (maxCount / digits.length) * 100;
  const confidence = clampConfidence(confidenceRaw);
  
  return { prediction, confidence };
};
