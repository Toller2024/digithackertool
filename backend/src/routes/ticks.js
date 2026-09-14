import express from 'express';
import DerivAPI from '../services/derivAPI.js';
import Tick from '../models/Tick.js';
import {
  processTickForLearning
} from '../services/LearningService.js';

const router = express.Router();

const activeConnections = new Map();

/*
 * AVAILABLE SYMBOLS
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
 * EXTRACT THE FINAL DIGIT
 *
 * Deriv provides pip_size.
 *
 * Example:
 *
 * 4873.313 with pip_size 3
 * => final digit = 3
 *
 * 48372.0306 with pip_size 4
 * => final digit = 6
 */
function extractLastDigit(tick) {
  if (!tick) {
    return null;
  }

  const quote = Number(tick.quote);

  if (!Number.isFinite(quote)) {
    return null;
  }

  const pipSize = Number(tick.pip_size);

  /*
   * Use Deriv's pip_size whenever available.
   */
  if (
    Number.isInteger(pipSize) &&
    pipSize >= 0 &&
    pipSize <= 10
  ) {
    const fixedQuote =
      Math.abs(quote).toFixed(pipSize);

    if (pipSize > 0) {
      const decimalPart =
        fixedQuote.split('.')[1];

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

    return (
      Math.abs(
        Math.trunc(quote)
      ) % 10
    );
  }

  /*
   * Fallback if pip_size is unavailable.
   */
  const text =
    String(Math.abs(quote));

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

  return (
    Math.abs(
      Math.trunc(quote)
    ) % 10
  );
}

/*
 * SAVE TICK
 *
 * MongoDB failure must not stop the live
 * Deriv stream.
 */
async function saveTick(tick) {
  try {
    if (!tick) {
      return;
    }

    const symbol = tick.symbol;

    const quote =
      Number(tick.quote);

    const epoch =
      Number(tick.epoch);

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
    console.error(
      '⚠️ MONGODB TICK SAVE FAILED:',
      error?.message ||
        String(error)
    );
  }
}

/*
 * SSE STREAM
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
     * Flush headers immediately.
     */
    if (
      typeof res.flushHeaders ===
      'function'
    ) {
      res.flushHeaders();
    }

    /*
     * Initial SSE event.
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
        activeConnections.get(res);

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
             * Calculate actual final digit.
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
             * ======================================
             * SAVE HISTORICAL MEMORY
             * ======================================
             */
            await saveTick(tick);

            /*
             * ======================================
             * PROCESS LEARNING
             * ======================================
             *
             * This does:
             *
             * previous prediction
             *       ↓
             * WIN / LOSS
             *       ↓
             * new prediction for NEXT tick
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
               * Learning failure must never
               * kill the live stream.
               */
              console.error(
                `⚠️ LEARNING PROCESS ERROR ${symbol}:`,
                error?.message ||
                  String(error)
              );
            }

            /*
             * ======================================
             * SEND TICK TO FRONTEND
             * ======================================
             *
             * We continue sending the original
             * Deriv tick object so the existing
             * Dashboard remains compatible.
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
