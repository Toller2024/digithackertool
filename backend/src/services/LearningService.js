import Prediction from '../models/Prediction.js';
import { predictNextDigit } from './predictionEngine.js';

/*
 * Prevent two simultaneous tick events for the
 * same symbol from creating duplicate predictions.
 */
const symbolQueues = new Map();

function queueForSymbol(symbol, task) {
  const previous =
    symbolQueues.get(symbol) || Promise.resolve();

  const next = previous
    .catch(() => {})
    .then(task);

  symbolQueues.set(
    symbol,
    next.finally(() => {
      if (symbolQueues.get(symbol) === next) {
        symbolQueues.delete(symbol);
      }
    })
  );

  return next;
}

/*
 * Process one completed Deriv tick.
 *
 * IMPORTANT ORDER:
 *
 * 1. Resolve the prediction made BEFORE this tick.
 * 2. Create a new prediction for the NEXT tick.
 *
 * Therefore the current tick can never be used
 * as the answer to its own prediction.
 */
export function processTickForLearning({
  symbol,
  digit
}) {
  return queueForSymbol(
    symbol,
    async () => {
      if (!symbol) {
        return null;
      }

      if (
        !Number.isInteger(digit) ||
        digit < 0 ||
        digit > 9
      ) {
        console.warn(
          `⚠️ LEARNING SKIPPED: invalid digit for ${symbol}:`,
          digit
        );

        return null;
      }

      /*
       * ==================================================
       * STEP 1 — RESOLVE THE PREVIOUS PREDICTION
       * ==================================================
       */

      const pending =
        await Prediction.findOne({
          symbol,
          result: 'PENDING'
        }).sort({
          predictedAt: -1
        });

      let resolved = null;

      if (pending) {
        const won =
          pending.predictedDigit === digit;

        pending.actualDigit = digit;

        pending.result =
          won ? 'WIN' : 'LOSS';

        pending.resolvedAt =
          new Date();

        await pending.save();

        resolved = {
          predictionId:
            pending._id.toString(),

          predictedDigit:
            pending.predictedDigit,

          actualDigit: digit,

          result:
            won ? 'WIN' : 'LOSS',

          probability:
            pending.probability,

          probabilityPercent:
            Number(
              (
                pending.probability *
                100
              ).toFixed(2)
            )
        };

        console.log(
          `${won ? '✅' : '❌'} PREDICTION RESULT ${symbol}: predicted=${pending.predictedDigit} actual=${digit} result=${won ? 'WIN' : 'LOSS'}`
        );
      } else {
        console.log(
          `ℹ️ NO PENDING PREDICTION FOR ${symbol}`
        );
      }

      /*
       * ==================================================
       * STEP 2 — MAKE THE NEXT PREDICTION
       * ==================================================
       *
       * The current tick has already happened.
       *
       * The prediction created here is therefore
       * specifically for the NEXT unseen tick.
       */

      const prediction =
        await predictNextDigit(
          symbol
        );

      if (
        !prediction ||
        prediction.prediction === null ||
        prediction.prediction === undefined
      ) {
        console.log(
          `⏳ NOT READY TO PREDICT ${symbol}:`,
          prediction?.reason ||
            'insufficient history'
        );

        return {
          resolved,
          prediction: null
        };
      }

      /*
       * Validate the predicted digit before
       * writing it to MongoDB.
       */
      if (
        !Number.isInteger(
          prediction.prediction
        ) ||
        prediction.prediction < 0 ||
        prediction.prediction > 9
      ) {
        console.error(
          `❌ INVALID PREDICTION GENERATED FOR ${symbol}:`,
          prediction.prediction
        );

        return {
          resolved,
          prediction: null
        };
      }

      /*
       * Store the prediction.
       *
       * This prediction remains PENDING until
       * the NEXT Deriv tick arrives.
       */
      const savedPrediction =
        await Prediction.create({
          symbol,

          predictedDigit:
            prediction.prediction,

          actualDigit: null,

          probability:
            prediction.probability,

          signal:
            prediction.signal,

          result:
            'PENDING',

          strategy:
            prediction.strategy,

          historySize:
            prediction.historySize,

          predictedAt:
            new Date(),

          resolvedAt: null
        });

      console.log(
        `🔒 NEXT PREDICTION LOCKED ${symbol}: digit=${prediction.prediction} probability=${prediction.probabilityPercent}% signal=${prediction.signal} history=${prediction.historySize}`
      );

      return {
        resolved,

        prediction: {
          id:
            savedPrediction._id.toString(),

          symbol,

          predictedDigit:
            prediction.prediction,

          probability:
            prediction.probability,

          probabilityPercent:
            prediction.probabilityPercent,

          signal:
            prediction.signal,

          strategy:
            prediction.strategy,

          historySize:
            prediction.historySize,

          currentDigit:
            prediction.currentDigit,

          transitionSamples:
            prediction.transitionSamples,

          status:
            'PENDING'
        }
      };
    }
  );
}
