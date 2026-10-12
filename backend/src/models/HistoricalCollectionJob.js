import mongoose from 'mongoose';

const historicalCollectionJobSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: 'historical-collection'
    },
    running: {
      type: Boolean,
      default: false
    },
    startedAt: {
      type: Date,
      default: null
    },
    finishedAt: {
      type: Date,
      default: null
    },
    error: {
      type: String,
      default: null
    },
    targetPerSymbol: {
      type: Number,
      default: 1000000
    },
    symbols: {
      type: [String],
      default: []
    },
    currentSymbol: {
      type: String,
      default: null
    },
    results: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

export default mongoose.models.HistoricalCollectionJob ||
  mongoose.model(
    'HistoricalCollectionJob',
    historicalCollectionJobSchema
  );
