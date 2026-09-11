import { useState, useEffect } from 'react';
import { analyzeDigitMatch } from '../utils/predictions';
const SYMBOLS = [
  { symbol: 'R_10', name: 'Volatility 10' },
  { symbol: 'R_25', name: 'Volatility 25' },
  { symbol: 'R_50', name: 'Volatility 50' },
  { symbol: 'R_75', name: 'Volatility 75' },
  { symbol: 'R_100', name: 'Volatility 100' }
];
const BACKEND_URL = 'https://digithackertool-backend.onrender.com';
function getLastDigit(tick) {
  if (tick === null || tick === undefined) return null;
  if (typeof tick === 'number') {
    const text = String(tick);
    const digits = text.replace(/\D/g, '');
    return digits.length ? Number(digits[digits.length - 1]) : null;
  }
  if (tick.digit !== undefined) {
    const digit = Number(tick.digit);
    if (digit >= 0 && digit <= 9) return digit;
  }
  if (tick.lastDigit !== undefined) {
    const digit = Number(tick.lastDigit);
    if (digit >= 0 && digit <= 9) return digit;
  }
  const value =
    tick.quote ??
    tick.tick ??
    tick.price ??
    tick.value;
  if (value === undefined || value === null) return null;
  const text = String(value);
  const digits = text.replace(/\D/g, '');
  return digits.length
    ? Number(digits[digits.length - 1])
    : null;
}
function getPredictionDigit(result) {
  if (result === null || result === undefined) {
    return null;
  }
  if (typeof result === 'number') {
    return result;
  }
  if (result.prediction !== undefined) {
    const digit = Number(result.prediction);
    if (digit >= 0 && digit <= 9) {
      return digit;
    }
  }
  return null;
}
function getConfidence(result) {
  if (!result) return 0;
  const confidence = Number(result.confidence);
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(100, Math.round(confidence)));
}
function PredictionPanel({
  name,
  symbol,
  timer,
  prediction,
  actual,
  result,
  confidence,
  tickCount,
  history
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5 shadow-xl">
      {/* Header */}
      <div className="flex justify-between items-center mb-5">
        <div>
          <h3 className="text-xl font-bold">
            {name}
          </h3>
          <p className="text-sm text-gray-400">
            {symbol}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">
            LIVE TICKS
          </p>
          <p className="font-bold">
            {tickCount}
          </p>
        </div>
      </div>
      {/* Countdown */}
      <div className="text-center mb-5">
        <p className="text-gray-400 text-sm mb-2">
          NEXT PREDICTION IN
        </p>
        <div className="text-6xl font-black text-blue-400">
          {timer}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          5 second prediction cycle
        </p>
      </div>
      {/* Prediction */}
      <div className="rounded-xl bg-black/40 border border-blue-400/20 p-5 text-center">
        <p className="text-gray-400 text-sm">
          PREDICTED NEXT DIGIT
        </p>
        <div className="text-7xl font-black my-3 text-white">
          {prediction !== null ? prediction : '--'}
        </div>
        {confidence > 0 && (
          <p className="text-sm text-gray-400">
            Model strength: {confidence}%
          </p>
        )}
      </div>
      {/* Actual result */}
      <div className="mt-4 rounded-xl bg-black/30 p-4 text-center">
        <p className="text-gray-400 text-sm">
          ACTUAL NEXT DIGIT
        </p>
        <div className="text-5xl font-black my-2">
          {actual !== null ? actual : '--'}
        </div>
        {result === 'MATCH' && (
          <div className="text-green-400 font-bold text-lg">
            ✅ MATCH
          </div>
        )}
        {result === 'MISS' && (
          <div className="text-red-400 font-bold text-lg">
            ❌ MISS
          </div>
        )}
        {!result && (
          <div className="text-gray-500 text-sm">
            Waiting for next tick...
          </div>
        )}
      </div>
      {/* Prediction history */}
      <div className="mt-5">
        <div className="flex justify-between items-center mb-2">
          <p className="text-sm font-semibold">
            Prediction History
          </p>
          <p className="text-xs text-gray-500">
            Latest 10
          </p>
        </div>
        <div className="space-y-2">
          {history.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-3">
              Waiting for prediction...
            </p>
          )}
          {history.map((item, index) => (
            <div
              key={`${item.time}-${index}`}
              className="flex items-center justify-between rounded-lg bg-black/30 px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  #{history.length - index}
                </span>
                <span className="font-bold">
                  {item.predicted}
                </span>
                <span className="text-gray-500">
                  →
                </span>
                <span className="font-bold">
                  {item.actual}
                </span>
              </div>
              {item.match ? (
                <span className="text-green-400 text-sm font-bold">
                  ✅
                </span>
              ) : (
                <span className="text-red-400 text-sm font-bold">
                  ❌
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
export default function Dashboard({ user, onLogout }) {
  const [tickData, setTickData] = useState({});
  const [predictions, setPredictions] = useState({});
  const [timers, setTimers] = useState({});
  const [predictionState, setPredictionState] = useState({});
  /*
   * Create a separate 5-second countdown for every volatility.
   */
  useEffect(() => {
    const initialTimers = {};
    SYMBOLS.forEach(({ symbol }) => {
      initialTimers[symbol] = 5;
    });
    setTimers(initialTimers);
    const interval = setInterval(() => {
      setTimers(prev => {
        const next = { ...prev };
        SYMBOLS.forEach(({ symbol }) => {
          const current = prev[symbol] ?? 5;
          if (current <= 1) {
            next[symbol] = 5;
          } else {
            next[symbol] = current - 1;
          }
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  /*
   * When countdown reaches 5 after a cycle,
   * create the next prediction from the latest tick history.
   */
  useEffect(() => {
    SYMBOLS.forEach(({ symbol }) => {
      if (timers[symbol] !== 5) return;
      const ticks = tickData[symbol] || [];
      if (ticks.length < 5) return;
      const analysis = analyzeDigitMatch(ticks);
      const digit = getPredictionDigit(analysis);
      if (digit === null) return;
      setPredictions(prev => ({
        ...prev,
        [symbol]: analysis
      }));
      setPredictionState(prev => {
        const current = prev[symbol];
        /*
         * Don't create another prediction repeatedly
         * during the same 5-second state.
         */
        const cycle = Math.floor(Date.now() / 5000);
        if (current?.cycle === cycle) {
          return prev;
        }
        return {
          ...prev,
          [symbol]: {
            predicted: digit,
            actual: null,
            result: null,
            confidence: getConfidence(analysis),
            cycle,
            history: current?.history || []
          }
        };
      });
    });
  }, [timers, tickData]);
  /*
   * Connect to all five live tick streams.
   */
  useEffect(() => {
    const eventSources = {};
    SYMBOLS.forEach(({ symbol }) => {
      const streamUrl =
        `${BACKEND_URL}/ticks/stream/${symbol}`;
      console.log(
        `Connecting to tick stream: ${streamUrl}`
      );
      const es = new EventSource(streamUrl);
      es.onopen = () => {
        console.log(
          `Tick stream connected: ${symbol}`
        );
      };
      es.onmessage = (event) => {
        try {
          const tick = JSON.parse(event.data);
          setTickData(prev => {
            const previous =
              prev[symbol] || [];
            const updated = [
              ...previous,
              tick
            ].slice(-200);
            return {
              ...prev,
              [symbol]: updated
            };
          });
          /*
           * Get the actual digit from the newly
           * received tick.
           */
          const actual = getLastDigit(tick);
          if (actual === null) return;
          /*
           * Compare the tick against the currently
           * locked prediction.
           */
          setPredictionState(prev => {
            const current = prev[symbol];
            if (!current) {
              return prev;
            }
            /*
             * If this prediction has already received
             * an actual result, don't overwrite it.
             */
            if (current.actual !== null) {
              return prev;
            }
            const match =
              Number(current.predicted) === Number(actual);
            const newHistory = [
              {
                predicted: current.predicted,
                actual,
                match,
                time: Date.now()
              },
              ...(current.history || [])
            ].slice(0, 10);
            return {
              ...prev,
              [symbol]: {
                ...current,
                actual,
                result: match
                  ? 'MATCH'
                  : 'MISS',
                history: newHistory
              }
            };
          });
        } catch (error) {
          console.error(
            `Invalid tick data for ${symbol}:`,
            error
          );
        }
      };
      es.onerror = (error) => {
        console.error(
          `Tick stream error for ${symbol}:`,
          error
        );
      };
      eventSources[symbol] = es;
    });
    return () => {
      Object.values(eventSources)
        .forEach(es => es.close());
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
            <span className="text-sm text-gray-400">
              {user?.email}
            </span>
            <button
              onClick={onLogout}
              className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg transition"
            >
              Logout
            </button>
          </div>
        </div>
      </header>
      {/* Main */}
      <div className="container mx-auto px-4 py-8">
        <h2 className="text-3xl font-bold mb-2 text-center">
          Digit Match Predictions
        </h2>
        <p className="text-center text-gray-400 mb-8">
          Next-digit prediction • 5-second alert cycle
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {SYMBOLS.map(({ symbol, name }) => {
            const state =
              predictionState[symbol] || {};
            return (
              <PredictionPanel
                key={symbol}
                name={name}
                symbol={symbol}
                timer={timers[symbol] ?? 5}
                prediction={
                  state.predicted ?? null
                }
                actual={
                  state.actual ?? null
                }
                result={
                  state.result ?? null
                }
                confidence={
                  state.confidence ?? 0
                }
                tickCount={
                  tickData[symbol]?.length || 0
                }
                history={
                  state.history || []
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
