import { useEffect, useRef, useState } from 'react';

import {
  analyzeEvenOdd,
  analyzeOverUnder,
  analyzeDigitMatch,
  extractLastDigits
} from '../utils/predictions';

const BACKEND_URL =
  'https://digithackertool-backend.onrender.com';

const SYMBOLS = [
  {
    symbol: 'R_10',
    name: 'Volatility 10'
  },
  {
    symbol: 'R_25',
    name: 'Volatility 25'
  },
  {
    symbol: 'R_50',
    name: 'Volatility 50'
  },
  {
    symbol: 'R_75',
    name: 'Volatility 75'
  },
  {
    symbol: 'R_100',
    name: 'Volatility 100'
  }
];

const REQUIRED_TICKS = 30;

export default function Dashboard() {
  const [marketData, setMarketData] = useState(() => {
    const initial = {};

    SYMBOLS.forEach(({ symbol }) => {
      initial[symbol] = {
        ticks: [],
        prediction: null,
        loading: true,
        error: null,
        connected: false
      };
    });

    return initial;
  });

  const streams = useRef({});
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    console.log('');
    console.log('====================================');
    console.log('🚀 DASHBOARD TICK STREAM STARTING');
    console.log('====================================');
    console.log('');

    SYMBOLS.forEach(({ symbol }) => {
      startStream(symbol);
    });

    return () => {
      mounted.current = false;

      console.log('');
      console.log('🛑 DASHBOARD STOPPING TICK STREAMS');
      console.log('');

      Object.entries(streams.current).forEach(
        ([symbol, source]) => {
          console.log(
            `🔌 Closing SSE stream: ${symbol}`
          );

          try {
            source.close();
          } catch (error) {
            console.error(
              `❌ Error closing ${symbol}:`,
              error
            );
          }
        }
      );

      streams.current = {};
    };
  }, []);

  function startStream(symbol) {
    /*
     * Close an existing stream first.
     */
    if (streams.current[symbol]) {
      try {
        streams.current[symbol].close();
      } catch (_) {}

      delete streams.current[symbol];
    }

    /*
     * DIRECT RENDER SSE ENDPOINT
     *
     * We intentionally connect directly to Render.
     * This avoids Vercel proxying/buffering the SSE stream.
     */
    const url =
      `${BACKEND_URL}/ticks/stream/${symbol}`;

    console.log('');
    console.log(
      '===================================='
    );
    console.log(
      `📡 OPENING SSE: ${symbol}`
    );
    console.log(
      'URL:',
      url
    );
    console.log(
      '===================================='
    );

    let source;

    try {
      source = new EventSource(url);
    } catch (error) {
      console.error(
        `❌ FAILED TO CREATE EVENTSOURCE: ${symbol}`,
        error
      );

      setError(
        symbol,
        'Unable to create tick connection.'
      );

      return;
    }

    streams.current[symbol] = source;

    /*
     * CONNECTION OPEN
     */
    source.onopen = () => {
      console.log(
        `✅ SSE CONNECTED: ${symbol}`
      );

      if (!mounted.current) {
        return;
      }

      setMarketData((previous) => ({
        ...previous,
        [symbol]: {
          ...previous[symbol],
          connected: true,
          loading:
            previous[symbol].ticks.length <
            REQUIRED_TICKS,
          error: null
        }
      }));
    };

    /*
     * INITIAL CONNECTION EVENT
     *
     * Backend sends:
     *
     * event: connected
     *
     * We don't need to process it as a tick,
     * but logging it confirms the SSE channel
     * itself is alive.
     */
    source.addEventListener(
      'connected',
      (event) => {
        console.log(
          `🟢 SSE SERVER CONFIRMED CONNECTION: ${symbol}`,
          event.data
        );
      }
    );

    /*
     * NORMAL SSE MESSAGE
     *
     * Backend sends live ticks using:
     *
     * data: {...}
     *
     * therefore they arrive here.
     */
    source.onmessage = (event) => {
      if (!mounted.current) {
        return;
      }

      try {
        if (!event.data) {
          return;
        }

        console.log(
          `📥 SSE DATA RECEIVED: ${symbol}`,
          event.data
        );

        const tick =
          JSON.parse(event.data);

        console.log(
          `📈 TICK RECEIVED ${symbol}:`,
          tick
        );

        /*
         * Extract the actual Deriv quote.
         */
        const quote = Number(
          tick.quote ??
          tick.price ??
          tick.spot
        );

        if (!Number.isFinite(quote)) {
          console.warn(
            `⚠️ INVALID QUOTE: ${symbol}`,
            tick
          );

          return;
        }

        /*
         * Add the real Deriv quote to the
         * rolling 30-tick window.
         */
        setMarketData((previous) => {
          const current =
            previous[symbol] || {
              ticks: [],
              prediction: null,
              loading: true,
              error: null,
              connected: true
            };

          const oldTicks =
            Array.isArray(current.ticks)
              ? current.ticks
              : [];

          const newTicks = [
            ...oldTicks,
            quote
          ].slice(-REQUIRED_TICKS);

          console.log(
            `📊 ${symbol}: ${newTicks.length}/${REQUIRED_TICKS} TICKS`
          );

          let prediction = null;

          if (
            newTicks.length >=
            REQUIRED_TICKS
          ) {
            prediction =
              makePrediction(
                newTicks,
                symbol
              );

            console.log(
              `🎯 PREDICTION READY: ${symbol}`,
              prediction
            );
          }

          return {
            ...previous,
            [symbol]: {
              ...current,
              ticks: newTicks,
              prediction,
              loading:
                newTicks.length <
                REQUIRED_TICKS,
              error: null,
              connected: true
            }
          };
        });
      } catch (error) {
        console.error(
          `❌ FAILED TO PROCESS SSE TICK: ${symbol}`,
          error
        );
      }
    };

    /*
     * ERROR / AUTOMATIC RECONNECT
     */
    source.onerror = (error) => {
      console.error(
        `❌ SSE ERROR: ${symbol}`,
        error
      );

      /*
       * Important:
       * EventSource automatically attempts to reconnect.
       * We do NOT create another EventSource here.
       */

      if (!mounted.current) {
        return;
      }

      setMarketData((previous) => ({
        ...previous,
        [symbol]: {
          ...previous[symbol],
          connected: false,
          error:
            'Connection interrupted. Reconnecting...',
          loading:
            previous[symbol].ticks.length <
            REQUIRED_TICKS
        }
      }));
    };
  }

  function setError(symbol, message) {
    setMarketData((previous) => ({
      ...previous,
      [symbol]: {
        ...previous[symbol],
        error: message,
        loading: true,
        connected: false
      }
    }));
  }

  function makePrediction(ticks, symbol) {
    try {
      /*
       * These are REAL Deriv ticks.
       *
       * No simulated values are inserted.
       */

      const evenOdd =
        analyzeEvenOdd(ticks);

      const overUnder =
        analyzeOverUnder(ticks);

      const digits =
        extractLastDigits(ticks);

      const digitMatch =
        analyzeDigitMatch(ticks);

      return {
        symbol,
        evenOdd,
        overUnder,
        digits,
        digitMatch,
        lastDigit:
          digits?.length
            ? digits[digits.length - 1]
            : null,
        tickCount: ticks.length
      };
    } catch (error) {
      console.error(
        `❌ PREDICTION ERROR: ${symbol}`,
        error
      );

      return {
        error:
          'Prediction calculation error',
        tickCount: ticks.length
      };
    }
  }

  function renderPrediction(data) {
    if (!data) {
      return null;
    }

    if (data.error) {
      return (
        <div style={styles.error}>
          {data.error}
        </div>
      );
    }

    return (
      <div style={styles.predictionBox}>
        <div style={styles.predictionTitle}>
          🎯 Prediction Ready
        </div>

        {data.lastDigit !== null &&
          data.lastDigit !== undefined && (
            <div style={styles.row}>
              <span>
                Last Digit
              </span>

              <strong>
                {data.lastDigit}
              </strong>
            </div>
          )}

        {data.evenOdd && (
          <div style={styles.row}>
            <span>
              Even / Odd
            </span>

            <strong>
              {formatPrediction(
                data.evenOdd
              )}
            </strong>
          </div>
        )}

        {data.overUnder && (
          <div style={styles.row}>
            <span>
              Over / Under
            </span>

            <strong>
              {formatPrediction(
                data.overUnder
              )}
            </strong>
          </div>
        )}

        {data.digitMatch && (
          <div style={styles.row}>
            <span>
              Digit Match
            </span>

            <strong>
              {formatPrediction(
                data.digitMatch
              )}
            </strong>
          </div>
        )}

        <div style={styles.tickStatus}>
          Using {data.tickCount} live ticks
        </div>
      </div>
    );
  }

  function formatPrediction(value) {
    if (
      value === null ||
      value === undefined
    ) {
      return '—';
    }

    if (
      typeof value === 'string'
    ) {
      return value;
    }

    if (
      typeof value === 'number'
    ) {
      return String(value);
    }

    if (value.prediction) {
      return String(
        value.prediction
      );
    }

    if (value.result) {
      return String(
        value.result
      );
    }

    if (value.direction) {
      return String(
        value.direction
      );
    }

    if (value.label) {
      return String(
        value.label
      );
    }

    return 'Ready';
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>
          Live Predictions
        </h1>

        <div style={styles.subtitle}>
          Real-time Deriv market data
        </div>
      </div>

      <div style={styles.grid}>
        {SYMBOLS.map(
          ({ symbol, name }) => {
            const data =
              marketData[symbol] || {
                ticks: [],
                prediction: null,
                loading: true,
                error: null,
                connected: false
              };

            const count =
              data.ticks.length;

            const ready =
              count >=
              REQUIRED_TICKS;

            return (
              <div
                key={symbol}
                style={styles.card}
              >
                <div
                  style={
                    styles.cardHeader
                  }
                >
                  <h2
                    style={
                      styles.name
                    }
                  >
                    {name}
                  </h2>

                  <div
                    style={{
                      ...styles.status,
                      ...(data.connected
                        ? styles.statusConnected
                        : styles.statusDisconnected)
                    }}
                  >
                    <span>
                      ●
                    </span>

                    {data.connected
                      ? ' LIVE'
                      : ' CONNECTING'}
                  </div>
                </div>

                {data.error && (
                  <div
                    style={
                      styles.error
                    }
                  >
                    {data.error}
                  </div>
                )}

                {!ready && (
                  <div
                    style={
                      styles.collecting
                    }
                  >
                    <div>
                      Collecting live
                      data...
                    </div>

                    <div
                      style={
                        styles.tickCount
                      }
                    >
                      {count}/
                      {REQUIRED_TICKS}
                      {' '}
                      ticks
                    </div>

                    <div
                      style={
                        styles.progressBackground
                      }
                    >
                      <div
                        style={{
                          ...styles.progress,
                          width: `${Math.min(
                            100,
                            (count /
                              REQUIRED_TICKS) *
                              100
                          )}%`
                        }}
                      />
                    </div>
                  </div>
                )}

                {ready &&
                  renderPrediction(
                    data.prediction
                  )}
              </div>
            );
          }
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background:
      'linear-gradient(135deg, #05070d, #101722)',
    color: '#ffffff',
    padding:
      '50px 28px'
  },

  header: {
    textAlign: 'center',
    marginBottom:
      '55px'
  },

  title: {
    fontSize: '48px',
    fontWeight: '800',
    margin: 0
  },

  subtitle: {
    marginTop: '10px',
    color: '#aeb4c2',
    fontSize: '18px'
  },

  grid: {
    maxWidth: '900px',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '28px'
  },

  card: {
    background:
      'rgba(35, 38, 45, 0.88)',
    border:
      '1px solid rgba(255,255,255,0.25)',
    borderRadius: '25px',
    padding: '32px',
    minHeight: '200px',
    boxShadow:
      '0 10px 35px rgba(0,0,0,0.3)'
  },

  cardHeader: {
    display: 'flex',
    justifyContent:
      'space-between',
    alignItems: 'flex-start',
    gap: '15px',
    marginBottom: '25px'
  },

  name: {
    color: '#8fc1ff',
    fontSize: '27px',
    margin: 0
  },

  status: {
    fontSize: '13px',
    fontWeight: '700',
    whiteSpace: 'nowrap'
  },

  statusConnected: {
    color: '#5cff9d'
  },

  statusDisconnected: {
    color: '#ffb36b'
  },

  collecting: {
    color: '#aeb4c2',
    fontSize: '20px'
  },

  tickCount: {
    marginTop: '10px',
    color: '#ffffff',
    fontWeight: '700'
  },

  progressBackground: {
    height: '8px',
    background:
      'rgba(255,255,255,0.1)',
    borderRadius: '10px',
    marginTop: '15px',
    overflow: 'hidden'
  },

  progress: {
    height: '100%',
    background:
      '#5cff9d',
    borderRadius: '10px',
    transition:
      'width 0.25s ease'
  },

  predictionBox: {
    marginTop: '10px',
    padding: '20px',
    borderRadius: '16px',
    background:
      'rgba(0,0,0,0.25)'
  },

  predictionTitle: {
    fontSize: '21px',
    fontWeight: '700',
    marginBottom: '15px'
  },

  row: {
    display: 'flex',
    justifyContent:
      'space-between',
    gap: '20px',
    padding: '9px 0',
    borderBottom:
      '1px solid rgba(255,255,255,0.1)'
  },

  tickStatus: {
    marginTop: '15px',
    color: '#8fc1ff',
    fontSize: '14px'
  },

  error: {
    color: '#ff8d8d',
    fontSize: '16px',
    marginTop: '10px'
  }
};
