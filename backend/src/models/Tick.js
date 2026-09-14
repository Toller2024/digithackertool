import mongoose from 'mongoose';

const tickSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: true,
      index: true
    },

    quote: {
      type: Number,
      required: true
    },

    digit: {
      type: Number,
      required: true,
      min: 0,
      max: 9,
      index: true
    },

    epoch: {
      type: Number,
      required: true,
      index: true
    },

    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    versionKey: false
  }
);

/*
 * Prevent storing the same tick twice.
 */
tickSchema.index(
  {
    symbol: 1,
    epoch: 1
  },
  {
    unique: true
  }
);

const Tick =
  mongoose.models.Tick ||
  mongoose.model('Tick', tickSchema);

export default Tick;
