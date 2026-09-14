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
 * Convert a Deriv quote into its final displayed digit.
 *
 * Deriv historical tick responses provide the quote
 * and epoch. We determine the digit from the quote's
 * decimal representation instead of using:
 *
 * Math.floor(quote * 10) % 10
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

  return Math.abs(
    Number(quote)
  ) % 10;
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
      console.log(
        'Symbol:',
        symbol
      );
      console.log(
        'Requested:',
        count
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
        response.msg_type !==
        'history'
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
 *
 * insertMany with ordered:false allows duplicate
 * ticks to be skipped while other records continue.
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
     * Duplicate-key errors are expected when the
     * collector is run more than once.
     *
     * Other database errors should still be reported.
     */
    if (
      error?.writeErrors &&
      Array.isArray(error.writeErrors)
    ) {
      inserted =
        ticks.length -
        error.writeErrors.length;
    } else {
      throw error;
    }
  }

  return inserted;
}

/*
 * Count ticks already stored for a symbol.
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

  const existing =
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
  console.log(
    'Symbol:',
    symbol
  );
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

  /*
   * Request more than the missing amount because
   * some historical records may already exist.
   */
  const missing =
    target - existing;

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

  console.log(
    `📥 Received ${ticks.length} historical ticks for ${symbol}`
  );

  const added =
    await saveTicks(ticks);

  const total =
    await countSymbolTicks(symbol);

  console.log('');
  console.log(
    `💾 ${symbol} added: ${added}`
  );
  console.log(
    `📊 ${symbol} total: ${total}`
  );
  console.log('');

  return {
    symbol,
    existing,
    added,
    total,
    complete: total >= target
  };
}

/*
 * Collect historical data for every supported symbol.
 */
export async function collectAllHistoricalTicks(
  target = TARGET_TICKS_PER_SYMBOL
) {
  const results = [];

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
        `❌ HISTORICAL COLLECTION FAILED: ${symbol}`
      );
      console.error(
        error?.message ||
          String(error)
      );
      console.error('');

      results.push({
        symbol,
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
    '📚 HISTORICAL COLLECTION COMPLETE'
  );
  console.log(
    '=========================================='
  );

  for (const result of results) {
    console.log(
      result.symbol,
      '→',
      result.total ??
        'ERROR'
    );
  }

  console.log('');

  return results;
}

export {
  SYMBOLS,
  TARGET_TICKS_PER_SYMBOL,
  extractLastDigit
};
