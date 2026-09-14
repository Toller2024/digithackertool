import express from 'express';
import DerivAPI from '../services/derivAPI.js';
import Tick from '../models/Tick.js';
import {
  processTickForLearning
} from '../services/LearningService.js';

const router = express.Router();

const activeConnections = new Map();

/*
 * ==========================================
 * AVAILABLE SYMBOLS
 * ==========================================
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
 * ==========================================
 * TEST ROUTE
 * ==========================================
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
 * ==========================================
 * EXTRACT FINAL DISPLAYED DIGIT
 * ==========================================
 *
 * IMPORTANT:
 *
 * We intentionally DO NOT use:
 *
 * Number(quote).toFixed(pip_size)
 *
 * because toFixed() can add trailing zeros.
 *
 * Example:
 *
 * 48403.326
 *
 * must remain:
 *
 * 48403.326
 *
 * and therefore the final digit is:
 *
 * 6
 *
 * NOT:
 *
 * 48403.3260 -> 0
 *
 * ==========================================
 */
function extractLastDigit(tick) {
  if (!tick) {
    return null;
  }

  const rawQuote = tick.quote;

  if (
    rawQuote === null ||
    rawQuote === undefined
  ) {
    return null;
  }

  /*
   * Convert the original quote value to text.
   */
  const text = String(rawQuote).trim();

  if (!text) {
    return null;
  }

  /*
   * Handle decimal quotes.
   *
   * Example:
   *
   * 48403.326
   *
   * decimalPart = "326"
   *
   * final digit = 6
   */
  if (text.includes('.')) {
    const decimalPart =
      text.split('.')[1];

    if (
      decimalPart &&
      decimalPart.length > 0
    ) {
      const lastCharacter =
        decimalPart[
          decimalPart.length - 1
        ];

      const digit =
        Number(lastCharacter);

      if (
        Number.isInteger(digit) &&
        digit >= 0 &&
        digit <= 9
      ) {
        return digit;
      }
    }
  }

  /*
   * Fallback for whole-number quotes.
   *
   * Example:
   *
   * 48403 -> 3
   */
  const number = Number(text);

  if (!Number.isFinite(number)) {
    return null;
  }

  return (
    Math.abs(
      Math.trunc(number)
    ) % 10
  );
}

/*
 * ==========================================
 * SAVE TICK TO MONGODB
 * ==========================================
 *
 * MongoDB failure must NOT stop the live
 * Deriv stream.
 * ==========================================
 */
async function saveTick(tick) {
  try {
    if (!tick) {
      return;
    }

    const symbol =
      tick.symbol;

    const quote =
      Number(tick.quote);

    const epoch =
      Number(tick.epoch);

    const digit =
      extractLastDigit(tick);

    /*
     * Validate tick before saving.
     */
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

    /*
     * Save only once for each
     * symbol + epoch combination.
     */
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
     * Database problems must not
     * kill the live stream.
     */
    console.error(
      '⚠️ MONGODB TICK SAVE FAILED:',
      error?.message ||
        String(error)
    );
  }
}

/*
 * ==========================================
 * SSE LIVE TICK STREAM
 * ==========================================
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
     * ========================================
     * SSE HEADERS
     * ========================================
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
     * ========================================
     * CORS
     * ========================================
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
     * Flush headers immediately.
     */
    if (
      typeof res.flushHeaders ===
      'function'
    ) {
      res.flushHeaders();
    }

    /*
     * ========================================
     * INITIAL SSE EVENT
     * ========================================
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
     * ========================================
     * CLEANUP
     * ========================================
     */
    const cleanup = () => {
      if (closed) {
        return;
      }

      closed = true;

      console.log(
        `🔴 CLEANING UP SSE CONNECTION: ${symbol}`
      );

      /*
       * Stop heartbeat.
       */
      if (heartbeat) {
        clearInterval(
          heartbeat
        );

        heartbeat = null;
      }

      /*
       * Get active connection.
       */
      const connection =
        activeConnections.get(res);

      if (connection) {
        /*
         * Unsubscribe from Deriv.
         */
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

        /*
         * Disconnect WebSocket.
         */
        try {
          connection.api.disconnect();
        } catch (error) {
          console.error(
            '❌ DERIV DISCONNECT ERROR:',
            error?.message ||
              String(error)
          );
        }

        /*
         * Remove from active connections.
         */
        activeConnections.delete(
          res
        );
      }
    };

    /*
     * ========================================
     * BROWSER DISCONNECTED
     * ========================================
     */
    req.on('close', () => {
      console.log(
        `🔴 SSE CLIENT DISCONNECTED: ${symbol}`
      );

      cleanup();
    });

    /*
     * ========================================
     * START DERIV CONNECTION
     * ========================================
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
       * ======================================
       * SUBSCRIBE TO DERIV TICKS
       * ======================================
       */
      reqId =
        api.subscribeTicks(
          symbol,
          async (response) => {
            /*
             * Ignore invalid messages.
             */
            if (
              !response ||
              !response.tick
            ) {
              return;
            }

            const tick =
              response.tick;

            /*
             * ==================================
             * LIVE QUOTE
             * ==================================
             */
            console.log(
              `📊 SSE TICK ${symbol}: ${tick.quote}`
            );

            /*
             * ==================================
             * EXTRACT FINAL DIGIT
             * ==================================
             */
            const digit =
              extractLastDigit(
                tick
              );

            console.log(
              `🔢 TICK DIGIT ${symbol}: ${digit}`
            );

            /*
             * Don't process anything after
             * the connection has closed.
             */
            if (closed) {
              return;
            }

            /*
             * ==================================
             * SAVE HISTORICAL MEMORY
             * ==================================
             */
            await saveTick(
              tick
            );

            /*
             * ==================================
             * PROCESS LEARNING SYSTEM
             * ==================================
             *
             * Flow:
             *
             * Previous prediction
             *          ↓
             * Compare with actual digit
             *          ↓
             *       WIN / LOSS
             *          ↓
             * Update learning memory
             *          ↓
             * Generate next prediction
             *
             * ==================================
             */
            try {
              if (
                Number.isInteger(digit) &&
                Number.isFinite(
                  Number(tick.epoch)
                )
              ) {
                const learning =
                  await processTickForLearning({
                    symbol,
                    digit,
                    epoch:
                      Number(tick.epoch)
                  });

                /*
                 * =================================
                 * LEARNING RESULT
                 * =================================
                 */
                if (
                  learning?.resolved
                ) {
                  console.log(
                    `🧠 LEARNING RESULT ${symbol}:`,
                    JSON.stringify(
                      learning.resolved
                    )
                  );
                }

                /*
                 * =================================
                 * NEW PREDICTION
                 * =================================
                 */
                if (
                  learning?.prediction
                ) {
                  console.log(
                    `🧠 NEW PREDICTION ${symbol}:`,
                    JSON.stringify(
                      learning.prediction
                    )
                  );
                }
              }
            } catch (error) {
              /*
               * Learning failure must NEVER
               * kill the live Deriv stream.
               */
              console.error(
                `⚠️ LEARNING PROCESS ERROR ${symbol}:`,
                error?.message ||
                  String(error)
              );
            }

            /*
             * ==================================
             * SEND ORIGINAL TICK TO FRONTEND
             * ==================================
             *
             * We keep the original tick object
             * so the current Dashboard remains
             * compatible.
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
       * ========================================
       * SAVE ACTIVE CONNECTION
       * ========================================
       */
      activeConnections.set(
        res,
        {
          api,
          reqId
        }
      );

      /*
       * ========================================
       * HEARTBEAT
       * ========================================
       *
       * Keeps SSE alive through proxies.
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
      /*
       * ========================================
       * STREAM START ERROR
       * ========================================
       */
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
