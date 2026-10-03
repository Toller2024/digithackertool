import TimePatternMemory from '../models/TimePatternMemory.js';

const MIN_DEVELOPING_SAMPLES = 10;
const MIN_ESTABLISHED_SAMPLES = 20;
const MIN_ESTABLISHED_WINS = 14;
const ESTABLISHED_WIN_RATE = 0.70;

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
  if (memory.predictionSamples >= MIN_ESTABLISHED_SAMPLES &&
      memory.wins >= MIN_ESTABLISHED_WINS &&
      total > 0 && rate >= ESTABLISHED_WIN_RATE) {
    return 'ESTABLISHED';
  }
  if (memory.predictionSamples >= MIN_DEVELOPING_SAMPLES) return 'DEVELOPING';
  return 'LEARNING';
}

function winRate(memory) {
  const total = Number(memory?.wins || 0) + Number(memory?.losses || 0);
  return total > 0 ? Number((Number(memory.wins || 0) / total * 100).toFixed(2)) : null;
}

export async function recordTimePatternTick({ symbol, digit, epoch }) {
  if (!symbol || !Number.isInteger(digit) || digit < 0 || digit > 9 || !Number.isFinite(Number(epoch))) return null;
  const slots = getTimeSlots(epoch);
  if (!slots) return null;

  await TimePatternMemory.bulkWrite([
    { updateOne: {
      filter: { symbol, digit, granularity: '10s', timeSlot: slots.tenSecondSlot },
      update: {
        $inc: { occurrenceCount: 1 },
        $set: { lastObservedEpoch: Number(epoch) },
        $setOnInsert: { firstObservedEpoch: Number(epoch) }
      },
      upsert: true
    }},
    { updateOne: {
      filter: { symbol, digit, granularity: '60s', timeSlot: slots.minuteSlot },
      update: {
        $inc: { occurrenceCount: 1 },
        $set: { lastObservedEpoch: Number(epoch) },
        $setOnInsert: { firstObservedEpoch: Number(epoch) }
      },
      upsert: true
    }}
  ], { ordered: false });

  return slots;
}

export async function recordTimePatternOutcome({ symbol, predictedDigit, actualDigit, epoch }) {
  if (!symbol || !Number.isInteger(predictedDigit) || predictedDigit < 0 || predictedDigit > 9 ||
      !Number.isInteger(actualDigit) || actualDigit < 0 || actualDigit > 9 || !Number.isFinite(Number(epoch))) return null;

  const slots = getTimeSlots(epoch);
  if (!slots) return null;
  const won = predictedDigit === actualDigit;

  async function updateMemory(granularity, timeSlot) {
    const existing = await TimePatternMemory.findOne({
      symbol, digit: predictedDigit, granularity, timeSlot
    }).lean();

    const previousStreak = Number(existing?.currentWinStreak || 0);
    const nextStreak = won ? previousStreak + 1 : 0;

    const update = {
      $inc: { predictionSamples: 1, [won ? 'wins' : 'losses']: 1 },
      $set: {
        lastObservedEpoch: Number(epoch),
        currentWinStreak: nextStreak,
        ...(won ? { lastWinEpoch: Number(epoch) } : { lastLossEpoch: Number(epoch) })
      },
      $setOnInsert: { firstObservedEpoch: Number(epoch) }
    };

    if (won) {
      update.$set.bestWinStreak = Math.max(Number(existing?.bestWinStreak || 0), nextStreak);
    }

    return TimePatternMemory.findOneAndUpdate(
      { symbol, digit: predictedDigit, granularity, timeSlot },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  }

  const [tenSecond, minute] = await Promise.all([
    updateMemory('10s', slots.tenSecondSlot),
    updateMemory('60s', slots.minuteSlot)
  ]);

  const total = Number(tenSecond.wins || 0) + Number(tenSecond.losses || 0);
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

  const candidates = await TimePatternMemory.find({
    symbol,
    granularity: '10s',
    timeSlot: slots.tenSecondSlot,
    predictionSamples: { $gte: MIN_ESTABLISHED_SAMPLES }
  }).sort({ wins: -1, predictionSamples: -1 }).limit(10).lean();

  const established = candidates.find((candidate) => {
    const total = Number(candidate.wins || 0) + Number(candidate.losses || 0);
    const rate = total > 0 ? candidate.wins / total : 0;
    return candidate.predictionSamples >= MIN_ESTABLISHED_SAMPLES &&
      candidate.wins >= MIN_ESTABLISHED_WINS &&
      total > 0 && rate >= ESTABLISHED_WIN_RATE;
  });

  if (!established) return null;

  const total = established.wins + established.losses;
  return {
    type: 'time-pattern-alert',
    symbol,
    digit: established.digit,
    timeLabel: slotLabel('10s', established.timeSlot),
    timeWindowSeconds: 10,
    predictionSamples: established.predictionSamples,
    wins: established.wins,
    losses: established.losses,
    winRate: Number((established.wins / total * 100).toFixed(2)),
    status: 'ESTABLISHED',
    currentWinStreak: established.currentWinStreak,
    bestWinStreak: established.bestWinStreak,
    observedAt: Number(epoch)
  };
}

export async function getTimePatternMemory({ symbol, limit = 20 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return TimePatternMemory.find({ symbol })
    .sort({ wins: -1, predictionSamples: -1, occurrenceCount: -1 })
    .limit(safeLimit).lean();
}

export async function rebuildTimePatternMemory({ symbols }) {
  const Tick = (await import('../models/Tick.js')).default;
  const list = Array.isArray(symbols) && symbols.length ? symbols : ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
  const results = [];

  for (const symbol of list) {
    let processed = 0;
    const cursor = Tick.find({ symbol }).select({ digit: 1, epoch: 1 }).sort({ epoch: 1 }).lean().cursor();
    const buckets = new Map();

    for await (const tick of cursor) {
      if (!Number.isInteger(tick.digit) || !Number.isFinite(Number(tick.epoch))) continue;
      const slots = getTimeSlots(tick.epoch);
      if (!slots) continue;
      const keys = [
        ['10s', slots.tenSecondSlot],
        ['60s', slots.minuteSlot]
      ];
      for (const [granularity, timeSlot] of keys) {
        const key = symbol + ':' + tick.digit + ':' + granularity + ':' + timeSlot;
        const item = buckets.get(key) || { symbol, digit: tick.digit, granularity, timeSlot, occurrenceCount: 0, firstObservedEpoch: Number(tick.epoch), lastObservedEpoch: Number(tick.epoch) };
        item.occurrenceCount += 1;
        item.lastObservedEpoch = Number(tick.epoch);
        buckets.set(key, item);
      }
      processed += 1;
      if (buckets.size >= 5000) {
        await TimePatternMemory.bulkWrite(Array.from(buckets.values()).map(item => ({
          updateOne: {
            filter: { symbol: item.symbol, digit: item.digit, granularity: item.granularity, timeSlot: item.timeSlot },
            update: { $set: { occurrenceCount: item.occurrenceCount, lastObservedEpoch: item.lastObservedEpoch }, $setOnInsert: { firstObservedEpoch: item.firstObservedEpoch } },
            upsert: true
          }
        })), { ordered: false });
        buckets.clear();
      }
    }

    if (buckets.size) {
      await TimePatternMemory.bulkWrite(Array.from(buckets.values()).map(item => ({
        updateOne: {
          filter: { symbol: item.symbol, digit: item.digit, granularity: item.granularity, timeSlot: item.timeSlot },
          update: { $inc: { occurrenceCount: item.occurrenceCount }, $set: { lastObservedEpoch: item.lastObservedEpoch }, $setOnInsert: { firstObservedEpoch: item.firstObservedEpoch } },
          upsert: true
        }
      })), { ordered: false });
    }

    results.push({ symbol, processed });
  }

  return results;
}

export { MIN_DEVELOPING_SAMPLES, MIN_ESTABLISHED_SAMPLES, MIN_ESTABLISHED_WINS, ESTABLISHED_WIN_RATE };