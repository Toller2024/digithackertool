import { useEffect, useState } from 'react';

export default function PredictionCard({
  symbol,
  name,
  predictions,
  tickCount,
  ticks
}) {
  const [entrySeconds, setEntrySeconds] = useState(0);
  const [signalUsed, setSignalUsed] = useState(false);

  const digitMatch = predictions?.digitMatch;

  // ----------------------------------------------------------
  // ENTRY SIGNAL
  // ----------------------------------------------------------

  useEffect(() => {
    if (!digitMatch) {
      setEntrySeconds(0);
      return;
    }

    if (digitMatch.signal === 'ENTRY') {
      setSignalUsed(false);
      setEntrySeconds(
        digitMatch.entryWindowSeconds || 3
      );
    } else {
      setEntrySeconds(0);
    }
  }, [
    digitMatch?.signal,
    digitMatch?.prediction,
    digitMatch?.entryWindowSeconds
  ]);

  // ----------------------------------------------------------
  // LIVE COUNTDOWN
  // ----------------------------------------------------------

  useEffect(() => {
    if (entrySeconds <= 0) {
      return;
    }

    const timer = setInterval(() => {
      setEntrySeconds(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }

        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [digitMatch?.prediction, digitMatch?.signal]);

  // ----------------------------------------------------------
  // SIGNAL STATUS
  // ----------------------------------------------------------

  const getSignalStyle = () => {
    if (!digitMatch) {
      return {
        box: 'bg-gray-500/10 border-gray-500/30',
        text: 'text-gray-300',
        title: 'WAITING'
      };
    }

    if (signalUsed) {
      return {
        box: 'bg-blue-500/10 border-blue-500/30',
        text: 'text-blue-300',
        title: 'SIGNAL USED'
      };
    }

    if (
      digitMatch.signal === 'ENTRY' &&
      entrySeconds > 0
    ) {
      return {
        box: 'bg-green-500/20 border-green-400',
        text: 'text-green-300',
        title: 'ENTRY'
      };
    }

    if (digitMatch.signal === 'WAIT') {
      return {
        box: 'bg-yellow-500/10 border-yellow-400/40',
        text: 'text-yellow-300',
        title: 'WAIT'
      };
    }

    return {
      box: 'bg-red-500/10 border-red-500/30',
      text: 'text-red-300',
      title: 'NO ENTRY'
    };
  };

  const style = getSignalStyle();

  // ----------------------------------------------------------
  // USE SIGNAL
  // ----------------------------------------------------------

  const handleUseSignal = () => {
    if (
      digitMatch?.signal !== 'ENTRY' ||
      entrySeconds <= 0 ||
      signalUsed
    ) {
      return;
    }

    // One entry only.
    setSignalUsed(true);
    setEntrySeconds(0);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl p-6 shadow-xl">

      {/* ---------------------------------------------------- */}
      {/* HEADER */}
      {/* ---------------------------------------------------- */}

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
          <p className="text-xs text-gray-500">
            LIVE TICKS
          </p>

          <p className="text-lg font-bold">
            {tickCount}/30
          </p>
        </div>

      </div>


      {/* ---------------------------------------------------- */}
      {/* DIGIT MATCH */}
      {/* ---------------------------------------------------- */}

      <div className="mb-5 rounded-xl bg-white/5 p-4">

        <div className="flex justify-between items-center mb-3">

          <h4 className="font-semibold">
            DIGIT MATCH
          </h4>

          <span className="text-xs text-gray-400">
            30-tick analysis
          </span>

        </div>


        {digitMatch ? (

          <>

            {/* Predicted digit */}

            <div className="text-center py-4">

              <p className="text-sm text-gray-400 mb-1">
                PREDICTED DIGIT
              </p>

              <div className="text-6xl font-black">
                {digitMatch.prediction}
              </div>

            </div>


            {/* Confidence */}

            <div className="flex justify-between items-center mb-2">

              <span className="text-sm text-gray-400">
                Confidence
              </span>

              <span className="font-bold">
                {digitMatch.confidence}%
              </span>

            </div>

            <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">

              <div
                className="h-full bg-blue-400 transition-all duration-500"
                style={{
                  width: `${Math.min(
                    100,
                    digitMatch.confidence
                  )}%`
                }}
              />

            </div>


            {/* Frequency */}

            <div className="grid grid-cols-3 gap-2 mt-4 text-center">

              <div className="bg-black/20 rounded-lg p-2">

                <p className="text-xs text-gray-500">
                  OCCURRENCES
                </p>

                <p className="font-bold">
                  {digitMatch.frequency}
                </p>

              </div>

              <div className="bg-black/20 rounded-lg p-2">

                <p className="text-xs text-gray-500">
                  STABILITY
                </p>

                <p className="font-bold">
                  {digitMatch.stability}/3
                </p>

              </div>

              <div className="bg-black/20 rounded-lg p-2">

                <p className="text-xs text-gray-500">
                  TICKS
                </p>

                <p className="font-bold">
                  {digitMatch.sampleSize}
                </p>

              </div>

            </div>

          </>

        ) : (

          <div className="text-center py-8 text-gray-500">
            Waiting for enough live ticks...
          </div>

        )}

      </div>


      {/* ---------------------------------------------------- */}
      {/* SIGNAL PANEL */}
      {/* ---------------------------------------------------- */}

      <div
        className={`rounded-xl border p-5 transition-all duration-300 ${style.box}`}
      >

        <div className="text-center">

          {/* Signal title */}

          <p
            className={`text-sm font-bold tracking-widest ${style.text}`}
          >
            {style.title}
          </p>


          {/* ENTRY */}

          {digitMatch?.signal === 'ENTRY' &&
          !signalUsed ? (

            <>

              <div className="mt-3">

                <p className="text-sm text-gray-400">
                  ENTER DIGIT
                </p>

                <p
                  className={`text-5xl font-black ${style.text}`}
                >
                  {digitMatch.prediction}
                </p>

              </div>


              {/* Confidence */}

              <p className="mt-3 text-lg font-bold">
                Confidence:{' '}
                {digitMatch.confidence}%
              </p>


              {/* Entry score */}

              <p className="text-sm text-gray-400 mt-1">
                Signal Score:{' '}
                {digitMatch.entryScore}/100
              </p>


              {/* Countdown */}

              {entrySeconds > 0 ? (

                <div className="mt-5">

                  <p className="text-xs text-gray-400 uppercase tracking-widest">
                    ENTER WITHIN
                  </p>

                  <div
                    className={`text-5xl font-black mt-1 ${style.text}`}
                  >
                    {entrySeconds}s
                  </div>

                  <p className="text-xs text-gray-400 mt-2">
                    One run only
                  </p>

                </div>

              ) : (

                <p className="mt-4 text-red-300 font-semibold">
                  ENTRY WINDOW EXPIRED
                </p>

              )}


              {/* Manual signal-use button */}

              {entrySeconds > 0 && (

                <button
                  onClick={handleUseSignal}
                  className="mt-5 w-full py-3 rounded-xl bg-green-500 hover:bg-green-400 text-black font-black transition"
                >
                  ENTER — DIGIT {digitMatch.prediction}
                </button>

              )}

            </>

          ) : null}


          {/* WAIT */}

          {digitMatch?.signal === 'WAIT' &&
          !signalUsed && (

            <div className="mt-3">

              <p className="text-xl font-bold text-yellow-300">
                WAIT
              </p>

              <p className="text-sm text-gray-400 mt-1">
                Digit {digitMatch.prediction}
              </p>

              <p className="text-sm text-gray-400">
                Confidence:{' '}
                {digitMatch.confidence}%
              </p>

              <p className="text-xs text-gray-500 mt-3">
                Waiting for stronger confirmation...
              </p>

            </div>

          )}


          {/* NO ENTRY */}

          {digitMatch?.signal === 'NO ENTRY' &&
          !signalUsed && (

            <div className="mt-3">

              <p className="text-xl font-bold text-red-300">
                NO ENTRY
              </p>

              <p className="text-sm text-gray-400 mt-1">
                No sufficiently strong signal
              </p>

              {digitMatch && (
                <p className="text-sm text-gray-500 mt-2">
                  Digit {digitMatch.prediction} ·{' '}
                  {digitMatch.confidence}%
                </p>
              )}

            </div>

          )}


          {/* SIGNAL USED */}

          {signalUsed && (

            <div className="mt-3">

              <p className="text-xl font-bold text-blue-300">
                SIGNAL USED
              </p>

              <p className="text-sm text-gray-400 mt-1">
                Digit {digitMatch?.prediction}
              </p>

              <p className="text-xs text-gray-500 mt-3">
                Waiting for a fresh qualifying signal...
              </p>

            </div>

          )}

        </div>

      </div>

    </div>
  );
}
