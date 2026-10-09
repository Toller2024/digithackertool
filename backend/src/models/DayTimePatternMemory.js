import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  symbol: { type: String, required: true },
  weekday: { type: Number, required: true, min: 0, max: 6 },
  digit: { type: Number, required: true, min: 0, max: 9 },
  timeSlot: { type: Number, required: true, min: 0, max: 1439 },

  // Discovery data comes from the earlier chronological portion of history.
  occurrenceCount: { type: Number, default: 0 },
  discoveryTotalObservations: { type: Number, default: 0 },
  discoveryDateKeys: { type: [String], default: [] },

  // Validation data comes from later, unseen historical ticks.
  validationOccurrenceCount: { type: Number, default: 0 },
  validationTotalObservations: { type: Number, default: 0 },
  validationDateKeys: { type: [String], default: [] },

  // Retained for compatibility with the live prediction outcome logger.
  validationSamples: { type: Number, default: 0 },
  validationWins: { type: Number, default: 0 },
  validationLosses: { type: Number, default: 0 },
  firstObservedEpoch: { type: Number, default: null },
  lastObservedEpoch: { type: Number, default: null }
}, { timestamps: true, versionKey: false });

schema.index({ symbol: 1, weekday: 1, timeSlot: 1, digit: 1 }, { unique: true });
schema.index({ symbol: 1, weekday: 1, timeSlot: 1 });

export default mongoose.models.DayTimePatternMemory ||
  mongoose.model('DayTimePatternMemory', schema);
