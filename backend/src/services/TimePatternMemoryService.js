import TimePatternMemory from '../models/TimePatternMemory.js';
import Prediction from '../models/Prediction.js';
import Tick from '../models/Tick.js';

const MIN_DEVELOPING_SAMPLES = 10;

// Legacy live-outcome classification thresholds.
// These are retained only for the legacy status fields returned by
// recordTimePatternOutcome(). Historical discovery uses the stronger
// full-history evidence rules below.
const MIN_ESTABLISHED_SAMPLES = 20;
const MIN_ESTABLISHED_WINS = 14;
const ESTABLISHED_WIN_RATE = 0.70;

// Historical time-pattern evidence is now the primary source of truth.
// 80,000+ collected ticks must be used to discover recurring digit/time
// relationships instead of waiting for 20 live prediction outcomes.
const MIN_HISTORICAL_OBSERVATIONS = 100;
const MIN_HISTORICAL_DIGIT_OCCURRENCES = 20;
const MIN_HISTORICAL_SHARE = 0.15;
const BASELINE_DIGIT_SHARE = 0.10;
const MIN_VALIDATED_PREDICTIONS = 20;
const MIN_VALIDATED_WIN_RATE = 0.70;

function wilsonLowerBound(wins, total, z = 1.96) {
  if (!Number.isFinite(wins) || !Number.isFinite(total) || total <= 0) return 0;
  const p = wins / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return (centre - margin) / denominator;
}

function getTimeSlots(epoch) {
  const date = new Date(Number(epoch) * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const secondsOfDay =
    date.getUTCHours() * 3600 +
    date.getUTCMinutes() * 60 +
    date.getUTCSeconds();

  return {
    tenSecondSlot: Math.floor(secondsOfDay / 10),
    minuteSlot: Math.floor(secondsOfDay / 60)
  };
}

function slotLabel(granularity, timeSlot) {
  const seconds = granularity === '10s' ? timeSlot * 10 : timeSlot * 60;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return String(hours).padStart(2, '0') + ':' +
    String(minutes).padStart(2, '0') + ':' +
    String(secs).padStart(2, '0');
}

function classify(memory) {
  if (!memory) return 'LEARNING';

  const total = Number(memory.wins || 0) + Number(memory.losses || 0);
  const rate = total > 0 ? memory.wins / total : 0;

  if (
    memory.predictionSamples >= MIN_ESTABLISHED_SAMPLES &&
    memory.wins >= MIN_ESTABLISHED_WINS &&
    total > 0 &&
    rate >= ESTABLISHED_WIN_RATE
  ) {
    return 'ESTABLISHED';
  }

  if (memory.predictionSamples >= MIN_DEVELOPING_SAMPLES) {
    return 'DEVELOPING';
  }

  return 'LEARNING';
}

function winRate(memory) {
  const total = Number(memory?.wins || 0) + Number(memory?.losses || 0);
  return total > 0
    ? Number((Number(memory.wins || 0) / total * 100).toFixed(2))
    : null;
}

export async function recordTimePatternTick({ symbol, digit, epoch }) {
  if (
    !symbol ||
    !Number.isInteger(digit) ||
    digit < 0 ||
    digit > 9 ||
    !Number.isFinite(Number(epoch))
  ) {
    return null;
  }

  const slots = getTimeSlots(epoch);
  if (!slots) return null;

  await TimePatternMemory.bulkWrite([
    {
      updateOne: {
        filter: {
          symbol,
          digit,
          granularity: '10s',
          timeSlot: slots.tenSecondSlot
        },
        update: {
          $inc: { occurrenceCount: 1 },
          $set: { lastObservedEpoch: Number(epoch) },
          $setOnInsert: { firstObservedEpoch: Number(epoch) }
        },
        upsert: true
      }
    },
    {
      updateOne: {
        filter: {
          symbol,
          digit,
          granularity: '60s',
          timeSlot: slots.minuteSlot
        },
        update: {
          $inc: { occurrenceCount: 1 },
          $set: { lastObservedEpoch: Number(epoch) },
          $setOnInsert: { firstObservedEpoch: Number(epoch) }
        },
        upsert: true
      }
    }
  ], { ordered: false });

  return slots;
}

export async function recordTimePatternOutcome({
  symbol,
  predictedDigit,
  actualDigit,
  epoch
}) {
  if (
    !symbol ||
    !Number.isInteger(predictedDigit) ||
    predictedDigit < 0 ||
    predictedDigit > 9 ||
    !Number.isInteger(actualDigit) ||
    actualDigit < 0 ||
    actualDigit > 9 ||
    !Number.isFinite(Number(epoch))
  ) {
    return null;
  }

  const slots = getTimeSlots(epoch);
  if (!slots) return null;

  const won = predictedDigit === actualDigit;

  async function updateMemory(granularity, timeSlot) {
    const existing = await TimePatternMemory.findOne({
      symbol,
      digit: predictedDigit,
      granularity,
      timeSlot
    }).lean();

    const previousStreak = Number(existing?.currentWinStreak || 0);
    const nextStreak = won ? previousStreak + 1 : 0;

    const update = {
      $inc: {
        predictionSamples: 1,
        [won ? 'wins' : 'losses']: 1
      },
      $set: {
        lastObservedEpoch: Number(epoch),
        currentWinStreak: nextStreak,
        ...(won
          ? { lastWinEpoch: Number(epoch) }
          : { lastLossEpoch: Number(epoch) })
      },
      $setOnInsert: {
        firstObservedEpoch: Number(epoch)
      }
    };

    if (won) {
      update.$set.bestWinStreak = Math.max(
        Number(existing?.bestWinStreak || 0),
        nextStreak
      );
    }

    return TimePatternMemory.findOneAndUpdate(
      {
        symbol,
        digit: predictedDigit,
        granularity,
        timeSlot
      },
      update,
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    ).lean();
  }

  const [tenSecond, minute] = await Promise.all([
    updateMemory('10s', slots.tenSecondSlot),
    updateMemory('60s', slots.minuteSlot)
  ]);

  return {
    symbol,
    digit: predictedDigit,
    actualDigit,
    won,
    granularity: '10s',
    timeSlot: slots.tenSecondSlot,
    timeLabel: slotLabel('10s', slots.tenSecondSlot),
    predictionSamples: tenSecond.predictionSamples,
    wins: tenSecond.wins,
    losses: tenSecond.losses,
    winRate: winRate(tenSecond),
    status: classify(tenSecond),
    established: classify(tenSecond) === 'ESTABLISHED',
    currentWinStreak: tenSecond.currentWinStreak,
    bestWinStreak: tenSecond.bestWinStreak
  };
}

export async function findTimePatternAlert({ symbol, epoch }) {
  if (!symbol || !Number.isFinite(Number(epoch))) return null;

  const slots = getTimeSlots(epoch);
  if (!slots) return null;

  const granularities = [
    {
      granularity: '10s',
      timeSlot: slots.tenSecondSlot,
      timeWindowSeconds: 10
    },
    {
      granularity: '60s',
      timeSlot: slots.minuteSlot,
      timeWindowSeconds: 60
    }
  ];

  for (const window of granularities) {
    const candidates = await TimePatternMemory.find({
      symbol,
      granularity: window.granularity,
      timeSlot: window.timeSlot,
      occurrenceCount: { $gte: 1 }
    }).lean();

    if (!candidates.length) continue;

    const historicalTotal = candidates.reduce(
      (sum, item) => sum + Number(item.occurrenceCount || 0),
      0
    );

    if (historicalTotal < MIN_HISTORICAL_OBSERVATIONS) continue;

    const scored = candidates
      .map((candidate) => {
        const occurrences = Number(candidate.occurrenceCount || 0);
        const historicalShare =
          historicalTotal > 0 ? occurrences / historicalTotal : 0;

        const historicalLowerBound =
          wilsonLowerBound(occurrences, historicalTotal);

        const validationTotal =
          Number(candidate.predictionSamples || 0);

        const validationWins =
          Number(candidate.wins || 0);

        const validationWinRate =
          validationTotal > 0
            ? validationWins / validationTotal
            : null;

        const validationReady =
          validationTotal >= MIN_VALIDATED_PREDICTIONS;

        const validationPass =
          !validationReady ||
          validationWinRate >= MIN_VALIDATED_WIN_RATE;

        const historicalPass =
          occurrences >= MIN_HISTORICAL_DIGIT_OCCURRENCES &&
          historicalShare >= MIN_HISTORICAL_SHARE &&
          historicalLowerBound > BASELINE_DIGIT_SHARE;

        return {
          ...candidate,
          occurrences,
          historicalTotal,
          historicalShare,
          historicalLowerBound,
          validationTotal,
          validationWins,
          validationWinRate,
          validationReady,
          validationPass,
          historicalPass
        };
      })
      .filter((candidate) =>
        candidate.historicalPass &&
        candidate.validationPass
      )
      .sort((a, b) =>
        b.historicalShare - a.historicalShare ||
        b.historicalLowerBound - a.historicalLowerBound ||
        b.occurrences - a.occurrences
      );

    const best = scored[0];
    if (!best) continue;

    const historicalRatePercent =
      Number((best.historicalShare * 100).toFixed(2));

    const historicalLowerPercent =
      Number((best.historicalLowerBound * 100).toFixed(2));

    const validationRatePercent =
      best.validationWinRate == null
        ? null
        : Number((best.validationWinRate * 100).toFixed(2));

    return {
      type: 'time-pattern-alert',
      symbol,
      digit: best.digit,
      granularity: window.granularity,
      timeLabel: slotLabel(window.granularity, best.timeSlot),
      timeWindowSeconds: window.timeWindowSeconds,

      historicalOccurrences: best.occurrences,
      historicalTotalObservations: best.historicalTotal,
      historicalRate: historicalRatePercent,
      historicalLowerBound: historicalLowerPercent,
      baselineRate: 10,
      liftVsBaseline: Number(
        (best.historicalShare / BASELINE_DIGIT_SHARE).toFixed(2)
      ),

      validationSamples: best.validationTotal,
      validationWins: best.validationWins,
      validationLosses:
        Math.max(0, best.validationTotal - best.validationWins),
      validationWinRate: validationRatePercent,

      predictionSamples: best.predictionSamples || 0,
      wins: best.wins || 0,
      losses: best.losses || 0,
      winRate: winRate(best),

      status: 'ESTABLISHED',
      evidence: 'HISTORICAL_TICKS',
      currentWinStreak: best.currentWinStreak || 0,
      bestWinStreak: best.bestWinStreak || 0,
      observedAt: Number(epoch)
    };
  }

  return null;
}

export async function getTimePatternMemory({ symbol, limit = 20 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

  return TimePatternMemory.find({ symbol })
    .sort({ wins: -1, predictionSamples: -1, occurrenceCount: -1 })
    .limit(safeLimit)
    .lean();
}

export async function rebuildTimePatternMemory({ symbols }) {
  const list =
    Array.isArray(symbols) && symbols.length
      ? symbols
      : ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];

  const results = [];

  for (const symbol of list) {
    await TimePatternMemory.updateMany(
      { symbol },
      {
        $set: {
          occurrenceCount: 0,
          predictionSamples: 0,
          wins: 0,
          losses: 0,
          lastWinEpoch: null,
          lastLossEpoch: null,
          currentWinStreak: 0,
          bestWinStreak: 0
        }
      }
    );

    let processed = 0;

    const cursor = Tick.find({ symbol })
      .select({ digit: 1, epoch: 1 })
      .sort({ epoch: 1 })
      .lean()
      .cursor();

    const buckets = new Map();

    for await (const tick of cursor) {
      if (
        !Number.isInteger(tick.digit) ||
        !Number.isFinite(Number(tick.epoch))
      ) {
        continue;
      }

      const slots = getTimeSlots(tick.epoch);
      if (!slots) continue;

      for (const [
        granularity,
        timeSlot
      ] of [
        ['10s', slots.tenSecondSlot],
        ['60s', slots.minuteSlot]
      ]) {
        const key =
          symbol +
          ':' +
          tick.digit +
          ':' +
          granularity +
          ':' +
          timeSlot;

        const item = buckets.get(key) || {
          symbol,
          digit: tick.digit,
          granularity,
          timeSlot,
          occurrenceCount: 0,
          firstObservedEpoch: Number(tick.epoch),
          lastObservedEpoch: Number(tick.epoch)
        };

        item.occurrenceCount += 1;
        item.lastObservedEpoch = Number(tick.epoch);
        buckets.set(key, item);
      }

      processed += 1;

      if (buckets.size >= 5000) {
        await TimePatternMemory.bulkWrite(
          Array.from(buckets.values()).map((item) => ({
            updateOne: {
              filter: {
                symbol: item.symbol,
                digit: item.digit,
                granularity: item.granularity,
                timeSlot: item.timeSlot
              },
              update: {
                $inc: { occurrenceCount: item.occurrenceCount },
                $set: { lastObservedEpoch: item.lastObservedEpoch },
                $setOnInsert: {
                  firstObservedEpoch: item.firstObservedEpoch
                }
              },
              upsert: true
            }
          })),
          { ordered: false }
        );

        buckets.clear();
      }
    }

    if (buckets.size) {
      await TimePatternMemory.bulkWrite(
        Array.from(buckets.values()).map((item) => ({
          updateOne: {
            filter: {
              symbol: item.symbol,
              digit: item.digit,
              granularity: item.granularity,
              timeSlot: item.timeSlot
            },
            update: {
              $inc: { occurrenceCount: item.occurrenceCount },
              $set: { lastObservedEpoch: item.lastObservedEpoch },
              $setOnInsert: {
                firstObservedEpoch: item.firstObservedEpoch
              }
            },
            upsert: true
          }
        })),
        { ordered: false }
      );
    }

    const predictions = await Prediction.find({
      symbol,
      result: { $in: ['WIN', 'LOSS'] },
      actualDigit: { $gte: 0, $lte: 9 },
      predictedDigit: { $gte: 0, $lte: 9 },
      predictionEpoch: { $gte: 0 }
    })
      .select({
        predictedDigit: 1,
        actualDigit: 1,
        predictionEpoch: 1
      })
      .sort({ resolvedAt: 1 })
      .lean();

    const outcomeBuckets = new Map();

    for (const prediction of predictions) {
      const predictionEpoch = Number(prediction.predictionEpoch);
      if (!Number.isFinite(predictionEpoch)) continue;

      const slots = getTimeSlots(predictionEpoch);
      if (!slots) continue;

      const won =
        prediction.predictedDigit === prediction.actualDigit;

      for (const [
        granularity,
        timeSlot
      ] of [
        ['10s', slots.tenSecondSlot],
        ['60s', slots.minuteSlot]
      ]) {
        const key =
          symbol +
          ':' +
          prediction.predictedDigit +
          ':' +
          granularity +
          ':' +
          timeSlot;

        const item = outcomeBuckets.get(key) || {
          symbol,
          digit: prediction.predictedDigit,
          granularity,
          timeSlot,
          predictionSamples: 0,
          wins: 0,
          losses: 0,
          currentWinStreak: 0,
          bestWinStreak: 0,
          lastObservedEpoch: predictionEpoch,
          firstObservedEpoch: predictionEpoch,
          lastWinEpoch: null,
          lastLossEpoch: null
        };

        item.predictionSamples += 1;
        item.lastObservedEpoch = predictionEpoch;

        if (won) {
          item.wins += 1;
          item.currentWinStreak += 1;
          item.bestWinStreak = Math.max(
            item.bestWinStreak,
            item.currentWinStreak
          );
          item.lastWinEpoch = predictionEpoch;
        } else {
          item.losses += 1;
          item.currentWinStreak = 0;
          item.lastLossEpoch = predictionEpoch;
        }

        outcomeBuckets.set(key, item);
      }
    }

    if (outcomeBuckets.size) {
      const writes = Array.from(outcomeBuckets.values()).map((item) => ({
        updateOne: {
          filter: {
            symbol: item.symbol,
            digit: item.digit,
            granularity: item.granularity,
            timeSlot: item.timeSlot
          },
          update: {
            $set: {
              predictionSamples: item.predictionSamples,
              wins: item.wins,
              losses: item.losses,
              currentWinStreak: item.currentWinStreak,
              bestWinStreak: item.bestWinStreak,
              lastObservedEpoch: item.lastObservedEpoch,
              firstObservedEpoch: item.firstObservedEpoch,
              lastWinEpoch: item.lastWinEpoch,
              lastLossEpoch: item.lastLossEpoch
            }
          },
          upsert: true
        }
      }));

      for (let i = 0; i < writes.length; i += 1000) {
        await TimePatternMemory.bulkWrite(
          writes.slice(i, i + 1000),
          { ordered: false }
        );
      }
    }

    results.push({
      symbol,
      processed,
      resolvedPredictionsApplied: predictions.length,
      timePatternBuckets: outcomeBuckets.size
    });
  }

  return results;
}

export {
  MIN_DEVELOPING_SAMPLES,
  MIN_ESTABLISHED_SAMPLES,
  MIN_ESTABLISHED_WINS,
  ESTABLISHED_WIN_RATE
};
