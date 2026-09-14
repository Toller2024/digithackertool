import { useEffect, useRef, useState } from 'react';

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
        result: null,
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
    console.log('🚀 DASHBOARD ADAPTIVE LEARNING START');
    console.log('====================================');

    SYMBOLS.forEach(({ symbol }) => {
      startStream(symbol);
    });

    return () => {
      mounted.current = false;

      console.log(
        '🛑 DASHBOARD STOPPING TICK STREAMS'
      );

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

  /*
   * ==========================================
   * START SSE STREAM
   * ==========================================
   */
  function startStream(symbol) {
    if (!mounted.current) {
      return;
    }

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

    const source =
      new EventSource(url);

    streams.current[symbol] = source;

    /*
     * ========================================
     * CONNECTION OPEN
     * ========================================
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

          error: null
        }
      }));
    };

    /*
     * ========================================
     * CONNECTED EVENT
     * ========================================
     */
    source.addEventListener(
      'connected',
      (event) => {
        console.log(
          `🔗 CONNECTED EVENT ${symbol}:`,
          event.data
        );

        if (!mounted.current) {
          return;
        }

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
     * ========================================
     * LIVE TICK EVENT
     * ========================================
     *
     * Backend sends:
     *
     * event: message
     * data: {...}
     */
    source.addEventListener(
      'message',
      (event) => {
        try {
          const tick =
            JSON.parse(event.data);

          console.log(
            `📥 TICK RECEIVED ${symbol}:`,
            tick
          );

          const quote =
            Number(
              tick.quote ??
              tick.price ??
              tick.spot
            );

          if (
            !Number.isFinite(quote)
          ) {
            console.warn(
              `⚠️ Invalid quote ${symbol}:`,
              tick
            );

            return;
          }

          if (!mounted.current) {
            return;
          }

          setMarketData((previous) => {
            const oldTicks =
              previous[symbol]?.ticks ||
              [];

            const newTicks = [
              ...oldTicks,
              quote
            ].slice(
              -REQUIRED_TICKS
            );

            console.log(
              `📊 ${symbol}: ${newTicks.length}/${REQUIRED_TICKS} TICKS`
            );

            return {
              ...previous,

              [symbol]: {
                ...previous[symbol],

                ticks: newTicks,

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
      }
    );

    /*
     * ========================================
     * ADAPTIVE PREDICTION EVENT
     * ========================================
     *
     * This comes directly from:
     *
     * PredictionEngine
     *      ↓
     * LearningService
     *      ↓
     * ticks.js
     *      ↓
     * Dashboard
     */
    source.addEventListener(
      'prediction',
      (event) => {
        try {
          console.log(
            `🎯 ADAPTIVE PREDICTION RECEIVED ${symbol}:`,
            event.data
          );

          const data =
            JSON.parse(event.data);

          const prediction =
            data.prediction;

          if (!prediction) {
            return;
          }

          if (!mounted.current) {
            return;
          }

          setMarketData((previous) => ({
            ...previous,

            [symbol]: {
              ...previous[symbol],

              prediction,

              connected: true,

              error: null
            }
          }));
        } catch (error) {
          console.error(
            `❌ Prediction event error ${symbol}:`,
            error
          );
        }
      }
    );

    /*
     * ========================================
     * WIN / LOSS RESULT EVENT
     * ========================================
     */
    source.addEventListener(
      'result',
      (event) => {
        try {
          console.log(
            `📈 LEARNING RESULT RECEIVED ${symbol}:`,
            event.data
          );

          const data =
            JSON.parse(event.data);

          const result =
            data.result;

          if (!result) {
            return;
          }

          if (!mounted.current) {
            return;
          }

          setMarketData((previous) => ({
            ...previous,

            [symbol]: {
              ...previous[symbol],

              result,

              connected: true,

              error: null
            }
          }));
        } catch (error) {
          console.error(
            `❌ Result event error ${symbol}:`,
            error
          );
        }
      }
    );

    /*
     * ========================================
     * SSE ERROR
     * ========================================
     */
    source.onerror = (error) => {
      console.error(
        `❌ SSE ERROR: ${symbol}`,
        error
      );

      if (!mounted.current) {
        return;
      }

      setMarketData((previous) => ({
        ...previous,

        [symbol]: {
          ...previous[symbol],

          connected: false,

          error:
            'Connection lost. Reconnecting...'
        }
      }));
    };
  }

  /*
   * ==========================================
   * FORMAT PERCENTAGE
   * ==========================================
   */
  function formatProbability(prediction) {
    if (!prediction) {
      return '—';
    }

    if (
      Number.isFinite(
        prediction.probabilityPercent
      )
    ) {
      return `${prediction.probabilityPercent}%`;
    }

    if (
      Number.isFinite(
        prediction.probability
      )
    ) {
      return `${(
        prediction.probability * 100
      ).toFixed(2)}%`;
    }

    return '—';
  }

  /*
   * ==========================================
   * SIGNAL STYLE
   * ==========================================
   */
  function getSignalStyle(signal) {
    if (signal === 'ENTRY') {
      return styles.entry;
    }

    if (signal === 'WAIT') {
      return styles.wait;
    }

    if (signal === 'NO_ENTRY') {
      return styles.noEntry;
    }

    return styles.wait;
  }

  /*
   * ==========================================
   * RENDER ADAPTIVE PREDICTION
   * ==========================================
   */
  function renderPrediction(data) {
    const prediction =
      data?.prediction;

    if (!prediction) {
      return (
        <div style={styles.waitingPrediction}>
          Waiting for adaptive prediction...
        </div>
      );
    }

    const signal =
      prediction.signal ||
      'WAIT';

    const result =
      data.result;

    return (
      <div style={styles.predictionBox}>

        <div style={styles.predictionHeader}>
          <div style={styles.predictionTitle}>
            Adaptive Prediction
          </div>

          <div
            style={{
              ...styles.signal,
              ...getSignalStyle(signal)
            }}
          >
            {signal.replace(
              '_',
              ' '
            )}
          </div>
        </div>

        <div style={styles.mainPrediction}>
          <div style={styles.digitLabel}>
            NEXT DIGIT
          </div>

          <div style={styles.predictedDigit}>
            {prediction.predictedDigit ??
              '—'}
          </div>
        </div>

        <div style={styles.row}>
          <span>Probability</span>

          <strong>
            {formatProbability(
              prediction
            )}
          </strong>
        </div>

        <div style={styles.row}>
          <span>Historical Ticks</span>

          <strong>
            {prediction.historySize ??
              '—'}
          </strong>
        </div>

        <div style={styles.row}>
          <span>Current Digit</span>

          <strong>
            {prediction.currentDigit ??
              '—'}
          </strong>
        </div>

        <div style={styles.row}>
          <span>Pattern</span>

          <strong>
            {Array.isArray(
              prediction.pattern
            )
              ? prediction.pattern.join(
                  ' → '
                )
              : '—'}
          </strong>
        </div>

        <div style={styles.row}>
          <span>Transition Samples</span>

          <strong>
            {prediction.transitionSamples ??
              '—'}
          </strong>
        </div>

        <div style={styles.row}>
          <span>Strategy</span>

          <strong style={styles.strategy}>
            {prediction.strategy ||
              'Adaptive Learning'}
          </strong>
        </div>

        {result && (
          <div
            style={{
              ...styles.resultBox,

              ...(result.result === 'WIN'
                ? styles.win
                : styles.loss)
            }}
          >
            <div style={styles.resultTitle}>
              {result.result === 'WIN'
                ? '✅ WIN'
                : '❌ LOSS'}
            </div>

            <div style={styles.resultDetails}>
              Predicted:{' '}
              <strong>
                {result.predictedDigit}
              </strong>

              {'   '}

              Actual:{' '}
              <strong>
                {result.actualDigit}
              </strong>
            </div>
          </div>
        )}
      </div>
    );
  }

  /*
   * ==========================================
   * DASHBOARD
   * ==========================================
   */
  return (
    <div style={styles.page}>

      <div style={styles.header}>
        <h1 style={styles.title}>
          Live Predictions
        </h1>

        <p style={styles.subtitle}>
          Adaptive historical-learning
          engine
        </p>
      </div>

      <div style={styles.learningBanner}>
        🧠 Predictions are generated from
        historical tick learning and live
        results.
      </div>

      <div style={styles.grid}>
        {SYMBOLS.map(
          ({
            symbol,
            name
          }) => {
            const data =
              marketData[symbol] || {
                ticks: [],
                prediction: null,
                result: null,
                loading: true,
                connected: false,
                error: null
              };

            const count =
              data.ticks.length;

            const ready =
              count >=
              REQUIRED_TICKS;

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
                  style={
                    styles.cardHeader
                  }
                >
                  <div>
                    <h2
                      style={
                        styles.name
                      }
                    >
                      {name}
                    </h2>

                    <div
                      style={
                        styles.symbol
                      }
                    >
                      {symbol}
                    </div>
                  </div>

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
                      ticks...
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

                          width:
                            `${progress}%`
                        }}
                      />
                    </div>

                    <div
                      style={
                        styles.waiting
                      }
                    >
                      Live display becomes
                      ready after{' '}
                      {REQUIRED_TICKS}{' '}
                      ticks.
                    </div>
                  </div>
                )}

                {ready &&
                  renderPrediction(
                    data
                  )}

                {!data.prediction &&
                  ready && (
                    <div
                      style={
                        styles.learningStatus
                      }
                    >
                      🧠 Learning engine is
                      processing historical
                      data...
                    </div>
                  )}

                <div
                  style={
                    styles.tickInfo
                  }
                >
                  Live ticks:{' '}
                  {count}/
                  {REQUIRED_TICKS}
                </div>

              </div>
            );
          }
        )}
      </div>
    </div>
  );
}

/*
 * ==========================================
 * STYLES
 * ==========================================
 */
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

    marginBottom: '20px'
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

  learningBanner: {
    maxWidth: '1000px',

    margin:
      '0 auto 35px',

    padding: '14px 18px',

    borderRadius: '12px',

    background:
      'rgba(77,163,255,0.08)',

    border:
      '1px solid rgba(77,163,255,0.2)',

    color: '#a9cfff',

    textAlign: 'center',

    fontSize: '14px'
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

    minHeight: '300px',

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

  symbol: {
    color: '#687386',

    fontSize: '12px',

    marginTop: '4px',

    fontWeight: '600'
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

  predictionHeader: {
    display: 'flex',

    justifyContent:
      'space-between',

    alignItems: 'center',

    gap: '10px',

    marginBottom: '15px'
  },

  predictionTitle: {
    fontSize: '19px',

    fontWeight: '700'
  },

  signal: {
    padding:
      '7px 11px',

    borderRadius: '8px',

    fontSize: '11px',

    fontWeight: '900',

    letterSpacing: '0.5px'
  },

  entry: {
    background:
      'rgba(60,200,100,0.15)',

    color: '#70e090',

    border:
      '1px solid rgba(60,200,100,0.3)'
  },

  wait: {
    background:
      'rgba(255,209,102,0.12)',

    color: '#ffd166',

    border:
      '1px solid rgba(255,209,102,0.25)'
  },

  noEntry: {
    background:
      'rgba(255,100,100,0.12)',

    color: '#ff8d8d',

    border:
      '1px solid rgba(255,100,100,0.25)'
  },

  mainPrediction: {
    textAlign: 'center',

    padding:
      '10px 0 20px'
  },

  digitLabel: {
    color: '#7f8999',

    fontSize: '11px',

    fontWeight: '800',

    letterSpacing: '1px'
  },

  predictedDigit: {
    fontSize: '64px',

    lineHeight: '1',

    fontWeight: '900',

    marginTop: '8px',

    color: '#ffffff'
  },

  row: {
    display: 'flex',

    justifyContent:
      'space-between',

    alignItems: 'center',

    gap: '15px',

    padding: '9px 0',

    borderBottom:
      '1px solid rgba(255,255,255,0.08)',

    fontSize: '13px',

    color: '#aeb6c4'
  },

  strategy: {
    color: '#8fc1ff',

    fontSize: '11px',

    textAlign: 'right'
  },

  resultBox: {
    marginTop: '16px',

    padding: '12px',

    borderRadius: '10px',

    textAlign: 'center'
  },

  win: {
    background:
      'rgba(60,200,100,0.12)',

    border:
      '1px solid rgba(60,200,100,0.3)',

    color: '#70e090'
  },

  loss: {
    background:
      'rgba(255,100,100,0.12)',

    border:
      '1px solid rgba(255,100,100,0.3)',

    color: '#ff8d8d'
  },

  resultTitle: {
    fontSize: '16px',

    fontWeight: '900'
  },

  resultDetails: {
    fontSize: '12px',

    marginTop: '5px'
  },

  waitingPrediction: {
    padding: '25px 10px',

    textAlign: 'center',

    color: '#8f98a8',

    fontSize: '14px'
  },

  learningStatus: {
    marginTop: '15px',

    padding: '12px',

    borderRadius: '10px',

    background:
      'rgba(77,163,255,0.08)',

    color: '#8fc1ff',

    fontSize: '13px',

    textAlign: 'center'
  },

  error: {
    color: '#ff8d8d',

    fontSize: '14px',

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
