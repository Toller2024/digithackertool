import WebSocket from 'ws';
import Tick from '../models/Tick.js';

const DERIV_WS_URL =
  'wss://api.derivws.com/trading/v1/options/ws/public';

const TARGET_TICKS_PER_SYMBOL = 10000;

const SYMBOLS = [
  'R_10',
  'R_25',
  'R_50',
  'R_75',
  'R_100'
];

/*
 * Extract the final displayed digit from a quote.
 */
function extractLastDigit(quote) {
  const text = String(quote);

  if (text.includes('.')) {
    const decimalPart = text.split('.')[1];

    if (decimalPart && decimalPart.length > 0) {
      return Number(
        decimalPart[decimalPart.length - 1]
      );
    }
  }

  return Math.abs(Number(quote)) % 10;
}

/*
 * Request historical ticks from Deriv.
 */
function requestHistory(symbol, count) {
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
        end: 'latest',
        style: 'ticks',
        subscribe: 0,
        req_id: 1
      };

      console.log('');
      console.log(
        '=========================================='
      );
      console.log(
        '📚 DERIV HISTORICAL REQUEST'
      );
      console.log(
        '=========================================='
      );
      console.log('Symbol:', symbol);
      console.log('Requested:', count);
      console.log(
        'Request:',
        JSON.stringify(request)
      );
      console.log('');

      ws.send(
        JSON.stringify(request)
      );
    });

    ws.on('message', (rawData) => {
      let response;

      try {
        response = JSON.parse(
          rawData.toString()
        );
      } catch (error) {
        clearTimeout(timeout);

        finish(
          reject,
          new Error(
            'Invalid JSON received from Deriv'
          )
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

      if (
        response.msg_type !== 'history'
      ) {
        return;
      }

      clearTimeout(timeout);

      const prices =
        response.history?.prices || [];

      const times =
        response.history?.times || [];

      const ticks = [];

      for (
        let i = 0;
        i < prices.length;
        i++
      ) {
        const quote =
          Number(prices[i]);

        const epoch =
          Number(times[i]);

        if (
          !Number.isFinite(quote) ||
          !Number.isFinite(epoch)
        ) {
          continue;
        }

        const digit =
          extractLastDigit(quote);

        if (
          !Number.isInteger(digit) ||
          digit < 0 ||
          digit > 9
        ) {
          continue;
        }

        ticks.push({
          symbol,
          quote,
          digit,
          epoch,
          timestamp:
            new Date(epoch * 1000)
        });
      }

      console.log(
        `📥 Received ${ticks.length} historical ticks for ${symbol}`
      );

      finish(
        resolve,
        ticks
      );
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);

      finish(
        reject,
        error
      );
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
 * Save historical ticks into MongoDB.
 */
async function saveTicks(ticks) {
  if (!ticks.length) {
    return 0;
  }

  let inserted = 0;

  try {
    const result =
      await Tick.insertMany(
        ticks,
        {
          ordered: false
        }
      );

    inserted = result.length;
  } catch (error) {
    /*
     * Duplicate ticks can happen because
     * symbol + epoch is unique.
     */
    if (
      error?.writeErrors &&
      Array.isArray(error.writeErrors)
    ) {
      inserted =
        ticks.length -
        error.writeErrors.length;
    } else if (
      error?.code === 11000
    ) {
      /*
       * MongoDB duplicate-key error.
       *
       * The existing records are still valid.
       */
      console.log(
        'ℹ️ Duplicate historical ticks detected. Skipping duplicates.'
      );
    } else {
      throw error;
    }
  }

  return inserted;
}

/*
 * Count stored ticks for a symbol.
 */
async function countSymbolTicks(symbol) {
  return Tick.countDocuments({
    symbol
  });
}

/*
 * Collect historical ticks for one symbol.
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

  let existing =
    await countSymbolTicks(symbol);

  console.log('');
  console.log(
    '=========================================='
  );
  console.log(
    '📊 HISTORICAL MEMORY STATUS'
  );
  console.log(
    '=========================================='
  );
  console.log('Symbol:', symbol);
  console.log(
    'Existing ticks:',
    existing
  );
  console.log(
    'Target ticks:',
    target
  );
  console.log('');

  if (existing >= target) {
    console.log(
      `✅ ${symbol} already has ${existing} ticks`
    );

    return {
      symbol,
      existing,
      added: 0,
      total: existing,
      complete: true
    };
  }

  const missing =
    target - existing;

  /*
   * Request slightly more than the missing
   * amount to account for duplicates.
   *
   * Deriv supports up to 10,000 ticks per
   * historical request.
   */
  const requestCount =
    Math.min(
      missing + 100,
      10000
    );

  const ticks =
    await requestHistory(
      symbol,
      requestCount
    );

  const added =
    await saveTicks(ticks);

  existing =
    await countSymbolTicks(symbol);

  console.log('');
  console.log(
    '=========================================='
  );
  console.log(
    '💾 HISTORICAL DATA SAVED'
  );
  console.log(
    '=========================================='
  );
  console.log('Symbol:', symbol);
  console.log(
    'Added:',
    added
  );
  console.log(
    'Total:',
    existing
  );
  console.log(
    'Target:',
    target
  );
  console.log('');

  return {
    symbol,
    existing: existing - added,
    added,
    total: existing,
    complete: existing >= target
  };
}

/*
 * Collect historical data for all five symbols.
 */
export async function collectAllHistoricalTicks(
  target = TARGET_TICKS_PER_SYMBOL
) {
  const results = [];

  console.log('');
  console.log(
    '=========================================='
  );
  console.log(
    '🚀 STARTING HISTORICAL MEMORY COLLECTION'
  );
  console.log(
    '=========================================='
  );
  console.log(
    `Target: ${target} ticks per symbol`
  );
  console.log(
    `Total target: ${target * SYMBOLS.length} ticks`
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
        error?.message ||
          String(error)
      );
      console.error('');

      results.push({
        symbol,
        total: 0,
        added: 0,
        complete: false,
        error:
          error?.message ||
          String(error)
      });
    }
  }

  console.log('');
  console.log(
    '=========================================='
  );
  console.log(
    '📚 HISTORICAL COLLECTION SUMMARY'
  );
  console.log(
    '=========================================='
  );

  for (const result of results) {
    if (result.error) {
      console.log(
        `${result.symbol} → ERROR`
      );
    } else {
      console.log(
        `${result.symbol} → ${result.total} ticks`
      );
    }
  }

  const completed =
    results.filter(
      result => result.complete
    ).length;

  console.log('');
  console.log(
    `✅ Completed: ${completed}/${SYMBOLS.length}`
  );
  console.log('');

  return results;
}

export {
  SYMBOLS,
  TARGET_TICKS_PER_SYMBOL,
  extractLastDigit
};
