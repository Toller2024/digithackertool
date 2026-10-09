import DayTimePatternMemory from '../models/DayTimePatternMemory.js';
import Tick from '../models/Tick.js';

const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
const BASELINE = 0.10;
const DISCOVERY_FRACTION = 0.70;

// Requiring appearances on different dates guards against a short cluster of ticks.
// Statistical confidence, rather than a fixed 300-tick cutoff, determines eligibility.
const MIN_DISCOVERY_DATES = 5;
const MIN_VALIDATION_DATES = 3;

function getLocalParts(epoch) {
  const date = new Date(Number(epoch) * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
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
  return { weekday, timeSlot: hour * 60 + minute, dateKey: `${get('year')}-${get('month')}-${get('day')}` };
}

function wilsonLowerBound(successes, total) {
  if (!total || successes < 0 || successes > total) return 0;
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const centre = p + z * z / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
  return (centre - margin) / denominator;
}

function aggregateTick(map, symbol, tick, phase) {
  if (!Number.isInteger(tick.digit) || tick.digit < 0 || tick.digit > 9) return;
  const parts = getLocalParts(tick.epoch);
  if (!parts) return;
  const key = [symbol, parts.weekday, parts.timeSlot, tick.digit].join(':');
  const item = map.get(key) || {
    symbol, weekday: parts.weekday, timeSlot: parts.timeSlot, digit: tick.digit,
    occurrenceCount: 0, discoveryTotalObservations: 0, discoveryDateKeys: [],
    validationOccurrenceCount: 0, validationTotalObservations: 0, validationDateKeys: [],
    firstObservedEpoch: Number(tick.epoch), lastObservedEpoch: Number(tick.epoch)
  };
  const isDiscovery = phase === 'discovery';
  const totalField = isDiscovery ? 'discoveryTotalObservations' : 'validationTotalObservations';
  const countField = isDiscovery ? 'occurrenceCount' : 'validationOccurrenceCount';
  const datesField = isDiscovery ? 'discoveryDateKeys' : 'validationDateKeys';
  item[countField]++;
  item[totalField]++;
  if (!item[datesField].includes(parts.dateKey)) item[datesField].push(parts.dateKey);
  item.firstObservedEpoch = Math.min(item.firstObservedEpoch, Number(tick.epoch));
  item.lastObservedEpoch = Math.max(item.lastObservedEpoch, Number(tick.epoch));
  map.set(key, item);
}

async function flushBuckets(symbol, buckets) {
  if (!buckets.size) return;
  const rows = Array.from(buckets.values());
  // Each digit row needs the total number of ticks observed in its slot, not only its own digit.
  const slotTotals = new Map();
  for (const row of rows) {
    const key = [row.symbol, row.weekday, row.timeSlot].join(':');
    const current = slotTotals.get(key) || { discovery: 0, validation: 0, discoveryDates: new Set(), validationDates: new Set() };
    current.discovery += row.discoveryTotalObservations;
    current.validation += row.validationTotalObservations;
    row.discoveryDateKeys.forEach(date => current.discoveryDates.add(date));
    row.validationDateKeys.forEach(date => current.validationDates.add(date));
    slotTotals.set(key, current);
  }
  // Aggregates are accumulated across cursor batches by the caller before this is called.
  const operations = rows.map(row => {
    const key = [symbol, row.weekday, row.timeSlot].join(':');
    const totals = slotTotals.get(key);
    return {
      updateOne: {
        filter: { symbol, weekday: row.weekday, timeSlot: row.timeSlot, digit: row.digit },
        update: { $set: {
          ...row,
          discoveryTotalObservations: totals.discovery,
          validationTotalObservations: totals.validation,
          discoverySlotDateCount: totals.discoveryDates.size,
          validationSlotDateCount: totals.validationDates.size
        } },
        upsert: true
      }
    };
  });
  for (let i = 0; i < operations.length; i += 1000) {
    await DayTimePatternMemory.bulkWrite(operations.slice(i, i + 1000), { ordered: false });
  }
  buckets.clear();
}

export async function recordDayTimeTick({ symbol, digit, epoch }) {
  if (!SYMBOLS.includes(symbol) || !Number.isInteger(digit) || digit < 0 || digit > 9) return null;
  const parts = getLocalParts(epoch);
  if (!parts) return null;
  // Treat incoming live ticks as new validation data, never as discovery/training data.
  await DayTimePatternMemory.updateMany(
    { symbol, weekday: parts.weekday, timeSlot: parts.timeSlot },
    { $inc: { validationTotalObservations: 1 } }
  );
  await DayTimePatternMemory.updateOne(
    { symbol, weekday: parts.weekday, timeSlot: parts.timeSlot, digit },
    {
      $inc: { validationOccurrenceCount: 1 },
      $addToSet: { validationDateKeys: parts.dateKey },
      $set: { lastObservedEpoch: Number(epoch) },
      $setOnInsert: {
        firstObservedEpoch: Number(epoch),
        occurrenceCount: 0,
        discoveryTotalObservations: 0,
        discoveryDateKeys: [],
        validationTotalObservations: 1
      }
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

  const eligible = rows.map(row => {
    const discoveryTotal = Number(row.discoveryTotalObservations || 0);
    const discoveryCount = Number(row.occurrenceCount || 0);
    const validationTotal = Number(row.validationTotalObservations || 0);
    const validationCount = Number(row.validationOccurrenceCount || 0);
    const discoveryRate = discoveryTotal ? discoveryCount / discoveryTotal : 0;
    const validationRate = validationTotal ? validationCount / validationTotal : 0;
    return {
      ...row, discoveryTotal, discoveryCount, validationTotal, validationCount,
      discoveryRate, validationRate,
      discoveryLowerBound: wilsonLowerBound(discoveryCount, discoveryTotal),
      validationLowerBound: wilsonLowerBound(validationCount, validationTotal),
      discoveryDates: (row.discoveryDateKeys || []).length,
      validationDates: (row.validationDateKeys || []).length
    };
  }).filter(row =>
    row.discoveryDates >= MIN_DISCOVERY_DATES &&
    row.validationDates >= MIN_VALIDATION_DATES &&
    row.discoveryLowerBound > BASELINE &&
    row.validationLowerBound > BASELINE
  ).sort((a, b) =>
    b.validationLowerBound - a.validationLowerBound ||
    b.discoveryLowerBound - a.discoveryLowerBound
  );

  const best = eligible[0];
  if (!best) return null;
  const weekdayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const hour = Math.floor(parts.timeSlot / 60);
  const minute = parts.timeSlot % 60;
  return {
    type: 'day-time-established-alert',
    status: 'ESTABLISHED_PATTERN',
    evidence: 'CHRONOLOGICAL_HOLDOUT_VALIDATION',
    symbol, digit: best.digit,
    weekday: weekdayNames[parts.weekday],
    timeZone: 'Africa/Nairobi',
    timeLabel: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ' EAT',
    historicalOccurrences: best.discoveryCount,
    historicalTotalObservations: best.discoveryTotal,
    historicalRate: Number((best.discoveryRate * 100).toFixed(2)),
    historicalLowerBound: Number((best.discoveryLowerBound * 100).toFixed(2)),
    validationOccurrences: best.validationCount,
    validationTotalObservations: best.validationTotal,
    validationRate: Number((best.validationRate * 100).toFixed(2)),
    validationLowerBound: Number((best.validationLowerBound * 100).toFixed(2)),
    discoveryDates: best.discoveryDates,
    validationDates: best.validationDates,
    baselineRate: 10,
    liftVsBaseline: Number((best.discoveryRate / BASELINE).toFixed(2)),
    observedAt: Number(epoch)
  };
}

export async function rebuildDayTimePatternMemory({ symbols = SYMBOLS } = {}) {
  const results = [];
  for (const symbol of symbols.filter(s => SYMBOLS.includes(s))) {
    await DayTimePatternMemory.deleteMany({ symbol });
    const totalTicks = await Tick.countDocuments({ symbol, digit: { $gte: 0, $lte: 9 } });
    const discoveryCutoffIndex = Math.floor(totalTicks * DISCOVERY_FRACTION);
    const buckets = new Map();
    let processed = 0;
    const cursor = Tick.find({ symbol, digit: { $gte: 0, $lte: 9 } })
      .select({ digit: 1, epoch: 1 }).sort({ epoch: 1 }).lean().cursor();

    for await (const tick of cursor) {
      if (!Number.isFinite(Number(tick.epoch))) continue;
      const phase = processed < discoveryCutoffIndex ? 'discovery' : 'validation';
      aggregateTick(buckets, symbol, tick, phase);
      processed++;
    }

    // One aggregated record per symbol/weekday/minute/digit.
    // Totals are computed over the entire historical timeline so holdout denominators are correct.
    const rows = Array.from(buckets.values());
    const slotTotals = new Map();
    for (const row of rows) {
      const key = [row.weekday, row.timeSlot].join(':');
      const totals = slotTotals.get(key) || {
        discoveryTotal: 0, validationTotal: 0,
        discoveryDates: new Set(), validationDates: new Set()
      };
      totals.discoveryTotal += row.discoveryTotalObservations;
      totals.validationTotal += row.validationTotalObservations;
      row.discoveryDateKeys.forEach(d => totals.discoveryDates.add(d));
      row.validationDateKeys.forEach(d => totals.validationDates.add(d));
      slotTotals.set(key, totals);
    }
    const writes = rows.map(row => {
      const totals = slotTotals.get([row.weekday, row.timeSlot].join(':'));
      return {
        updateOne: {
          filter: { symbol, weekday: row.weekday, timeSlot: row.timeSlot, digit: row.digit },
          update: { $set: {
            ...row,
            discoveryTotalObservations: totals.discoveryTotal,
            validationTotalObservations: totals.validationTotal,
            discoverySlotDateCount: totals.discoveryDates.size,
            validationSlotDateCount: totals.validationDates.size,
            validationSamples: 0, validationWins: 0, validationLosses: 0
          } },
          upsert: true
        }
      };
    });
    for (let i = 0; i < writes.length; i += 1000) {
      await DayTimePatternMemory.bulkWrite(writes.slice(i, i + 1000), { ordered: false });
    }
    results.push({
      symbol, processedTicks: processed, discoveryTicks: discoveryCutoffIndex,
      validationTicks: Math.max(0, processed - discoveryCutoffIndex),
      patternBuckets: rows.length,
      discoverySplitPercent: 70,
      validationSplitPercent: 30
    });
  }
  return results;
}

export async function getDayTimePatternMemory({ symbol, limit = 50 } = {}) {
  const rows = await DayTimePatternMemory.find({ symbol })
    .sort({ occurrenceCount: -1 })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 200))
    .lean();

  return rows.map(row => {
    const discoveryTotal = Number(row.discoveryTotalObservations || 0);
    const discoveryCount = Number(row.occurrenceCount || 0);
    const validationTotal = Number(row.validationTotalObservations || 0);
    const validationCount = Number(row.validationOccurrenceCount || 0);
    const discoveryRate = discoveryTotal ? discoveryCount / discoveryTotal : 0;
    const validationRate = validationTotal ? validationCount / validationTotal : 0;
    const discoveryLowerBound = wilsonLowerBound(discoveryCount, discoveryTotal);
    const validationLowerBound = wilsonLowerBound(validationCount, validationTotal);
    const discoveryDates = (row.discoveryDateKeys || []).length;
    const validationDates = (row.validationDateKeys || []).length;

    let status = 'COLLECTING_EVIDENCE';
    if (
      discoveryDates >= MIN_DISCOVERY_DATES &&
      discoveryLowerBound > BASELINE
    ) {
      status = (
        validationDates >= MIN_VALIDATION_DATES &&
        validationLowerBound > BASELINE
      ) ? 'ESTABLISHED_PATTERN' : 'VALIDATING_PATTERN';
    }

    return {
      ...row,
      status,
      discoveryRate: Number((discoveryRate * 100).toFixed(2)),
      discoveryLowerBound: Number((discoveryLowerBound * 100).toFixed(2)),
      validationRate: Number((validationRate * 100).toFixed(2)),
      validationLowerBound: Number((validationLowerBound * 100).toFixed(2)),
      discoveryDates,
      validationDates,
      baselineRate: 10
    };
  });
}

// Legacy prediction outcome counters are retained for compatibility but are not used
// to establish day/time patterns; validation is based on unseen historical ticks.
export async function recordDayTimePredictionOutcome({ symbol, predictedDigit, won, predictionEpoch }) {
  if (!SYMBOLS.includes(symbol) || !Number.isInteger(predictedDigit) || predictedDigit < 0 || predictedDigit > 9) return null;
  const parts = getLocalParts(predictionEpoch);
  if (!parts) return null;
  return DayTimePatternMemory.updateOne(
    { symbol, weekday: parts.weekday, timeSlot: parts.timeSlot, digit: predictedDigit },
    { $inc: { validationSamples: 1, [won ? 'validationWins' : 'validationLosses']: 1 } }
  );
}
