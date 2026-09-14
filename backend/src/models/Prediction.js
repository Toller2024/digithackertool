import mongoose from 'mongoose';

const predictionSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: true,
      index: true
    },

    /*
     * The epoch of the tick that was already known
     * when this prediction was created.
     *
     * The prediction is for the NEXT tick.
     */
    predictionEpoch: {
      type: Number,
      required: true,
      index: true
    },

    /*
     * The predicted next digit.
     */
    predictedDigit: {
      type: Number,
      required: true,
      min: 0,
      max: 9
    },

    /*
     * Actual digit from the next unseen tick.
     */
    actualDigit: {
      type: Number,
      min: 0,
      max: 9,
      default: null
    },

    /*
     * Probability calculated from historical data.
     *
     * Example:
     * 0.17 = 17%
     */
    probability: {
      type: Number,
      min: 0,
      max: 1,
      required: true
    },

    /*
     * Trading signal.
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
     * Prediction outcome.
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
     * Strategy used.
     */
    strategy: {
      type: String,
      default: 'digit-analysis'
    },

    /*
     * Number of historical ticks available
     * when the prediction was created.
     */
    historySize: {
      type: Number,
      default: 0
    },

    /*
     * The current digit when the prediction
     * was created.
     */
    currentDigit: {
      type: Number,
      min: 0,
      max: 9,
      default: null
    },

    /*
     * Number of historical transitions involving
     * the current digit.
     */
    transitionSamples: {
      type: Number,
      default: 0
    },

    /*
     * Time prediction was created.
     */
    predictedAt: {
      type: Date,
      default: Date.now,
      index: true
    },

    /*
     * Time prediction was resolved.
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
 * Find pending predictions efficiently.
 */
predictionSchema.index({
  symbol: 1,
  result: 1,
  predictedAt: -1
});

/*
 * Prevent duplicate predictions for the same
 * symbol and prediction tick.
 */
predictionSchema.index(
  {
    symbol: 1,
    predictionEpoch: 1
  },
  {
    unique: true
  }
);

const Prediction =
  mongoose.models.Prediction ||
  mongoose.model(
    'Prediction',
    predictionSchema
  );

export default Prediction;
