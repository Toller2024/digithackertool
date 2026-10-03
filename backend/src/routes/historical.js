import express from 'express';

import Tick from '../models/Tick.js';

import {
  collectHistoricalTicks,
  collectAllHistoricalTicks,
  SYMBOLS,
  TARGET_TICKS_PER_SYMBOL
} from '../services/historicalTicks.js';

const router = express.Router();

/*
 * GET /historical/status
 *
 * Shows the ACTUAL MongoDB historical-memory
 * count for every supported volatility.
 *
 * This is read-only. It does not collect or
 * modify any ticks.
 */
router.get('/status', async (req, res) => {
  try {
    const symbolStats = await Promise.all(
      SYMBOLS.map(async (symbol) => {
        const [count, digitCounts, oldest, newest] =
          await Promise.all([
            Tick.countDocuments({ symbol }),

            Tick.aggregate([
              { $match: { symbol } },
              {
                $group: {
                  _id: '$digit',
                  count: { $sum: 1 }
                }
              },
              { $sort: { _id: 1 } }
            ]),

            Tick.findOne({ symbol })
              .sort({ epoch: 1 })
              .select({ epoch: 1, timestamp: 1 })
              .lean(),

            Tick.findOne({ symbol })
              .sort({ epoch: -1 })
              .select({ epoch: 1, timestamp: 1 })
              .lean()
          ]);

        const digits = Array.from(
          { length: 10 },
          (_, digit) => {
            const found = digitCounts.find(
              (item) => item._id === digit
            );

            return {
              digit,
              count: found?.count || 0,
              percentage:
                count > 0
                  ? Number(
                      (((found?.count || 0) / count) * 100)
                        .toFixed(2)
                    )
                  : 0
            };
          }
        );

        return {
          symbol,
          count,
          target: TARGET_TICKS_PER_SYMBOL,
          remaining: Math.max(
            TARGET_TICKS_PER_SYMBOL - count,
            0
          ),
          complete:
            count >= TARGET_TICKS_PER_SYMBOL,
          oldestEpoch: oldest?.epoch ?? null,
          newestEpoch: newest?.epoch ?? null,
          digitDistribution: digits
        };
      })
    );

    const totalCount = symbolStats.reduce(
      (sum, item) => sum + item.count,
      0
    );

    const totalTarget =
      TARGET_TICKS_PER_SYMBOL * SYMBOLS.length;

    return res.json({
      success: true,
      targetPerSymbol: TARGET_TICKS_PER_SYMBOL,
      totalTarget,
      totalCount,
      totalRemaining: Math.max(
        totalTarget - totalCount,
        0
      ),
      allSymbolsComplete: symbolStats.every(
        (item) => item.complete
      ),
      symbols: symbolStats
    });
  } catch (error) {
    console.error(
      '❌ HISTORICAL STATUS ERROR:',
      error?.message || String(error)
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        'Unable to read historical status'
    });
  }
});

/*
 * POST /historical/collect/:symbol
 *
 * Collect historical ticks for one symbol.
 *
 * Example:
 * /historical/collect/R_10
 */
router.post(
  '/collect/:symbol',
  async (req, res) => {
    try {
      const symbol =
        req.params.symbol.toUpperCase();

      if (!SYMBOLS.includes(symbol)) {
        return res.status(400).json({
          success: false,
          error:
            `Unsupported symbol: ${symbol}`,
          allowedSymbols: SYMBOLS
        });
      }

      console.log('');
      console.log(
        '=========================================='
      );
      console.log(
        '📚 MANUAL HISTORICAL COLLECTION'
      );
      console.log(
        '=========================================='
      );
      console.log(
        'Symbol:',
        symbol
      );
      console.log('');

      const result =
        await collectHistoricalTicks(
          symbol
        );

      return res.json({
        success: true,
        result
      });
    } catch (error) {
      console.error(
        '❌ HISTORICAL ROUTE ERROR:',
        error?.message ||
          String(error)
      );

      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          'Historical collection failed'
      });
    }
  }
);

/*
 * POST /historical/collect-all
 *
 * Collect historical memory for all five
 * supported symbols.
 *
 * This is intentionally POST because it
 * starts a database operation.
 */
router.post(
  '/collect-all',
  async (req, res) => {
    try {
      console.log('');
      console.log(
        '=========================================='
      );
      console.log(
        '🚀 MANUAL FULL HISTORICAL COLLECTION'
      );
      console.log(
        '=========================================='
      );
      console.log('');

      const results =
        await collectAllHistoricalTicks();

      return res.json({
        success: true,
        results
      });
    } catch (error) {
      console.error(
        '❌ FULL HISTORICAL COLLECTION ERROR:',
        error?.message ||
          String(error)
      );

      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          'Full historical collection failed'
      });
    }
  }
);

export default router;
