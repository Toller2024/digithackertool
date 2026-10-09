import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  symbol: { type: String, required: true },
  weekday: { type: Number, required: true, min: 0, max: 6 },
  digit: { type: Number, required: true, min: 0, max: 9 },
  timeSlot: { type: Number, required: true, min: 0, max: 1439 },
  occurrenceCount: { type: Number, default: 0 },
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
