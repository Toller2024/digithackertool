import mongoose from 'mongoose';

const predictionSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: true,
      index: true
    },

    /*
     * The digit our system predicted BEFORE
     * the next tick arrived.
     */
    predictedDigit: {
      type: Number,
      required: true,
      min: 0,
      max: 9
    },

    /*
     * The actual digit from the next
     * unseen Deriv tick.
     *
     * This remains null until the next tick
     * arrives.
     */
    actualDigit: {
      type: Number,
      min: 0,
      max: 9,
      default: null
    },

    /*
     * Prediction probability at the moment
     * the prediction was made.
     *
     * Example:
     * 0.18 = 18%
     */
    probability: {
      type: Number,
      min: 0,
      max: 1,
      required: true
    },

    /*
     * Whether there was enough evidence
     * to recommend an entry.
     */
    signal: {
      type: String,
      enum: [
        'ENTRY',
        'WAIT',
        'NO_ENTRY'
      ],
      default: 'WAIT'
    },

    /*
     * Result after the next tick arrives.
     */
    result: {
      type: String,
      enum: [
        'PENDING',
        'WIN',
        'LOSS'
      ],
      default: 'PENDING',
      index: true
    },

    /*
     * Optional description of the evidence
     * used by the prediction engine.
     */
    strategy: {
      type: String,
      default: 'digit-analysis'
    },

    /*
     * Number of historical ticks available
     * when this prediction was created.
     */
    historySize: {
      type: Number,
      default: 0
    },

    /*
     * Time when prediction was created.
     */
    predictedAt: {
      type: Date,
      default: Date.now,
      index: true
    },

    /*
     * Time when the actual result became known.
     */
    resolvedAt: {
      type: Date,
      default: null
    }
  },
  {
    versionKey: false
  }
);

/*
 * Helps us quickly find the latest
 * unresolved prediction for a symbol.
 */
predictionSchema.index({
  symbol: 1,
  result: 1,
  predictedAt: -1
});

const Prediction =
  mongoose.models.Prediction ||
  mongoose.model(
    'Prediction',
    predictionSchema
  );

export default Prediction;
