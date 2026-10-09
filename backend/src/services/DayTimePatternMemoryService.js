import DayTimePatternMemory from '../models/DayTimePatternMemory.js';
import Tick from '../models/Tick.js';
import Prediction from '../models/Prediction.js';

const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
const MIN_SLOT_OBSERVATIONS = 300;
const MIN_DIGIT_OCCURRENCES = 35;
const MIN_DIGIT_SHARE = 0.15;
const MIN_VALIDATION_SAMPLES = 50;
const MIN_VALIDATION_RATE = 0.98;
const BASELINE = 0.10;

function getLocalParts(epoch) {
  const date = new Date(Number(epoch) * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value;
  const weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  if (weekday < 0 || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { weekday, timeSlot: hour * 60 + minute };
}

function wilsonLowerBound(successes, total) {
  if (!total) return 0;
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const centre = p + z * z / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
  return (centre - margin) / denominator;
}

export async function recordDayTimeTick({ symbol, digit, epoch }) {
  if (!SYMBOLS.includes(symbol) || !Number.isInteger(digit) || digit < 0 || digit > 9) return null;
  const parts = getLocalParts(epoch);
  if (!parts) return null;
  await DayTimePatternMemory.updateOne(
    { symbol, weekday: parts.weekday, timeSlot: parts.timeSlot, digit },
    {
      $inc: { occurrenceCount: 1 },
      $set: { lastObservedEpoch: Number(epoch) },
      $setOnInsert: { firstObservedEpoch: Number(epoch) }
    },
    { upsert: true }
  );
  return parts;
}

export async function findEstablishedDayTimePattern({ symbol, epoch }) {
  if (!SYMBOLS.includes(symbol)) return null;
  const parts = getLocalParts(epoch);
  if (!parts) return null;
  const rows = await DayTimePatternMemory.find({
    symbol, weekday: parts.weekday, timeSlot: parts.timeSlot
  }).lean();
  const total = rows.reduce((sum, row) => sum + Number(row.occurrenceCount || 0), 0);
  if (total < MIN_SLOT_OBSERVATIONS) return null;

  const eligible = rows.map(row => {
    const count = Number(row.occurrenceCount || 0);
    const validationSamples = Number(row.validationSamples || 0);
    const validationWins = Number(row.validationWins || 0);
    const share = count / total;
    const validationRate = validationSamples ? validationWins / validationSamples : 0;
    return {
      ...row, count, total, share, lowerBound: wilsonLowerBound(count, total),
      validationSamples, validationWins, validationRate
    };
  }).filter(row =>
    row.count >= MIN_DIGIT_OCCURRENCES &&
    row.share >= MIN_DIGIT_SHARE &&
    row.lowerBound > BASELINE &&
    row.validationSamples >= MIN_VALIDATION_SAMPLES &&
    row.validationRate >= MIN_VALIDATION_RATE
  ).sort((a,b) => b.share - a.share || b.lowerBound - a.lowerBound);

  const best = eligible[0];
  if (!best) return null;
  const weekdayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const hour = Math.floor(parts.timeSlot / 60);
  const minute = parts.timeSlot % 60;
  return {
    type: 'day-time-established-alert',
    status: 'ESTABLISHED_VERY_HIGH_EVIDENCE',
    evidence: 'HISTORICAL_AND_OUT_OF_SAMPLE_VALIDATION',
    symbol, digit: best.digit,
    weekday: weekdayNames[parts.weekday],
    timeZone: 'Africa/Nairobi',
    timeLabel: String(hour).padStart(2,'0') + ':' + String(minute).padStart(2,'0') + ' EAT',
    historicalOccurrences: best.count,
    historicalTotalObservations: best.total,
    historicalRate: Number((best.share * 100).toFixed(2)),
    historicalLowerBound: Number((best.lowerBound * 100).toFixed(2)),
    baselineRate: 10,
    liftVsBaseline: Number((best.share / BASELINE).toFixed(2)),
    validationSamples: best.validationSamples,
    validationWins: best.validationWins,
    validationLosses: Number(best.validationLosses || 0),
    validationWinRate: Number((best.validationRate * 100).toFixed(2)),
    observedAt: Number(epoch)
  };
}

export async function rebuildDayTimePatternMemory({ symbols = SYMBOLS } = {}) {
  const results = [];
  for (const symbol of symbols.filter(s => SYMBOLS.includes(s))) {
    await DayTimePatternMemory.deleteMany({ symbol });
    const buckets = new Map();
    let processed = 0;
    const cursor = Tick.find({ symbol }).select({ digit: 1, epoch: 1 }).sort({ epoch: 1 }).lean().cursor();
    for await (const tick of cursor) {
      if (!Number.isInteger(tick.digit) || !Number.isFinite(Number(tick.epoch))) continue;
      const parts = getLocalParts(tick.epoch);
      if (!parts) continue;
      const key = [symbol, parts.weekday, parts.timeSlot, tick.digit].join(':');
      const item = buckets.get(key) || {
        symbol, weekday: parts.weekday, timeSlot: parts.timeSlot, digit: tick.digit,
        occurrenceCount: 0, firstObservedEpoch: Number(tick.epoch), lastObservedEpoch: Number(tick.epoch)
      };
      item.occurrenceCount++;
      item.lastObservedEpoch = Number(tick.epoch);
      buckets.set(key, item);
      processed++;
      if (buckets.size >= 5000) {
        await DayTimePatternMemory.bulkWrite(Array.from(buckets.values()).map(item => ({
          updateOne: {
            filter: { symbol: item.symbol, weekday: item.weekday, timeSlot: item.timeSlot, digit: item.digit },
            update: { $set: item }, upsert: true
          }
        })), { ordered: false });
        buckets.clear();
      }
    }
    if (buckets.size) await DayTimePatternMemory.bulkWrite(Array.from(buckets.values()).map(item => ({
      updateOne: {
        filter: { symbol: item.symbol, weekday: item.weekday, timeSlot: item.timeSlot, digit: item.digit },
        update: { $set: item }, upsert: true
      }
    })), { ordered: false });

    // Validation is based on predictions timestamped in the same Nairobi weekday/minute.
    // Rebuild all outcome counters from completed predictions, never from the same tick's frequency alone.
    const outcomes = await Prediction.find({
      symbol, result: { $in: ['WIN','LOSS'] },
      predictedDigit: { $gte: 0, $lte: 9 }, predictionEpoch: { $gte: 0 }
    }).select({ predictedDigit: 1, result: 1, predictionEpoch: 1 }).lean();
    const validation = new Map();
    for (const p of outcomes) {
      const parts = getLocalParts(p.predictionEpoch);
      if (!parts) continue;
      const key = [symbol, parts.weekday, parts.timeSlot, p.predictedDigit].join(':');
      const item = validation.get(key) || { samples: 0, wins: 0, losses: 0 };
      item.samples++;
      if (p.result === 'WIN') item.wins++; else item.losses++;
      validation.set(key, item);
    }
    const writes = [];
    for (const [key, item] of validation) {
      const [sym, weekday, timeSlot, digit] = key.split(':');
      writes.push({
        updateOne: {
          filter: { symbol: sym, weekday: Number(weekday), timeSlot: Number(timeSlot), digit: Number(digit) },
          update: { $set: { validationSamples: item.samples, validationWins: item.wins, validationLosses: item.losses } },
          upsert: true
        }
      });
    }
    for (let i = 0; i < writes.length; i += 1000) await DayTimePatternMemory.bulkWrite(writes.slice(i, i + 1000), { ordered: false });
    results.push({ symbol, processedTicks: processed, patternBuckets: await DayTimePatternMemory.countDocuments({ symbol }), validatedPredictions: outcomes.length });
  }
  return results;
}

export async function getDayTimePatternMemory({ symbol, limit = 50 } = {}) {
  return DayTimePatternMemory.find({ symbol }).sort({ occurrenceCount: -1 }).limit(Math.min(Math.max(Number(limit) || 50, 1), 200)).lean();
}

export async function recordDayTimePredictionOutcome({ symbol, predictedDigit, won, predictionEpoch }) {
  if (!SYMBOLS.includes(symbol) || !Number.isInteger(predictedDigit) || predictedDigit < 0 || predictedDigit > 9) return null;
  const parts = getLocalParts(predictionEpoch);
  if (!parts) return null;
  return DayTimePatternMemory.updateOne(
    { symbol, weekday: parts.weekday, timeSlot: parts.timeSlot, digit: predictedDigit },
    {
      $inc: {
        validationSamples: 1,
        [won ? 'validationWins' : 'validationLosses']: 1
      },
      $setOnInsert: { occurrenceCount: 0, firstObservedEpoch: Number(predictionEpoch) },
      $set: { lastObservedEpoch: Number(predictionEpoch) }
    },
    { upsert: true }
  );
}
