import { useEffect, useRef, useState } from 'react';

import {
  analyzeEvenOdd,
  analyzeOverUnder,
  analyzeDigitMatch
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

/*
 * Extract the final digit from each quote.
 */
function extractLastDigits(ticks) {
  return ticks.map((quote) => {
    const number = Number(quote);

    if (!Number.isFinite(number)) {
      return null;
    }

    const text = String(number);

    if (text.includes('.')) {
      const decimalPart = text.split('.')[1];

      if (decimalPart && decimalPart.length > 0) {
        return Number(
          decimalPart[decimalPart.length - 1]
        );
      }
    }

    return Math.abs(Math.trunc(number)) % 10;
  });
}

export default function Dashboard() {
  const [marketData, setMarketData] = useState(() => {
    const initial = {};

    SYMBOLS.forEach(({ symbol }) => {
      initial[symbol] = {
        ticks: [],
        prediction: null,
        loading: true,
        connected: false,
        error: null
      };
    });

    return initial;
  });

  const streams = useRef({});
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    console.log('====================================');
    console.log('🚀 DASHBOARD TICK STREAM STARTING');
    console.log('====================================');

    SYMBOLS.forEach(({ symbol }) => {
      startStream(symbol);
    });

    return () => {
      mounted.current = false;

      console.log('🛑 DASHBOARD STOPPING TICK STREAMS');

      Object.values(streams.current).forEach(
        (source) => {
          try {
            source.close();
          } catch (error) {
            console.error(
              'Stream close error:',
              error
            );
          }
        }
      );

      streams.current = {};
    };
  }, []);

  function startStream(symbol) {
    if (!mounted.current) return;

    if (streams.current[symbol]) {
      try {
        streams.current[symbol].close();
      } catch (_) {}
    }

    const url =
      `${BACKEND_URL}/ticks/stream/${symbol}`;

    console.log(
      `📡 Connecting to ${symbol}:`,
      url
    );

    const source = new EventSource(url);

    streams.current[symbol] = source;

    /*
     * SSE connection opened.
     */
    source.onopen = () => {
      console.log(
        `✅ SSE CONNECTED: ${symbol}`
      );

      if (!mounted.current) return;

      setMarketData((previous) => ({
        ...previous,
        [symbol]: {
          ...previous[symbol],
          connected: true,
          loading: true,
          error: null
        }
      }));
    };

    /*
     * Backend sends:
     *
     * event: connected
     * data: {"symbol":"R_10","status":"connected"}
     */
    source.addEventListener(
      'connected',
      (event) => {
        console.log(
          `🔗 SSE CONNECTED EVENT: ${symbol}`,
          event.data
        );

        if (!mounted.current) return;

        setMarketData((previous) => ({
          ...previous,
          [symbol]: {
            ...previous[symbol],
            connected: true,
            error: null
          }
        }));
      }
    );

    /*
     * Normal SSE tick messages.
     */
    source.onmessage = (event) => {
      try {
        console.log(
          `📥 SSE DATA RECEIVED ${symbol}:`,
          event.data
        );

        const tick = JSON.parse(event.data);

        console.log(
          `📈 TICK RECEIVED ${symbol}:`,
          tick
        );

        const quote = Number(
          tick.quote ??
          tick.price ??
          tick.spot
        );

        if (!Number.isFinite(quote)) {
          console.warn(
            `⚠️ Invalid quote for ${symbol}:`,
            tick
          );

          return;
        }

        if (!mounted.current) return;

        setMarketData((previous) => {
          const oldTicks =
            previous[symbol]?.ticks || [];

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
            prediction = makePrediction(
              newTicks,
              symbol
            );
          }

          return {
            ...previous,

            [symbol]: {
              ...previous[symbol],

              ticks: newTicks,

              prediction,

              loading:
                newTicks.length <
                REQUIRED_TICKS,

              connected: true,

              error: null
            }
          };
        });
      } catch (error) {
        console.error(
          `❌ Failed to process ${symbol} tick:`,
          error
        );
      }
    };

    /*
     * SSE connection error.
     *
     * EventSource automatically attempts
     * to reconnect.
     */
    source.onerror = (error) => {
      console.error(
        `❌ SSE ERROR: ${symbol}`,
        error
      );

      if (!mounted.current) return;

      setMarketData((previous) => ({
        ...previous,

        [symbol]: {
          ...previous[symbol],

          connected: false,

          loading: true,

          error:
            'Connection lost. Reconnecting...'
        }
      }));
    };
  }

  function makePrediction(ticks, symbol) {
    try {
      const evenOdd =
        analyzeEvenOdd(ticks);

      const overUnder =
        analyzeOverUnder(ticks);

      const digits =
        extractLastDigits(ticks);

      const digitMatch =
        analyzeDigitMatch(ticks);

      const validDigits =
        digits.filter(
          (digit) =>
            digit !== null &&
            Number.isFinite(digit)
        );

      return {
        symbol,

        evenOdd,

        overUnder,

        digits,

        digitMatch,

        lastDigit:
          validDigits.length > 0
            ? validDigits[
                validDigits.length - 1
              ]
            : null,

        tickCount: ticks.length
      };
    } catch (error) {
      console.error(
        `❌ Prediction error for ${symbol}:`,
        error
      );

      return {
        error:
          'Prediction calculation error',

        tickCount: ticks.length
      };
    }
  }

  function formatPrediction(value) {
    if (
      value === null ||
      value === undefined
    ) {
      return '—';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (value.prediction !== undefined) {
      return String(value.prediction);
    }

    if (value.result !== undefined) {
      return String(value.result);
    }

    if (value.direction !== undefined) {
      return String(value.direction);
    }

    if (value.label !== undefined) {
      return String(value.label);
    }

    return 'Ready';
  }

  function renderPrediction(data) {
    if (!data) return null;

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
          Prediction Ready
        </div>

        {data.lastDigit !== null &&
          data.lastDigit !== undefined && (
            <div style={styles.row}>
              <span>Last Digit</span>

              <strong>
                {data.lastDigit}
              </strong>
            </div>
          )}

        {data.evenOdd && (
          <div style={styles.row}>
            <span>Even / Odd</span>

            <strong>
              {formatPrediction(
                data.evenOdd
              )}
            </strong>
          </div>
        )}

        {data.overUnder && (
          <div style={styles.row}>
            <span>Over / Under</span>

            <strong>
              {formatPrediction(
                data.overUnder
              )}
            </strong>
          </div>
        )}

        {data.digitMatch && (
          <div style={styles.row}>
            <span>Digit Match</span>

            <strong>
              {formatPrediction(
                data.digitMatch
              )}
            </strong>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>
          Live Predictions
        </h1>

        <p style={styles.subtitle}>
          Real-time Deriv market analysis
        </p>
      </div>

      <div style={styles.grid}>
        {SYMBOLS.map(
          ({ symbol, name }) => {
            const data =
              marketData[symbol] || {
                ticks: [],
                loading: true,
                connected: false,
                error: null
              };

            const count =
              data.ticks.length;

            const ready =
              count >= REQUIRED_TICKS;

            const progress =
              Math.min(
                (count /
                  REQUIRED_TICKS) *
                  100,
                100
              );

            return (
              <div
                key={symbol}
                style={styles.card}
              >
                <div
                  style={styles.cardHeader}
                >
                  <h2
                    style={styles.name}
                  >
                    {name}
                  </h2>

                  <div
                    style={{
                      ...styles.status,
                      ...(data.connected
                        ? styles.live
                        : styles.connecting)
                    }}
                  >
                    <span
                      style={
                        styles.statusDot
                      }
                    />

                    {data.connected
                      ? 'LIVE'
                      : 'CONNECTING'}
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
                        styles.progressText
                      }
                    >
                      {count}/
                      {REQUIRED_TICKS}{' '}
                      ticks
                    </div>

                    <div
                      style={
                        styles.progressBackground
                      }
                    >
                      <div
                        style={{
                          ...styles.progressBar,
                          width: `${progress}%`
                        }}
                      />
                    </div>

                    <div
                      style={
                        styles.waiting
                      }
                    >
                      Prediction will
                      appear after{' '}
                      {REQUIRED_TICKS}{' '}
                      live ticks.
                    </div>
                  </div>
                )}

                {ready &&
                  renderPrediction(
                    data.prediction
                  )}

                <div
                  style={
                    styles.tickInfo
                  }
                >
                  Live ticks: {count}
                </div>
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
      '40px 20px 60px',
    boxSizing: 'border-box'
  },

  header: {
    textAlign: 'center',
    marginBottom: '40px'
  },

  title: {
    fontSize:
      'clamp(32px, 8vw, 48px)',
    fontWeight: '800',
    margin: 0
  },

  subtitle: {
    color: '#9da7b8',
    fontSize: '17px',
    marginTop: '10px'
  },

  grid: {
    maxWidth: '1000px',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '24px'
  },

  card: {
    background:
      'rgba(35, 38, 45, 0.9)',
    border:
      '1px solid rgba(255,255,255,0.18)',
    borderRadius: '22px',
    padding: '26px',
    minHeight: '220px',
    boxShadow:
      '0 10px 35px rgba(0,0,0,0.3)',
    boxSizing: 'border-box'
  },

  cardHeader: {
    display: 'flex',
    justifyContent:
      'space-between',
    alignItems: 'center',
    gap: '15px',
    marginBottom: '25px'
  },

  name: {
    color: '#8fc1ff',
    fontSize: '24px',
    margin: 0
  },

  status: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    fontSize: '12px',
    fontWeight: '800',
    letterSpacing: '0.5px',
    whiteSpace: 'nowrap'
  },

  live: {
    color: '#70e090'
  },

  connecting: {
    color: '#ffd166'
  },

  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background:
      'currentColor',
    display: 'inline-block'
  },

  collecting: {
    color: '#c1c7d0',
    fontSize: '18px'
  },

  progressText: {
    marginTop: '10px',
    color: '#ffffff',
    fontWeight: '700'
  },

  progressBackground: {
    height: '8px',
    width: '100%',
    background:
      'rgba(255,255,255,0.12)',
    borderRadius: '20px',
    overflow: 'hidden',
    marginTop: '12px'
  },

  progressBar: {
    height: '100%',
    background:
      'linear-gradient(90deg, #4da3ff, #70e090)',
    borderRadius: '20px',
    transition:
      'width 0.25s ease'
  },

  waiting: {
    color: '#8f98a8',
    fontSize: '13px',
    marginTop: '12px',
    lineHeight: '1.5'
  },

  predictionBox: {
    marginTop: '10px',
    padding: '20px',
    borderRadius: '16px',
    background:
      'rgba(0,0,0,0.25)',
    border:
      '1px solid rgba(255,255,255,0.08)'
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
    alignItems: 'center',
    gap: '20px',
    padding: '10px 0',
    borderBottom:
      '1px solid rgba(255,255,255,0.1)'
  },

  error: {
    color: '#ff8d8d',
    fontSize: '15px',
    marginTop: '10px',
    marginBottom: '10px'
  },

  tickInfo: {
    marginTop: '18px',
    color: '#7f8999',
    fontSize: '13px',
    textAlign: 'right'
  }
};
