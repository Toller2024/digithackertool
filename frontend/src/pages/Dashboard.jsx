import { useState, useEffect, useRef } from 'react';
import {
  analyzeDigitMatch,
  extractLastDigits
} from '../utils/predictions';

const SYMBOLS = [
  { symbol: 'R_10', name: 'Volatility 10' },
  { symbol: 'R_25', name: 'Volatility 25' },
  { symbol: 'R_50', name: 'Volatility 50' },
  { symbol: 'R_75', name: 'Volatility 75' },
  { symbol: 'R_100', name: 'Volatility 100' }
];

const BACKEND_URL =
  'https://digithackertool-backend.onrender.com';

const MIN_DIGITS = 30;
const COUNTDOWN_SECONDS = 5;

/*
 * Extract the actual last digit from ONE Deriv tick.
 */
function getLastDigit(tick) {
  if (tick === null || tick === undefined) {
    return null;
  }

  if (typeof tick === 'number') {
    const text = String(tick);
    const digits = text.replace(/\D/g, '');

    return digits.length
      ? Number(digits[digits.length - 1])
      : null;
  }

  if (tick.digit !== undefined) {
    const digit = Number(tick.digit);

    if (
      Number.isInteger(digit) &&
      digit >= 0 &&
      digit <= 9
    ) {
      return digit;
    }
  }

  if (tick.lastDigit !== undefined) {
    const digit = Number(tick.lastDigit);

    if (
      Number.isInteger(digit) &&
      digit >= 0 &&
      digit <= 9
    ) {
      return digit;
    }
  }

  const value =
    tick.quote ??
    tick.tick ??
    tick.price ??
    tick.value;

  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value);
  const digits = text.replace(/\D/g, '');

  return digits.length
    ? Number(digits[digits.length - 1])
    : null;
}

/*
 * Get prediction digit from prediction engine.
 */
function getPredictionDigit(result) {
  if (!result) return null;

  const digit = Number(result.prediction);

  if (
    Number.isInteger(digit) &&
    digit >= 0 &&
    digit <= 9
  ) {
    return digit;
  }

  return null;
}

function getConfidence(result) {
  if (!result) return 0;

  const confidence = Number(result.confidence);

  if (!Number.isFinite(confidence)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(100, Math.round(confidence))
  );
}

/*
 * We don't force a trade when the prediction engine
 * doesn't have enough evidence.
 *
 * Change this later only after measuring actual results.
 */
const MIN_SIGNAL_CONFIDENCE = 75;

function PredictionPanel({
  name,
  symbol,
  timer,
  prediction,
  actual,
  result,
  confidence,
  tickCount,
  history,
  status
}) {
  const matches = history.filter(
    item => item.match
  ).length;

  const completed = history.length;

  const accuracy =
    completed > 0
      ? Math.round((matches / completed) * 100)
      : 0;

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
          NEXT PREDICTION ALERT
        </p>

        <div className="text-6xl font-black text-blue-400">
          {timer}
        </div>

        <p className="text-xs text-gray-500 mt-2">
          5 → 4 → 3 → 2 → 1
        </p>

      </div>

      {/* Prediction */}
      <div className="rounded-xl bg-black/40 border border-blue-400/20 p-5 text-center">

        <p className="text-gray-400 text-sm">
          NEXT DIGIT
        </p>

        <div className="text-7xl font-black my-3 text-white">
          {prediction !== null
            ? prediction
            : '--'}
        </div>

        {confidence > 0 && (
          <p className="text-sm text-gray-400">
            Model score: {confidence}%
          </p>
        )}

        <div className="mt-3 text-sm font-semibold">

          {status === 'SIGNAL' && (
            <span className="text-green-400">
              🟢 SIGNAL
            </span>
          )}

          {status === 'WAIT' && (
            <span className="text-yellow-400">
              ⚠️ NO SIGNAL — WAIT
            </span>
          )}

          {status === 'RESULT' && (
            <span className="text-blue-400">
              📊 RESULT RECEIVED
            </span>
          )}

          {status === 'LOADING' && (
            <span className="text-gray-500">
              Collecting tick data...
            </span>
          )}

        </div>

      </div>

      {/* Actual result */}
      <div className="mt-4 rounded-xl bg-black/30 p-4 text-center">

        <p className="text-gray-400 text-sm">
          ACTUAL NEXT DIGIT
        </p>

        <div className="text-5xl font-black my-2">
          {actual !== null
            ? actual
            : '--'}
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
            Waiting for the next tick...
          </div>
        )}

      </div>

      {/* Accuracy */}
      <div className="mt-4 rounded-xl bg-black/30 p-3 text-center">

        <p className="text-xs text-gray-500">
          OBSERVED ACCURACY
        </p>

        <p className="text-xl font-bold">
          {completed > 0
            ? `${accuracy}%`
            : '--'}
        </p>

        <p className="text-xs text-gray-500">
          {matches} matches / {completed} completed
        </p>

      </div>

      {/* History */}
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
              Waiting for first completed prediction...
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

export default function Dashboard({
  user,
  onLogout
}) {

  const [tickData, setTickData] = useState({});
  const [timers, setTimers] = useState({});
  const [predictionState, setPredictionState] =
    useState({});

  /*
   * Keep the latest tick count outside the React
   * render cycle so we know exactly which tick a
   * prediction was based on.
   */
  const tickCounts = useRef({});

  /*
   * =====================================================
   * 5 SECOND COUNTDOWN
   * =====================================================
   */

  useEffect(() => {

    const initial = {};

    SYMBOLS.forEach(({ symbol }) => {
      initial[symbol] = COUNTDOWN_SECONDS;
    });

    setTimers(initial);

    const interval = setInterval(() => {

      setTimers(prev => {

        const next = { ...prev };

        SYMBOLS.forEach(({ symbol }) => {

          const current =
            prev[symbol] ??
            COUNTDOWN_SECONDS;

          next[symbol] =
            current <= 1
              ? COUNTDOWN_SECONDS
              : current - 1;

        });

        return next;

      });

    }, 1000);

    return () => clearInterval(interval);

  }, []);

  /*
   * =====================================================
   * CREATE NEW PREDICTION
   * =====================================================
   *
   * A prediction is based ONLY on ticks that already
   * existed before the prediction.
   *
   * The next incoming tick is then the result.
   */

  useEffect(() => {

    SYMBOLS.forEach(({ symbol }) => {

      const ticks =
        tickData[symbol] || [];

      if (ticks.length < MIN_DIGITS) {
        return;
      }

      const currentState =
        predictionState[symbol];

      /*
       * Don't create a new prediction if there is
       * already one waiting for its next tick.
       */
      if (
        currentState &&
        currentState.waitingForResult
      ) {
        return;
      }

      /*
       * Convert raw Deriv ticks into actual digits.
       *
       * THIS IS THE IMPORTANT FIX.
       */
      const digits =
        extractLastDigits(ticks);

      if (digits.length < MIN_DIGITS) {
        return;
      }

      const analysis =
        analyzeDigitMatch(digits);

      const predicted =
        getPredictionDigit(analysis);

      const confidence =
        getConfidence(analysis);

      if (predicted === null) {
        return;
      }

      /*
       * Only create a signal when the model reaches
       * the configured threshold.
       */
      const hasStrongSignal =
        confidence >= MIN_SIGNAL_CONFIDENCE;

      /*
       * Remember exactly how many ticks existed when
       * this prediction was created.
       */
      const predictionTickCount =
        ticks.length;

      setPredictionState(prev => ({

        ...prev,

        [symbol]: {

          predicted:
            hasStrongSignal
              ? predicted
              : null,

          actual: null,

          result: null,

          confidence,

          waitingForResult:
            hasStrongSignal,

          predictionTickCount,

          status:
            hasStrongSignal
              ? 'SIGNAL'
              : 'WAIT',

          history:
            prev[symbol]?.history || []

        }

      }));

    });

  }, [tickData, predictionState]);

  /*
   * =====================================================
   * LIVE DERIV STREAMS
   * =====================================================
   */

  useEffect(() => {

    const eventSources = {};

    SYMBOLS.forEach(({ symbol }) => {

      const streamUrl =
        `${BACKEND_URL}/ticks/stream/${symbol}`;

      console.log(
        `Connecting to tick stream: ${streamUrl}`
      );

      const es =
        new EventSource(streamUrl);

      es.onopen = () => {

        console.log(
          `Tick stream connected: ${symbol}`
        );

      };

      es.onmessage = (event) => {

        try {

          const tick =
            JSON.parse(event.data);

          /*
           * Get actual digit from THIS tick.
           */
          const actual =
            getLastDigit(tick);

          /*
           * Update tick history.
           */
          setTickData(prev => {

            const previous =
              prev[symbol] || [];

            const updated = [
              ...previous,
              tick
            ].slice(-200);

            tickCounts.current[symbol] =
              updated.length;

            return {
              ...prev,
              [symbol]: updated
            };

          });

          if (actual === null) {
            return;
          }

          /*
           * Check whether there is a prediction waiting
           * for the NEXT tick.
           */
          setPredictionState(prev => {

            const current =
              prev[symbol];

            if (!current) {
              return prev;
            }

            if (!current.waitingForResult) {
              return prev;
            }

            /*
             * The prediction was based on N ticks.
             *
             * We need a tick AFTER those N ticks.
             *
             * The newly received tick is exactly that
             * result tick.
             */
            const currentTickCount =
              tickCounts.current[symbol] || 0;

            if (
              currentTickCount <=
              current.predictionTickCount
            ) {
              return prev;
            }

            const match =
              Number(current.predicted) ===
              Number(actual);

            const historyItem = {

              predicted:
                current.predicted,

              actual,

              match,

              time: Date.now()

            };

            const history = [

              historyItem,

              ...(current.history || [])

            ].slice(0, 10);

            return {

              ...prev,

              [symbol]: {

                ...current,

                actual,

                result:
                  match
                    ? 'MATCH'
                    : 'MISS',

                waitingForResult: false,

                status: 'RESULT',

                history

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
          Next-digit analysis • 5-second alert
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

                timer={
                  timers[symbol] ??
                  COUNTDOWN_SECONDS
                }

                prediction={
                  state.predicted ??
                  null
                }

                actual={
                  state.actual ??
                  null
                }

                result={
                  state.result ??
                  null
                }

                confidence={
                  state.confidence ??
                  0
                }

                tickCount={
                  tickData[symbol]?.length ||
                  0
                }

                history={
                  state.history ||
                  []
                }

                status={
                  state.status ||
                  (
                    (tickData[symbol]?.length || 0)
                      < MIN_DIGITS
                      ? 'LOADING'
                      : 'WAIT'
                  )
                }
              />

            );

          })}

        </div>

      </div>

    </div>

  );
}
