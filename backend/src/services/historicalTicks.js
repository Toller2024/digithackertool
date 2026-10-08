import WebSocket from 'ws';
import Tick from '../models/Tick.js';
import { getPipSize, extractLastDigitFromQuote } from './digitUtils.js';

const DERIV_WS_URL =
  'wss://api.derivws.com/trading/v1/options/ws/public';

/*
 * Long-term historical memory target.
 *
 * Render environment variable can override this:
 * HISTORICAL_TARGET_PER_SYMBOL=1000000
 */
const TARGET_TICKS_PER_SYMBOL = Math.max(
  10000,
  Number.parseInt(
    process.env.HISTORICAL_TARGET_PER_SYMBOL || '1000000',
    10
  ) || 1000000
);

const REQUEST_BATCH_SIZE = Math.min(
  Math.max(
    Number.parseInt(
      process.env.HISTORICAL_REQUEST_BATCH_SIZE || '10000',
      10
    ) || 10000,
    100
  ),
  10000
);

const REQUEST_DELAY_MS = Math.max(
  0,
  Number.parseInt(
    process.env.HISTORICAL_REQUEST_DELAY_MS || '1000',
    10
  ) || 1000
);

const SYMBOLS = [
  'R_10',
  'R_25',
  'R_50',
  'R_75',
  'R_100'
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
 * Request one historical page from Deriv.
 *
 * The important part for million-tick collection is "end".
 * After the first page, we request data older than the oldest
 * tick already stored. This prevents repeatedly downloading
 * the same latest 10,000 ticks.
 */
function requestHistory(symbol, count, endEpoch = 'latest') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DERIV_WS_URL);

    let settled = false;

    const finish = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;

      try {
        ws.close();
      } catch (_) {}

      callback(value);
    };

    const timeout = setTimeout(() => {
      finish(
        reject,
        new Error(
          `Historical request timeout for ${symbol}`
        )
      );
    }, 30000);

    ws.on('open', () => {
      const request = {
        ticks_history: symbol,
        count,
        end: endEpoch,
        style: 'ticks',
        req_id: 1
      };

      console.log(
        `📚 HISTORY REQUEST ${symbol}: count=${count}, end=${endEpoch}`
      );

      ws.send(JSON.stringify(request));
    });

    ws.on('message', (rawData) => {
      let response;

      try {
        response = JSON.parse(rawData.toString());
      } catch (_) {
        clearTimeout(timeout);
        finish(
          reject,
          new Error('Invalid JSON received from Deriv')
        );
        return;
      }

      if (response.error) {
        clearTimeout(timeout);
        finish(
          reject,
          new Error(
            response.error.message ||
              `Deriv historical request failed for ${symbol}`
          )
        );
        return;
      }

      if (response.msg_type !== 'history') {
        return;
      }

      clearTimeout(timeout);

      const prices = response.history?.prices || [];
      const times = response.history?.times || [];
      const pipSize = Number(response.pip_size);

      finish(resolve, {
        prices,
        times,
        pipSize:
          Number.isInteger(pipSize) && pipSize >= 0
            ? pipSize
            : null
      });
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      finish(reject, error);
    });

    ws.on('close', () => {
      clearTimeout(timeout);

      if (!settled) {
        finish(
          reject,
          new Error(
            `Historical WebSocket closed unexpectedly for ${symbol}`
          )
        );
      }
    });
  });
}

/*
 * Save a page without loading millions of documents into memory.
 * MongoDB's unique {symbol, epoch} index safely ignores duplicate
 * pages when the historical boundary overlaps.
 */
async function saveTicks(ticks) {
  if (!ticks.length) {
    return 0;
  }

  try {
    const result = await Tick.insertMany(
      ticks,
      {
        ordered: false
      }
    );

    return result.length;
  } catch (error) {
    if (
      error?.writeErrors &&
      Array.isArray(error.writeErrors)
    ) {
      return Math.max(
        ticks.length - error.writeErrors.length,
        0
      );
    }

    /*
     * Some Mongoose/MongoDB versions expose duplicate errors
     * differently. A duplicate-only page is not fatal.
     */
    if (
      error?.code === 11000 ||
      error?.writeErrors?.some(
        (item) => item?.code === 11000
      )
    ) {
      console.log(
        'ℹ️ Duplicate historical ticks detected. Continuing.'
      );

      return 0;
    }

    throw error;
  }
}

async function countSymbolTicks(symbol) {
  return Tick.countDocuments({ symbol });
}

async function getOldestEpoch(symbol) {
  const oldest = await Tick.findOne({ symbol })
    .sort({ epoch: 1 })
    .select({ epoch: 1 })
    .lean();

  return Number.isFinite(Number(oldest?.epoch))
    ? Number(oldest.epoch)
    : null;
}

function buildTicks(symbol, history, pipSize) {
  const ticks = [];
  const seenEpochs = new Set();

  const length = Math.min(
    history.prices.length,
    history.times.length
  );

  for (let i = 0; i < length; i += 1) {
    const quote = Number(history.prices[i]);
    const epoch = Number(history.times[i]);

    if (
      !Number.isFinite(quote) ||
      !Number.isFinite(epoch) ||
      seenEpochs.has(epoch)
    ) {
      continue;
    }

    const digit = extractLastDigitFromQuote(
      quote,
      pipSize
    );

    if (
      !Number.isInteger(digit) ||
      digit < 0 ||
      digit > 9
    ) {
      continue;
    }

    seenEpochs.add(epoch);

    ticks.push({
      symbol,
      quote,
      digit,
      epoch,
      timestamp: new Date(epoch * 1000)
    });
  }

  return ticks;
}

/*
 * Collect historical ticks for one symbol until the requested
 * target is reached or Deriv has no older page available.
 *
 * This function is deliberately incremental:
 * - one 10k-page at a time
 * - one MongoDB write at a time
 * - no million-tick array in RAM
 */
export async function collectHistoricalTicks(
  symbol,
  target = TARGET_TICKS_PER_SYMBOL
) {
  if (!SYMBOLS.includes(symbol)) {
    throw new Error(
      `Unsupported symbol: ${symbol}`
    );
  }

  const requestedTarget = Math.max(
    1,
    Number.parseInt(target, 10) || TARGET_TICKS_PER_SYMBOL
  );

  let existing = await countSymbolTicks(symbol);

  console.log('');
  console.log('==========================================');
  console.log('📊 LONG-TERM HISTORICAL MEMORY');
  console.log('==========================================');
  console.log('Symbol:', symbol);
  console.log('Existing ticks:', existing);
  console.log('Target ticks:', requestedTarget);
  console.log('Page size:', REQUEST_BATCH_SIZE);
  console.log('');

  if (existing >= requestedTarget) {
    return {
      symbol,
      existing,
      added: 0,
      total: existing,
      target: requestedTarget,
      complete: true,
      exhausted: false
    };
  }

  let addedTotal = 0;
  let pages = 0;
  let endEpoch = await getOldestEpoch(symbol);

  /*
   * If we already have history, go backwards from the oldest
   * stored tick. If there is no history, start at latest.
   */
  if (endEpoch !== null) {
    endEpoch = Math.floor(endEpoch) - 1;
  } else {
    endEpoch = 'latest';
  }

  const pipSize = await getPipSize(symbol);

  let exhausted = false;
  let previousOldestReturned = null;

  while (existing < requestedTarget) {
    const missing = requestedTarget - existing;

    /*
     * Never ask Deriv for more than its supported historical
     * request size.
     */
    const requestCount = Math.min(
      missing,
      REQUEST_BATCH_SIZE
    );

    const history = await requestHistory(
      symbol,
      requestCount,
      endEpoch
    );

    pages += 1;

    const pageTicks = buildTicks(
      symbol,
      history,
      history.pipSize ?? pipSize
    );

    if (!pageTicks.length) {
      console.log(
        `⚠️ ${symbol}: Deriv returned no usable historical ticks. Stopping this backfill.`
      );
      exhausted = true;
      break;
    }

    /*
     * Sort oldest -> newest so the next request can safely
     * continue from the oldest returned epoch.
     */
    pageTicks.sort((a, b) => a.epoch - b.epoch);

    const oldestReturned = pageTicks[0].epoch;
    const newestReturned =
      pageTicks[pageTicks.length - 1].epoch;

    if (
      previousOldestReturned !== null &&
      oldestReturned >= previousOldestReturned
    ) {
      console.log(
        `⚠️ ${symbol}: historical cursor did not move backwards. Stopping to prevent an infinite duplicate loop.`
      );
      exhausted = true;
      break;
    }

    previousOldestReturned = oldestReturned;

    const before = existing;
    const inserted = await saveTicks(pageTicks);

    addedTotal += inserted;
    existing = await countSymbolTicks(symbol);

    console.log(
      `📥 ${symbol}: page=${pages}, received=${pageTicks.length}, inserted=${inserted}, total=${existing}/${requestedTarget}, range=${oldestReturned}→${newestReturned}`
    );

    if (existing >= requestedTarget) {
      break;
    }

    /*
     * Move strictly backwards. Using oldest-1 prevents the
     * previous oldest tick from appearing again.
     */
    endEpoch = Math.floor(oldestReturned) - 1;

    if (
      !Number.isFinite(endEpoch) ||
      endEpoch <= 0
    ) {
      exhausted = true;
      break;
    }

    /*
     * If MongoDB did not gain anything and Deriv returned a
     * page that is older than before, we still continue.
     * This handles overlapping historical records caused by
     * gaps/duplicates without keeping a huge in-memory set.
     */
    if (existing === before) {
      console.log(
        `ℹ️ ${symbol}: no new MongoDB documents on this page; continuing further backwards.`
      );
    }

    if (REQUEST_DELAY_MS > 0) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const complete = existing >= requestedTarget;

  console.log('');
  console.log('==========================================');
  console.log('💾 HISTORICAL BACKFILL RESULT');
  console.log('==========================================');
  console.log('Symbol:', symbol);
  console.log('Pages:', pages);
  console.log('Added:', addedTotal);
  console.log('Total:', existing);
  console.log('Target:', requestedTarget);
  console.log('Complete:', complete);
  console.log('Exhausted:', exhausted);
  console.log('');

  return {
    symbol,
    existing: existing - addedTotal,
    added: addedTotal,
    total: existing,
    target: requestedTarget,
    pages,
    complete,
    exhausted
  };
}

/*
 * Collect all five volatility histories sequentially.
 *
 * Sequential collection is intentional: it protects the Render
 * instance and MongoDB from five simultaneous 10k-page streams.
 */
export async function collectAllHistoricalTicks(
  target = TARGET_TICKS_PER_SYMBOL
) {
  const results = [];

  console.log('');
  console.log('==========================================');
  console.log('🚀 STARTING MILLION-TICK HISTORICAL MEMORY');
  console.log('==========================================');
  console.log(
    `Target: ${target.toLocaleString()} ticks per symbol`
  );
  console.log(
    `Total target: ${(
      target * SYMBOLS.length
    ).toLocaleString()} ticks`
  );
  console.log('');

  for (const symbol of SYMBOLS) {
    try {
      const result =
        await collectHistoricalTicks(
          symbol,
          target
        );

      results.push(result);
    } catch (error) {
      console.error('');
      console.error(
        '=========================================='
      );
      console.error(
        `❌ HISTORICAL COLLECTION FAILED: ${symbol}`
      );
      console.error(
        '=========================================='
      );
      console.error(
        error?.message || String(error)
      );
      console.error('');

      results.push({
        symbol,
        total: 0,
        added: 0,
        complete: false,
        exhausted: false,
        error:
          error?.message ||
          String(error)
      });
    }
  }

  return results;
}

export {
  SYMBOLS,
  TARGET_TICKS_PER_SYMBOL,
  REQUEST_BATCH_SIZE,
  REQUEST_DELAY_MS,
  extractLastDigitFromQuote
};
