import WebSocket from 'ws';

const DERIV_WS_URL =
  'wss://api.derivws.com/trading/v1/options/ws/public';

const pipSizeCache = new Map();

const SYMBOLS = [
  'R_10',
  'R_25',
  'R_50',
  'R_75',
  'R_100'
];

function requestPipSizeFromHistory(symbol) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DERIV_WS_URL);
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;

      try {
        ws.close();
      } catch (_) {}

      callback(value);
    };

    const timeout = setTimeout(() => {
      finish(
        reject,
        new Error(`Unable to determine pip size for ${symbol}`)
      );
    }, 15000);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          ticks_history: symbol,
          count: 1,
          end: 'latest',
          style: 'ticks',
          req_id: 1
        })
      );
    });

    ws.on('message', (rawData) => {
      let response;

      try {
        response = JSON.parse(rawData.toString());
      } catch (_) {
        clearTimeout(timeout);
        finish(reject, new Error('Invalid JSON while reading pip size'));
        return;
      }

      if (response.error) {
        clearTimeout(timeout);
        finish(
          reject,
          new Error(
            response.error.message ||
              `Deriv pip-size request failed for ${symbol}`
          )
        );
        return;
      }

      if (response.msg_type !== 'history') {
        return;
      }

      clearTimeout(timeout);

      const pipSize = Number(response.pip_size);

      if (!Number.isInteger(pipSize) || pipSize < 0 || pipSize > 10) {
        finish(
          reject,
          new Error(
            `Deriv did not return a valid pip_size for ${symbol}`
          )
        );
        return;
      }

      finish(resolve, pipSize);
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
          new Error(`Pip-size WebSocket closed for ${symbol}`)
        );
      }
    });
  });
}

export async function getPipSize(symbol) {
  if (pipSizeCache.has(symbol)) {
    return pipSizeCache.get(symbol);
  }

  const pipSize = await requestPipSizeFromHistory(symbol);

  pipSizeCache.set(symbol, pipSize);

  console.log(
    `📐 DERIV PIP SIZE ${symbol}: ${pipSize}`
  );

  return pipSize;
}

/*
 * Convert a quote into the final digit at the symbol's
 * actual decimal precision.
 *
 * Example:
 * quote = 597.6
 * pipSize = 2
 *
 * 597.6 * 100 = 59760
 * final digit = 0
 *
 * This preserves trailing zeroes that JavaScript Number
 * values normally hide.
 */
export function extractLastDigitFromQuote(quote, pipSize) {
  const number = Number(quote);
  const precision = Number(pipSize);

  if (
    !Number.isFinite(number) ||
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > 10
  ) {
    return null;
  }

  const scale = 10 ** precision;
  const scaled = Math.round(Math.abs(number) * scale);

  if (!Number.isSafeInteger(scaled)) {
    return null;
  }

  return scaled % 10;
}

export async function getSymbolPipSizes(symbols = SYMBOLS) {
  const result = {};

  for (const symbol of symbols) {
    result[symbol] = await getPipSize(symbol);
  }

  return result;
}

export { SYMBOLS };
