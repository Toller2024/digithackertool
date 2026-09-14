import express from 'express';
import DerivAPI from '../services/derivAPI.js';
import Tick from '../models/Tick.js';

const router = express.Router();

const activeConnections = new Map();

/*
 * SYMBOLS
 */
router.get('/symbols', (req, res) => {
  res.json([
    { symbol: 'R_10', name: 'Volatility 10 Index' },
    { symbol: 'R_25', name: 'Volatility 25 Index' },
    { symbol: 'R_50', name: 'Volatility 50 Index' },
    { symbol: 'R_75', name: 'Volatility 75 Index' },
    { symbol: 'R_100', name: 'Volatility 100 Index' },

    { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index' },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index' }
  ]);
});

/*
 * TEST ROUTE
 */
router.get('/test', (req, res) => {
  console.log('🟢 TICKS TEST ROUTE HIT');

  res.json({
    status: 'ok',
    message: 'Tick routes are working',
    timestamp: new Date().toISOString()
  });
});

/*
 * Convert a Deriv quote into the final digit
 * using the quote precision where possible.
 *
 * Examples:
 *
 * 597.6   -> 6
 * 597.63  -> 3
 * 597.638 -> 8
 *
 * We deliberately do NOT use:
 *
 * Math.floor(quote * 10) % 10
 *
 * because that assumes one decimal place.
 */
function extractLastDigit(tick) {
  if (!tick) {
    return null;
  }

  const quote = Number(tick.quote);

  if (!Number.isFinite(quote)) {
    return null;
  }

  /*
   * Deriv can provide pip_size on the tick.
   *
   * Example:
   * pip_size = 1
   * pip_size = 2
   * pip_size = 3
   */
  const pipSize = Number(tick.pip_size);

  /*
   * If pip_size is available, convert the quote
   * into a fixed decimal representation.
   */
  if (
    Number.isInteger(pipSize) &&
    pipSize >= 0 &&
    pipSize <= 10
  ) {
    const fixed = Math.abs(quote).toFixed(pipSize);

    /*
     * If the quote has decimals, take the final
     * decimal digit.
     */
    if (pipSize > 0) {
      const decimalPart = fixed.split('.')[1];

      if (
        decimalPart &&
        decimalPart.length > 0
      ) {
        return Number(
          decimalPart[decimalPart.length - 1]
        );
      }
    }

    /*
     * No decimal places.
     */
    return Math.abs(
      Math.trunc(quote)
    ) % 10;
  }

  /*
   * Fallback when pip_size is not present.
   *
   * Convert the number to a normal decimal
   * string and take its final decimal digit.
   */
  const text = String(
    Math.abs(quote)
  );

  if (text.includes('.')) {
    const decimalPart =
      text.split('.')[1];

    if (
      decimalPart &&
      decimalPart.length > 0
    ) {
      return Number(
        decimalPart[
          decimalPart.length - 1
        ]
      );
    }
  }

  return Math.abs(
    Math.trunc(quote)
  ) % 10;
}

/*
 * Save a tick to MongoDB.
 *
 * IMPORTANT:
 * Database failure must NOT stop the live
 * Deriv/SSE stream.
 */
async function saveTick(tick) {
  try {
    if (!tick) {
      return;
    }

    const symbol = tick.symbol;

    const quote = Number(
      tick.quote
    );

    const epoch = Number(
      tick.epoch
    );

    const digit =
      extractLastDigit(tick);

    if (
      !symbol ||
      !Number.isFinite(quote) ||
      !Number.isFinite(epoch) ||
      !Number.isInteger(digit) ||
      digit < 0 ||
      digit > 9
    ) {
      console.warn(
        '⚠️ INVALID TICK - NOT SAVED:',
        JSON.stringify(tick)
      );

      return;
    }

    await Tick.updateOne(
      {
        symbol,
        epoch
      },
      {
        $setOnInsert: {
          symbol,
          quote,
          digit,
          epoch,
          timestamp: new Date(
            epoch * 1000
          )
        }
      },
      {
        upsert: true
      }
    );

    console.log(
      `💾 TICK SAVED ${symbol}: quote=${quote} digit=${digit} epoch=${epoch}`
    );
  } catch (error) {
    /*
     * Do not kill the live stream because
     * MongoDB had a temporary problem.
     */
    console.error(
      `⚠️ MONGODB TICK SAVE FAILED:`,
      error?.message ||
        String(error)
    );
  }
}

/*
 * SERVER-SENT EVENTS TICK STREAM
 */
router.get(
  '/stream/:symbol',
  async (req, res) => {
    const { symbol } =
      req.params;

    console.log('');
    console.log(
      '=========================================='
    );
    console.log(
      '🌐 SSE CLIENT CONNECTED'
    );
    console.log(
      '=========================================='
    );
    console.log(
      'Symbol:',
      symbol
    );
    console.log(
      'Origin:',
      req.headers.origin || 'none'
    );
    console.log('');

    /*
     * SSE HEADERS
     */
    res.status(200);

    res.setHeader(
      'Content-Type',
      'text/event-stream; charset=utf-8'
    );

    res.setHeader(
      'Cache-Control',
      'no-cache, no-transform'
    );

    res.setHeader(
      'Connection',
      'keep-alive'
    );

    res.setHeader(
      'X-Accel-Buffering',
      'no'
    );

    /*
     * CORS
     */
    const origin =
      req.headers.origin;

    const allowed =
      origin ===
        'https://digitalhackertool.vercel.app' ||
      origin ===
        'https://www.digitalhackertool.vercel.app' ||
      (
        origin &&
        origin.startsWith('https://') &&
        origin.endsWith('.vercel.app')
      );

    if (allowed) {
      res.setHeader(
        'Access-Control-Allow-Origin',
        origin
      );

      res.setHeader(
        'Access-Control-Allow-Credentials',
        'true'
      );

      res.setHeader(
        'Vary',
        'Origin'
      );
    }

    /*
     * Flush SSE headers immediately.
     */
    if (
      typeof res.flushHeaders ===
      'function'
    ) {
      res.flushHeaders();
    }

    /*
     * Initial connection event.
     */
    res.write(
      `event: connected\ndata: ${JSON.stringify({
        symbol,
        status: 'connected'
      })}\n\n`
    );

    let api = null;
    let reqId = null;
    let heartbeat = null;
    let closed = false;

    /*
     * CLEANUP
     */
    const cleanup = () => {
      if (closed) {
        return;
      }

      closed = true;

      console.log(
        `🔴 CLEANING UP SSE CONNECTION: ${symbol}`
      );

      if (heartbeat) {
        clearInterval(
          heartbeat
        );

        heartbeat = null;
      }

      const connection =
        activeConnections.get(
          res
        );

      if (connection) {
        try {
          connection.api.unsubscribe(
            connection.reqId
          );
        } catch (error) {
          console.error(
            '❌ UNSUBSCRIBE ERROR:',
            error?.message ||
              String(error)
          );
        }

        try {
          connection.api.disconnect();
        } catch (error) {
          console.error(
            '❌ DERIV DISCONNECT ERROR:',
            error?.message ||
              String(error)
          );
        }

        activeConnections.delete(
          res
        );
      }
    };

    /*
     * BROWSER DISCONNECTED
     */
    req.on('close', () => {
      console.log(
        `🔴 SSE CLIENT DISCONNECTED: ${symbol}`
      );

      cleanup();
    });

    /*
     * START DERIV CONNECTION
     */
    try {
      console.log(
        `📡 STARTING DERIV CONNECTION FOR: ${symbol}`
      );

      api = new DerivAPI(
        process.env.DERIV_APP_ID
      );

      await api.connect();

      console.log(
        `✅ DERIV CONNECTED FOR SSE: ${symbol}`
      );

      /*
       * SUBSCRIBE TO TICKS
       */
      reqId =
        api.subscribeTicks(
          symbol,
          async (response) => {
            if (
              !response ||
              !response.tick
            ) {
              return;
            }

            const tick =
              response.tick;

            console.log(
              `📊 SSE TICK ${symbol}: ${tick.quote}`
            );

            /*
             * Calculate the digit now.
             *
             * This is the SAME actual digit
             * that will be stored in MongoDB.
             */
            const digit =
              extractLastDigit(
                tick
              );

            console.log(
              `🔢 TICK DIGIT ${symbol}: ${digit}`
            );

            if (closed) {
              return;
            }

            /*
             * Save historical memory.
             *
             * We deliberately do not await this
             * before sending SSE. Live data should
             * remain fast even if MongoDB is slow.
             */
            saveTick(tick);

            /*
             * Send the original Deriv tick to
             * the frontend.
             *
             * Existing Dashboard code therefore
             * continues receiving the same object.
             */
            try {
              res.write(
                `data: ${JSON.stringify(tick)}\n\n`
              );
            } catch (error) {
              console.error(
                '❌ SSE WRITE ERROR:',
                error?.message ||
                  String(error)
              );
            }
          }
        );

      console.log(
        `✅ DERIV TICK SUBSCRIPTION ACTIVE: ${symbol}`
      );

      /*
       * Save active connection.
       */
      activeConnections.set(
        res,
        {
          api,
          reqId
        }
      );

      /*
       * HEARTBEAT
       */
      heartbeat =
        setInterval(() => {
          if (closed) {
            return;
          }

          try {
            res.write(
              ': heartbeat\n\n'
            );
          } catch (error) {
            console.error(
              '❌ SSE HEARTBEAT ERROR:',
              error?.message ||
                String(error)
            );

            cleanup();
          }
        }, 10000);
    } catch (error) {
      console.error('');
      console.error(
        '=========================================='
      );
      console.error(
        '❌ TICK STREAM ERROR'
      );
      console.error(
        '=========================================='
      );
      console.error(
        'Symbol:',
        symbol
      );
      console.error(
        'Error:',
        error?.message ||
          String(error)
      );
      console.error('');

      cleanup();

      try {
        res.write(
          `event: error\ndata: ${JSON.stringify({
            error:
              'Failed to start tick stream',
            message:
              error?.message ||
              String(error)
          })}\n\n`
        );

        res.end();
      } catch (_) {}
    }
  }
);

export default router;
