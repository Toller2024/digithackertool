import express from 'express';

import Tick from '../models/Tick.js';
import { getPipSize, extractLastDigitFromQuote } from '../services/digitUtils.js';

import {
  collectHistoricalTicks,
  SYMBOLS,
  TARGET_TICKS_PER_SYMBOL
} from '../services/historicalTicks.js';

import {
  rebuildTimePatternMemory,
  getTimePatternMemory
} from '../services/TimePatternMemoryService.js';

const router = express.Router();

/*
 * Background long-term historical collection state.
 */
const historicalCollectionState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  targetPerSymbol: TARGET_TICKS_PER_SYMBOL,
  symbols: SYMBOLS,
  currentSymbol: null,
  results: []
};

/*
 * Background time-pattern rebuild state.
 */
const timePatternRebuildState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  results: [],
  symbols: [],
  currentSymbol: null
};

/*
 * GET /historical/status
 *
 * Shows actual MongoDB counts and the configured
 * long-term target.
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
                      (
                        ((found?.count || 0) / count) *
                        100
                      ).toFixed(2)
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
      allSymbolsComplete:
        symbolStats.every(
          (item) => item.complete
        ),
      collection: {
        ...historicalCollectionState
      },
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
 * POST /historical/collect-all
 *
 * Starts the long-term backfill in the background.
 *
 * Confirmation is required so a refresh cannot accidentally
 * launch another million-tick collection.
 */
const startHistoricalCollection = async (req, res) => {
  if (
    req.query.confirm !== 'COLLECT_1M' &&
    req.body?.confirm !== 'COLLECT_1M'
  ) {
    return res.status(400).json({
      success: false,
      error: 'Confirmation required',
      required:
        'confirm=COLLECT_1M or JSON body {"confirm":"COLLECT_1M"}'
    });
  }

  if (historicalCollectionState.running) {
    return res.status(409).json({
      success: false,
      status: 'RUNNING',
      message:
        'Million-tick historical collection is already running.',
      collection:
        historicalCollectionState
    });
  }

  historicalCollectionState.running = true;
  historicalCollectionState.startedAt =
    new Date().toISOString();
  historicalCollectionState.finishedAt = null;
  historicalCollectionState.error = null;
  historicalCollectionState.targetPerSymbol =
    TARGET_TICKS_PER_SYMBOL;
  historicalCollectionState.symbols = SYMBOLS;
  historicalCollectionState.currentSymbol = null;
  historicalCollectionState.results = [];

  setImmediate(async () => {
    try {
      for (const symbol of SYMBOLS) {
        historicalCollectionState.currentSymbol =
          symbol;

        const result =
          await collectHistoricalTicks(
            symbol,
            TARGET_TICKS_PER_SYMBOL
          );

        historicalCollectionState.results.push(
          result
        );
      }

      historicalCollectionState.currentSymbol =
        null;
      historicalCollectionState.running = false;
      historicalCollectionState.finishedAt =
        new Date().toISOString();

      console.log(
        '✅ LONG-TERM HISTORICAL COLLECTION COMPLETE'
      );
    } catch (error) {
      historicalCollectionState.currentSymbol =
        null;
      historicalCollectionState.running = false;
      historicalCollectionState.finishedAt =
        new Date().toISOString();
      historicalCollectionState.error =
        error?.message || String(error);

      console.error(
        '❌ LONG-TERM HISTORICAL COLLECTION ERROR:',
        error?.message || String(error)
      );
    }
  });

  return res.status(202).json({
    success: true,
    status: 'STARTED',
    message:
      'Long-term historical collection started in the background.',
    targetPerSymbol:
      TARGET_TICKS_PER_SYMBOL,
    totalTarget:
      TARGET_TICKS_PER_SYMBOL *
      SYMBOLS.length,
    symbols: SYMBOLS,
    monitor:
      '/historical/status'
  });
};

router.post(
  '/collect-all',
  startHistoricalCollection
);

/*
 * POST /historical/collect/:symbol
 *
 * Starts one-symbol long-term historical backfill.
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

      if (
        req.query.confirm !== 'COLLECT_1M' &&
        req.body?.confirm !== 'COLLECT_1M'
      ) {
        return res.status(400).json({
          success: false,
          error: 'Confirmation required',
          required: 'confirm=COLLECT_1M'
        });
      }

      if (historicalCollectionState.running) {
        return res.status(409).json({
          success: false,
          status: 'RUNNING',
          message:
            'A historical collection is already running.'
        });
      }

      historicalCollectionState.running = true;
      historicalCollectionState.startedAt =
        new Date().toISOString();
      historicalCollectionState.finishedAt = null;
      historicalCollectionState.error = null;
      historicalCollectionState.targetPerSymbol =
        TARGET_TICKS_PER_SYMBOL;
      historicalCollectionState.symbols = [symbol];
      historicalCollectionState.currentSymbol =
        symbol;
      historicalCollectionState.results = [];

      setImmediate(async () => {
        try {
          const result =
            await collectHistoricalTicks(
              symbol,
              TARGET_TICKS_PER_SYMBOL
            );

          historicalCollectionState.results = [
            result
          ];
          historicalCollectionState.currentSymbol =
            null;
          historicalCollectionState.running = false;
          historicalCollectionState.finishedAt =
            new Date().toISOString();
        } catch (error) {
          historicalCollectionState.currentSymbol =
            null;
          historicalCollectionState.running = false;
          historicalCollectionState.finishedAt =
            new Date().toISOString();
          historicalCollectionState.error =
            error?.message || String(error);
        }
      });

      return res.status(202).json({
        success: true,
        status: 'STARTED',
        symbol,
        targetPerSymbol:
          TARGET_TICKS_PER_SYMBOL,
        monitor:
          '/historical/status'
      });
    } catch (error) {
      console.error(
        '❌ HISTORICAL ROUTE ERROR:',
        error?.message || String(error)
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
 * POST /historical/repair-digits
 *
 * One-time repair for existing Tick documents.
 */
const repairDigits = async (req, res) => {
  if (req.query.confirm !== 'REPAIR_DIGITS') {
    return res.status(400).json({
      success: false,
      error: 'Confirmation required',
      required: 'confirm=REPAIR_DIGITS'
    });
  }

  try {
    const results = [];
    let totalUpdated = 0;

    for (const symbol of SYMBOLS) {
      const pipSize = await getPipSize(symbol);

      const cursor = Tick.find({ symbol })
        .select({ _id: 1, quote: 1 })
        .lean()
        .cursor();

      let operations = [];
      let updated = 0;

      for await (const tick of cursor) {
        const digit =
          extractLastDigitFromQuote(
            tick.quote,
            pipSize
          );

        if (
          !Number.isInteger(digit) ||
          digit < 0 ||
          digit > 9
        ) {
          continue;
        }

        operations.push({
          updateOne: {
            filter: { _id: tick._id },
            update: { $set: { digit } }
          }
        });

        if (operations.length >= 500) {
          const result =
            await Tick.bulkWrite(
              operations,
              { ordered: false }
            );

          updated +=
            result.modifiedCount || 0;

          operations = [];
        }
      }

      if (operations.length) {
        const result =
          await Tick.bulkWrite(
            operations,
            { ordered: false }
          );

        updated +=
          result.modifiedCount || 0;
      }

      totalUpdated += updated;

      results.push({
        symbol,
        pipSize,
        updated
      });

      console.log(
        `🛠️ DIGIT REPAIR ${symbol}: pip_size=${pipSize}, updated=${updated}`
      );
    }

    return res.json({
      success: true,
      message:
        'Existing Tick digit fields repaired. Quotes and epochs were not changed.',
      totalUpdated,
      results
    });
  } catch (error) {
    console.error(
      '❌ DIGIT REPAIR ERROR:',
      error?.message || String(error)
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        'Digit repair failed'
    });
  }
};

router.get(
  '/repair-digits',
  repairDigits
);

router.post(
  '/repair-digits',
  repairDigits
);

/*
 * POST /historical/time-pattern/rebuild
 *
 * Builds recurring time-of-day digit memory from existing ticks.
 */
const rebuildTimePatterns = async (req, res) => {
  if (
    req.query.confirm !== 'BUILD_TIME_PATTERNS' &&
    req.body?.confirm !== 'BUILD_TIME_PATTERNS'
  ) {
    return res.status(400).json({
      success: false,
      error: 'Confirmation required',
      required:
        'confirm=BUILD_TIME_PATTERNS'
    });
  }

  if (timePatternRebuildState.running) {
    return res.status(409).json({
      success: false,
      message:
        'Time-pattern rebuild is already running.',
      status: 'RUNNING',
      ...timePatternRebuildState
    });
  }

  const requested =
    Array.isArray(req.body?.symbols)
      ? req.body.symbols.map((item) =>
          String(item).toUpperCase()
        )
      : SYMBOLS;

  const symbols =
    requested.filter((symbol) =>
      SYMBOLS.includes(symbol)
    );

  if (!symbols.length) {
    return res.status(400).json({
      success: false,
      error:
        'No supported symbols supplied.',
      allowedSymbols: SYMBOLS
    });
  }

  timePatternRebuildState.running = true;
  timePatternRebuildState.startedAt =
    new Date().toISOString();
  timePatternRebuildState.finishedAt = null;
  timePatternRebuildState.error = null;
  timePatternRebuildState.results = [];
  timePatternRebuildState.symbols = symbols;
  timePatternRebuildState.currentSymbol = null;

  setImmediate(async () => {
    try {
      for (const symbol of symbols) {
        timePatternRebuildState.currentSymbol =
          symbol;

        const result =
          await rebuildTimePatternMemory({
            symbols: [symbol]
          });

        timePatternRebuildState.results.push(
          ...(Array.isArray(result)
            ? result
            : [result])
        );
      }

      timePatternRebuildState.currentSymbol = null;
      timePatternRebuildState.running = false;
      timePatternRebuildState.finishedAt =
        new Date().toISOString();
    } catch (error) {
      timePatternRebuildState.currentSymbol = null;
      timePatternRebuildState.running = false;
      timePatternRebuildState.finishedAt =
        new Date().toISOString();
      timePatternRebuildState.error =
        error?.message || String(error);
    }
  });

  return res.status(202).json({
    success: true,
    status: 'STARTED',
    message:
      'Time-pattern rebuild started in the background. Use /historical/time-pattern/rebuild-status to monitor progress.',
    startedAt:
      timePatternRebuildState.startedAt,
    symbols
  });
};

router.get(
  '/time-pattern/rebuild-status',
  (req, res) => {
    return res.json({
      success: true,
      ...timePatternRebuildState
    });
  }
);

router.get(
  '/time-pattern/rebuild',
  rebuildTimePatterns
);

router.post(
  '/time-pattern/rebuild',
  rebuildTimePatterns
);

router.get(
  '/time-pattern/:symbol',
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

      const memory =
        await getTimePatternMemory({
          symbol,
          limit:
            req.query.limit || 20
        });

      return res.json({
        success: true,
        symbol,
        count: memory.length,
        memory
      });
    } catch (error) {
      console.error(
        '❌ TIME-PATTERN STATUS ERROR:',
        error?.message || String(error)
      );

      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          'Unable to read time-pattern memory'
      });
    }
  }
);

export default router;
