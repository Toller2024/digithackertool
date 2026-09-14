import Prediction from '../models/Prediction.js';
import { predictNextDigit } from './predictionEngine.js';

/*
 * Process ticks sequentially for each symbol.
 *
 * This prevents two ticks for the same symbol
 * from modifying the learning state at the same time.
 */
const symbolQueues = new Map();

function queueForSymbol(symbol, task) {
  const previous =
    symbolQueues.get(symbol) ||
    Promise.resolve();

  const next =
    previous
      .catch(() => {})
      .then(task);

  symbolQueues.set(
    symbol,
    next
  );

  return next.finally(() => {
    if (
      symbolQueues.get(symbol) === next
    ) {
      symbolQueues.delete(symbol);
    }
  });
}

/*
 * Process a newly received Deriv tick.
 *
 * ORDER:
 *
 * 1. Resolve the prediction made from the
 *    previous known tick.
 *
 * 2. Create a new prediction based on the
 *    current tick for the NEXT tick.
 */
export function processTickForLearning({
  symbol,
  digit,
  epoch
}) {
  return queueForSymbol(
    symbol,
    async () => {
      /*
       * Validate incoming data.
       */
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

      if (
        !Number.isFinite(epoch)
      ) {
        console.warn(
          `⚠️ LEARNING SKIPPED: invalid epoch for ${symbol}:`,
          epoch
        );

        return null;
      }

      /*
       * ==========================================
       * STEP 1
       * RESOLVE PREVIOUS PREDICTION
       * ==========================================
       */

      const pending =
        await Prediction.findOne({
          symbol,
          result: 'PENDING',

          /*
           * The prediction must have been created
           * from an earlier tick.
           */
          predictionEpoch: {
            $lt: epoch
          }
        }).sort({
          predictedAt: -1
        });

      let resolved = null;

      if (pending) {
        const won =
          pending.predictedDigit === digit;

        pending.actualDigit =
          digit;

        pending.result =
          won
            ? 'WIN'
            : 'LOSS';

        pending.resolvedAt =
          new Date();

        await pending.save();

        resolved = {
          predictionId:
            pending._id.toString(),

          predictedDigit:
            pending.predictedDigit,

          actualDigit:
            digit,

          result:
            won
              ? 'WIN'
              : 'LOSS',

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
      }

      /*
       * ==========================================
       * STEP 2
       * CHECK WHETHER THIS TICK ALREADY HAS
       * A PREDICTION
       * ==========================================
       */

      const existing =
        await Prediction.findOne({
          symbol,
          predictionEpoch: epoch
        });

      if (existing) {
        console.log(
          `ℹ️ PREDICTION ALREADY EXISTS ${symbol}: epoch=${epoch} digit=${existing.predictedDigit}`
        );

        return {
          resolved,
          prediction: {
            id:
              existing._id.toString(),

            symbol,

            predictedDigit:
              existing.predictedDigit,

            probability:
              existing.probability,

            probabilityPercent:
              Number(
                (
                  existing.probability *
                  100
                ).toFixed(2)
              ),

            signal:
              existing.signal,

            strategy:
              existing.strategy,

            historySize:
              existing.historySize,

            currentDigit:
              existing.currentDigit,

            transitionSamples:
              existing.transitionSamples,

            status:
              existing.result
          }
        };
      }

      /*
       * ==========================================
       * STEP 3
       * PREDICT THE NEXT TICK
       * ==========================================
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
       * Validate predicted digit.
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
       * ==========================================
       * STEP 4
       * SAVE LOCKED PREDICTION
       * ==========================================
       */

      const savedPrediction =
        await Prediction.create({
          symbol,

          predictionEpoch:
            epoch,

          predictedDigit:
            prediction.prediction,

          actualDigit:
            null,

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

          currentDigit:
            prediction.currentDigit,

          transitionSamples:
            prediction.transitionSamples,

          predictedAt:
            new Date(),

          resolvedAt:
            null
        });

      console.log(
        `🔒 NEXT PREDICTION LOCKED ${symbol}: digit=${prediction.prediction} probability=${prediction.probabilityPercent}% signal=${prediction.signal} history=${prediction.historySize} epoch=${epoch}`
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
