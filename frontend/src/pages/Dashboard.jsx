import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import PredictionCard from '../components/PredictionCard';
import { analyzeEvenOdd, analyzeOverUnder, analyzeDigitMatch } from '../utils/predictions';

const SYMBOLS = [
  { symbol: 'R_10', name: 'Volatility 10' },
  { symbol: 'R_25', name: 'Volatility 25' },
  { symbol: 'R_50', name: 'Volatility 50' },
  { symbol: 'R_75', name: 'Volatility 75' },
  { symbol: 'R_100', name: 'Volatility 100' }
];

export default function Dashboard({ user, onLogout }) {
  const [tickData, setTickData] = useState({});
  const [predictions, setPredictions] = useState({});

  useEffect(() => {
    const eventSources = {};

    SYMBOLS.forEach(({ symbol }) => {
      const es = new EventSource(`/api/ticks/stream/${symbol}`);
      
      es.onmessage = (event) => {
        const tick = JSON.parse(event.data);
        
        setTickData(prev => {
          const symbolData = prev[symbol] || [];
          const updated = [...symbolData, tick].slice(-30);
          
          // Generate predictions
          const evenOdd = analyzeEvenOdd(updated);
          const overUnder = analyzeOverUnder(updated);
          const digitMatch = analyzeDigitMatch(updated);
          
          setPredictions(p => ({
            ...p,
            [symbol]: { evenOdd, overUnder, digitMatch }
          }));
          
          return { ...prev, [symbol]: updated };
        });
      };
      
      eventSources[symbol] = es;
    });

    return () => {
      Object.values(eventSources).forEach(es => es.close());
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/20 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Digit Hacker Tool
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{user.email}</span>
            <button
              onClick={onLogout}
              className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg transition"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Dashboard Content */}
      <div className="container mx-auto px-4 py-8">
        <h2 className="text-3xl font-bold mb-8 text-center">Live Predictions</h2>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {SYMBOLS.map(({ symbol, name }) => (
            <PredictionCard
              key={symbol}
              symbol={symbol}
              name={name}
              predictions={predictions[symbol]}
              tickCount={tickData[symbol]?.length || 0}
              ticks={tickData[symbol] || []}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
