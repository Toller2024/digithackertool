import express from 'express';

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
 * Shows the configured historical-memory target.
 */
router.get('/status', (req, res) => {
  res.json({
    success: true,
    symbols: SYMBOLS,
    targetPerSymbol:
      TARGET_TICKS_PER_SYMBOL,
    totalTarget:
      TARGET_TICKS_PER_SYMBOL *
      SYMBOLS.length
  });
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
