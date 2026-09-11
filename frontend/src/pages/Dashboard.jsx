import { useState, useEffect, useRef } from 'react';

import {
  analyzeDigitMatch,
  getLastDigit
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
const MAX_TICKS = 200;
const COUNTDOWN_SECONDS = 5;

/*
 * This is only a display/signal threshold.
 *
 * IMPORTANT:
 * The percentage is a MODEL CONFIDENCE/SCORE,
 * NOT a guaranteed probability of winning.
 */
const MIN_SIGNAL_CONFIDENCE = 75;


/* ============================================================
   PREDICTION PANEL
   ============================================================ */

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
  status,
  connected
}) {
  const matches = history.filter(
    item => item.match
  ).length;

  const completed = history.length;

  const accuracy =
    completed > 0
      ? Math.round(
          (matches / completed) * 100
        )
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

          <p className="text-xs mt-1">
            {connected ? (
              <span className="text-green-400">
                ● CONNECTED
              </span>
            ) : (
              <span className="text-red-400">
                ● DISCONNECTED
              </span>
            )}
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
          Analysis refresh countdown
        </p>

      </div>


      {/* Prediction */}
      <div className="rounded-xl bg-black/40 border border-blue-400/20 p-5 text-center">

        <p className="text-gray-400 text-sm">
          NEXT DIGIT CANDIDATE
        </p>

        <div className="text-7xl font-black my-3 text-white">
          {prediction !== null
            ? prediction
            : '--'}
        </div>

        {confidence > 0 && (
          <p className="text-sm text-gray-400">
            Model confidence: {confidence}%
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
              ⚠️ NO STRONG SIGNAL — WAIT
            </span>
          )}

          {status === 'RESULT' && (
            <span className="text-blue-400">
              📊 RESULT RECEIVED
            </span>
          )}

          {status === 'LOADING' && (
            <span className="text-gray-500">
              Collecting live tick data...
            </span>
          )}

          {status === 'ERROR' && (
            <span className="text-red-400">
              ❌ STREAM ERROR
            </span>
          )}

        </div>

      </div>


      {/* Actual next tick */}
      <div className="mt-4 rounded-xl bg-black/30 p-4 text-center">

        <p className="text-gray-400 text-sm">
          NEXT ACTUAL DIGIT
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
            Waiting for the next live tick...
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
              Waiting for prediction results...
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


/* ============================================================
   DASHBOARD
   ============================================================ */

export default function Dashboard({
  user,
  onLogout
}) {

  /*
   * Raw live Deriv ticks.
   *
   * Example:
   *
   * {
   *   R_10: [
   *     tick,
   *     tick,
   *     tick
   *   ]
   * }
   */
  const [tickData, setTickData] =
    useState({});


  /*
   * Countdown timers.
   */
  const [timers, setTimers] =
    useState({});


  /*
   * Prediction/result state.
   */
  const [predictionState, setPredictionState] =
    useState({});


  /*
   * Connection status.
   */
  const [connectionState, setConnectionState] =
    useState({});


  /*
   * Keep EventSource objects outside React state.
   */
  const eventSources =
    useRef({});


  /*
   * ==========================================================
   * COUNTDOWN
   * ==========================================================
   */

  useEffect(() => {

    const initial = {};

    SYMBOLS.forEach(({ symbol }) => {
      initial[symbol] =
        COUNTDOWN_SECONDS;
    });

    setTimers(initial);


    const interval =
      setInterval(() => {

        setTimers(prev => {

          const next = {
            ...prev
          };

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


    return () =>
      clearInterval(interval);

  }, []);


  /*
   * ==========================================================
   * LIVE DERIV TICK STREAM
   * ==========================================================
   */

  useEffect(() => {

    SYMBOLS.forEach(({ symbol }) => {

      const streamUrl =
        `${BACKEND_URL}/ticks/stream/${symbol}`;


      console.log(
        `[${symbol}] Connecting to:`,
        streamUrl
      );


      const es =
        new EventSource(streamUrl);


      eventSources.current[symbol] =
        es;


      /*
       * Connected.
       */
      es.onopen = () => {

        console.log(
          `[${symbol}] Tick stream connected`
        );

        setConnectionState(prev => ({
          ...prev,
          [symbol]: true
        }));

      };


      /*
       * New live tick.
       */
      es.onmessage = event => {

        try {

          const tick =
            JSON.parse(event.data);


          console.log(
            `[${symbol}] Tick:`,
            tick
          );


          /*
           * Add the real tick to history.
           */
          setTickData(prev => {

            const existing =
              prev[symbol] || [];


            const updated = [
              ...existing,
              tick
            ].slice(-MAX_TICKS);


            return {
              ...prev,
              [symbol]: updated
            };

          });


        } catch (error) {

          console.error(
            `[${symbol}] Invalid tick data:`,
            error
          );

        }

      };


      /*
       * Stream error.
       */
      es.onerror = error => {

        console.error(
          `[${symbol}] Tick stream error:`,
          error
        );

        setConnectionState(prev => ({
          ...prev,
          [symbol]: false
        }));

      };

    });


    /*
     * Cleanup.
     */
    return () => {

      Object.values(
        eventSources.current
      ).forEach(es => {

        try {
          es.close();
        } catch {
          // Ignore cleanup errors.
        }

      });

      eventSources.current = {};

    };

  }, []);


  /*
   * ==========================================================
   * PREDICTION ENGINE
   * ==========================================================
   *
   * IMPORTANT:
   *
   * We create a prediction from the existing history.
   *
   * We then wait for ONE NEW LIVE TICK.
   *
   * That new tick becomes the result.
   */

  useEffect(() => {

    SYMBOLS.forEach(({ symbol }) => {

      const ticks =
        tickData[symbol] || [];


      /*
       * Need enough live ticks first.
       */
      if (
        ticks.length <
        MIN_DIGITS
      ) {

        setPredictionState(prev => ({

          ...prev,

          [symbol]: {

            ...(prev[symbol] || {}),

            status: 'LOADING',

            predicted: null,

            confidence: 0

          }

        }));

        return;

      }


      const current =
        predictionState[symbol];


      /*
       * If we already have a prediction waiting
       * for its result, don't create another one.
       */
      if (
        current?.waitingForResult
      ) {

        return;

      }


      /*
       * Analyse the ACTUAL live ticks.
       */
      const analysis =
        analyzeDigitMatch(ticks);


      const predicted =
        Number(analysis?.prediction);


      const confidence =
        Number(analysis?.confidence);


      /*
       * Validate prediction.
       */
      const validPrediction =
        Number.isInteger(predicted) &&
        predicted >= 0 &&
        predicted <= 9;


      if (!validPrediction) {

        return;

      }


      /*
       * Validate confidence.
       */
      const safeConfidence =
        Number.isFinite(confidence)
          ? Math.max(
              0,
              Math.min(
                100,
                Math.round(confidence)
              )
            )
          : 0;


      /*
       * Strong enough to display as a signal?
       */
      const strongSignal =
        safeConfidence >=
        MIN_SIGNAL_CONFIDENCE;


      /*
       * Record the exact number of ticks used
       * for this analysis.
       */
      const predictionTickCount =
        ticks.length;


      setPredictionState(prev => ({

        ...prev,

        [symbol]: {

          /*
           * Only expose the prediction as a SIGNAL
           * when confidence passes the threshold.
           */
          predicted:
            strongSignal
              ? predicted
              : null,


          confidence:
            safeConfidence,


          actual: null,


          result: null,


          status:
            strongSignal
              ? 'SIGNAL'
              : 'WAIT',


          waitingForResult:
            strongSignal,


          predictionTickCount,


          history:
            prev[symbol]?.history ||
            []

        }

      }));

    });

  }, [tickData, predictionState]);


  /*
   * ==========================================================
   * DETECT THE NEXT TICK AND SCORE THE PREDICTION
   * ==========================================================
   *
   * This separate effect watches for a new tick after a
   * prediction was created.
   */

  useEffect(() => {

    SYMBOLS.forEach(({ symbol }) => {

      const ticks =
        tickData[symbol] || [];


      const current =
        predictionState[symbol];


      if (
        !current ||
        !current.waitingForResult
      ) {

        return;

      }


      /*
       * We need at least one tick after the prediction.
       */
      if (
        ticks.length <=
        current.predictionTickCount
      ) {

        return;

      }


      /*
       * Get the newest REAL Deriv tick.
       */
      const latestTick =
        ticks[ticks.length - 1];


      const actual =
        getLastDigit(latestTick);


      if (
        actual === null ||
        actual === undefined
      ) {

        return;

      }


      /*
       * Compare the model prediction with the
       * actual next tick digit.
       */
      const match =
        Number(current.predicted) ===
        Number(actual);


      const historyItem = {

        predicted:
          current.predicted,

        actual,

        match,

        time:
          Date.now()

      };


      const history = [

        historyItem,

        ...(current.history || [])

      ].slice(0, 10);


      /*
       * Store result.
       */
      setPredictionState(prev => ({

        ...prev,

        [symbol]: {

          ...prev[symbol],

          actual,

          result:
            match
              ? 'MATCH'
              : 'MISS',

          waitingForResult:
            false,

          status:
            'RESULT',

          history

        }

      }));

    });

  }, [tickData, predictionState]);


  /*
   * ==========================================================
   * RENDER
   * ==========================================================
   */

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

      <main className="container mx-auto px-4 py-8">

        <h2 className="text-3xl font-bold mb-2 text-center">
          Digit Match Predictions
        </h2>


        <p className="text-center text-gray-400 mb-8">
          Live Deriv tick analysis
        </p>


        <div className="mb-8 rounded-xl border border-yellow-400/20 bg-yellow-400/5 p-4 text-center">

          <p className="text-sm text-yellow-300">
            ⚠️ Predictions are statistical candidates based on
            observed live ticks. They are not guaranteed outcomes.
          </p>

        </div>


        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">

          {SYMBOLS.map(({ symbol, name }) => {

            const state =
              predictionState[symbol] ||
              {};

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

                connected={
                  connectionState[symbol] ||
                  false
                }

              />

            );

          })}

        </div>

      </main>

    </div>

  );
}
