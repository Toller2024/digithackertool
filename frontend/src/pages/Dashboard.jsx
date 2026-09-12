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
        error: null
      };
    });

    return initial;
  });

  const streams = useRef({});

  useEffect(() => {
    console.log('====================================');
    console.log('🚀 DASHBOARD TICK STREAM STARTING');
    console.log('====================================');

    SYMBOLS.forEach(({ symbol }) => {
      startStream(symbol);
    });

    return () => {
      console.log('🛑 DASHBOARD STOPPING TICK STREAMS');

      Object.values(streams.current).forEach((source) => {
        try {
          source.close();
        } catch (error) {
          console.error('Stream close error:', error);
        }
      });

      streams.current = {};
    };
  }, []);

  function startStream(symbol) {
    if (streams.current[symbol]) {
      streams.current[symbol].close();
    }

    const url =
      `${BACKEND_URL}/ticks/stream/${symbol}`;

    console.log(`📡 Connecting to ${symbol}:`, url);

    const source = new EventSource(url);

    streams.current[symbol] = source;

    source.onopen = () => {
      console.log(
        `✅ SSE CONNECTED: ${symbol}`
      );

      setMarketData((previous) => ({
        ...previous,
        [symbol]: {
          ...previous[symbol],
          loading: true,
          error: null
        }
      }));
    };

    source.onmessage = (event) => {
      try {
        const tick = JSON.parse(event.data);

        console.log(
          `📈 TICK RECEIVED ${symbol}:`,
          tick
        );

        const quote =
          Number(
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

        setMarketData((previous) => {
          const oldTicks =
            previous[symbol]?.ticks || [];

          const newTicks = [
            ...oldTicks,
            quote
          ].slice(-REQUIRED_TICKS);

          let prediction = null;

          if (
            newTicks.length >= REQUIRED_TICKS
          ) {
            prediction =
              makePrediction(
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

    source.onerror = (error) => {
      console.error(
        `❌ SSE ERROR: ${symbol}`,
        error
      );

      setMarketData((previous) => ({
        ...previous,
        [symbol]: {
          ...previous[symbol],
          error:
            'Connection lost. Reconnecting...',
          loading: true
        }
      }));

      /*
       * EventSource automatically reconnects.
       * We don't manually create another connection
       * here because that can create duplicate streams.
       */
    };
  }

  function makePrediction(ticks, symbol) {
    try {
      /*
       * Keep the existing prediction engine.
       * We feed it the REAL ticks received from
       * the Deriv backend.
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
        `Prediction error for ${symbol}:`,
        error
      );

      return {
        error: 'Prediction calculation error',
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
          Prediction Ready
        </div>

        {data.lastDigit !== null && (
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
              {formatPrediction(data.evenOdd)}
            </strong>
          </div>
        )}

        {data.overUnder && (
          <div style={styles.row}>
            <span>Over / Under</span>
            <strong>
              {formatPrediction(data.overUnder)}
            </strong>
          </div>
        )}

        {data.digitMatch && (
          <div style={styles.row}>
            <span>Digit Match</span>
            <strong>
              {formatPrediction(data.digitMatch)}
            </strong>
          </div>
        )}

      </div>
    );
  }

  function formatPrediction(value) {
    if (value === null || value === undefined) {
      return '—';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (value.prediction) {
      return String(value.prediction);
    }

    if (value.result) {
      return String(value.result);
    }

    if (value.direction) {
      return String(value.direction);
    }

    if (value.label) {
      return String(value.label);
    }

    return 'Ready';
  }

  return (
    <div style={styles.page}>

      <div style={styles.header}>
        <h1 style={styles.title}>
          Live Predictions
        </h1>
      </div>

      <div style={styles.grid}>

        {SYMBOLS.map(
          ({ symbol, name }) => {
            const data =
              marketData[symbol] || {
                ticks: [],
                loading: true
              };

            const count =
              data.ticks.length;

            const ready =
              count >= REQUIRED_TICKS;

            return (
              <div
                key={symbol}
                style={styles.card}
              >

                <h2 style={styles.name}>
                  {name}
                </h2>

                {data.error && (
                  <div style={styles.error}>
                    {data.error}
                  </div>
                )}

                {!ready && (
                  <div style={styles.collecting}>
                    Collecting data...
                    {' '}
                    ({count}/{REQUIRED_TICKS} ticks)
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
    padding: '50px 28px'
  },

  header: {
    textAlign: 'center',
    marginBottom: '55px'
  },

  title: {
    fontSize: '48px',
    fontWeight: '800',
    margin: 0
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
    minHeight: '180px',
    boxShadow:
      '0 10px 35px rgba(0,0,0,0.3)'
  },

  name: {
    color: '#8fc1ff',
    fontSize: '27px',
    marginTop: 0,
    marginBottom: '30px'
  },

  collecting: {
    color: '#aeb4c2',
    fontSize: '20px'
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
    justifyContent: 'space-between',
    gap: '20px',
    padding: '9px 0',
    borderBottom:
      '1px solid rgba(255,255,255,0.1)'
  },

  error: {
    color: '#ff8d8d',
    fontSize: '16px',
    marginTop: '10px'
  }
};
