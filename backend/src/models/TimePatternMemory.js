import mongoose from 'mongoose';

const timePatternMemorySchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, index: true },
    digit: { type: Number, required: true, min: 0, max: 9, index: true },
    granularity: { type: String, enum: ['10s', '60s'], required: true },
    timeSlot: { type: Number, required: true, index: true },

    occurrenceCount: { type: Number, default: 0 },
    predictionSamples: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },

    lastObservedEpoch: { type: Number, default: null },
    firstObservedEpoch: { type: Number, default: null },
    lastWinEpoch: { type: Number, default: null },
    lastLossEpoch: { type: Number, default: null },

    currentWinStreak: { type: Number, default: 0 },
    bestWinStreak: { type: Number, default: 0 }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

timePatternMemorySchema.index(
  {
    symbol: 1,
    digit: 1,
    granularity: 1,
    timeSlot: 1
  },
  { unique: true }
);

timePatternMemorySchema.index({
  symbol: 1,
  granularity: 1,
  timeSlot: 1,
  wins: -1
});

const TimePatternMemory =
  mongoose.models.TimePatternMemory ||
  mongoose.model(
    'TimePatternMemory',
    timePatternMemorySchema
  );

export default TimePatternMemory;
