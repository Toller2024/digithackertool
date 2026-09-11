import { motion } from 'framer-motion';
import TickChart from './TickChart';
import StatsPanel from './StatsPanel';

export default function PredictionCard({ symbol, name, predictions, tickCount, ticks }) {
  if (!predictions) {
    return (
      <div className="bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20 p-6">
        <h3 className="text-lg font-semibold text-blue-300 mb-4">{name}</h3>
        <p className="text-gray-400">Collecting data... ({tickCount}/30 ticks)</p>
      </div>
    );
  }

  const { evenOdd, overUnder, digitMatch } = predictions;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20 p-6 space-y-4"
    >
      <h3 className="text-lg font-semibold text-blue-300 mb-4">{name}</h3>
      
      {/* Even/Odd */}
      {evenOdd && (
        <div className="bg-black/30 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-2">EVEN / ODD</p>
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className={`text-2xl font-bold ${
              evenOdd.prediction === 'EVEN' ? 'text-green-400' : 'text-purple-400'
            }`}
          >
            {evenOdd.prediction}
          </motion.div>
          <p className="text-sm text-gray-300 mt-1">
            Confidence: {evenOdd.confidence}%
          </p>
        </div>
      )}

      {/* Over/Under */}
      {overUnder && overUnder.prediction && (
        <div className="bg-black/30 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-2">OVER / UNDER</p>
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className={`text-2xl font-bold ${
              overUnder.prediction === 'OVER' ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {overUnder.label}
          </motion.div>
          <p className="text-sm text-gray-300 mt-1">
            Confidence: {overUnder.confidence}%
          </p>
          <p className="text-xs text-yellow-300 mt-1">
            Recommended: {overUnder.recommendedRuns} runs
          </p>
        </div>
      )}

      {/* Digit Match */}
      {digitMatch && (
        <div className="bg-black/30 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-2">DIGIT MATCH</p>
          <div className="text-2xl font-bold text-orange-400">
            {digitMatch.prediction}
          </div>
          <p className="text-sm text-gray-300 mt-1">
            Confidence: {digitMatch.confidence}%
          </p>
        </div>
      )}

      {/* Stats Panel */}
      <StatsPanel ticks={ticks} />

      {/* Tick Chart */}
      <TickChart ticks={ticks} />
    </motion.div>
  );
}
