import React, { useEffect, useMemo, useState } from 'react';
import {
  analyzeEvenOdd,
  analyzeOverUnder,
  analyzeDigitMatch,
} from '../utils/predictions';

const SYMBOLS = [
  { symbol: 'R_10', name: 'Volatility 10' },
  { symbol: 'R_25', name: 'Volatility 25' },
  { symbol: 'R_50', name: 'Volatility 50' },
  { symbol: 'R_75', name: 'Volatility 75' },
  { symbol: 'R_100', name: 'Volatility 100' },
];

const MAX_TICKS = 150;

function getLastDigit(value) {
  if (value === null || value === undefined) return null;

  let price = value;

  if (typeof value === 'object') {
    price =
      value?.quote ??
      value?.price ??
      value?.value ??
      value?.tick?.quote ??
      value?.data?.tick?.quote;
  }

  if (price === null || price === undefined) return null;

  const text = String(price);

  const decimalPart = text.includes('.')
    ? text.split('.')[1]
    : '';

  if (decimalPart.length > 0) {
    const digits = decimalPart.replace(/\D/g, '');
    if (digits.length > 0) {
      return Number(digits[digits.length - 1]);
    }
  }

  const digits = text.replace(/\D/g, '');

  if (!digits.length) return null;

  return Number(digits[digits.length - 1]);
}

function getTickValue(data) {
  if (!data) return null;

  if (data.tick) {
    if (typeof data.tick === 'object') {
      return (
        data.tick.quote ??
        data.tick.price ??
        data.tick.value ??
        null
      );
    }

    return data.tick;
  }

  if (data.data?.tick) {
    return (
      data.data.tick.quote ??
      data.data.tick.price ??
      data.data.tick.value ??
      null
    );
  }

  return data.quote ?? data.price ?? data.value ?? null;
}

function normalisePrediction(result, defaultType) {
  if (!result) {
    return {
      type: defaultType,
      prediction: null,
      confidence: 0,
    };
  }

  let prediction =
    result.prediction ??
    result.predictedDigit ??
    result.digit ??
    result.signal ??
    result.direction ??
    result.result ??
    null;

  let confidence =
    result.confidence ??
    result.probability ??
    result.accuracy ??
    result.score ??
    0;

  confidence = Number(confidence);

  if (confidence > 0 && confidence <= 1) {
    confidence *= 100;
  }

  if (!Number.isFinite(confidence)) {
    confidence = 0;
  }

  confidence = Math.max(
    0,
    Math.min(100, confidence)
  );

  return {
    type: result.type ?? defaultType,
    prediction,
    confidence,
  };
}

function PredictionCard({
  title,
  subtitle,
  prediction,
  confidence,
  digits,
  connected,
}) {
  const displayPrediction =
    prediction === null ||
    prediction === undefined ||
    prediction === ''
      ? 'ANALYZING'
      : prediction;

  return (
    <div style={styles.card}>

      <div style={styles.cardHeader}>
        <div>
          <div style={styles.cardTitle}>
            {title}
          </div>

          <div style={styles.cardSubtitle}>
            {subtitle}
          </div>
        </div>

        <div
          style={{
            ...styles.liveBadge,
            color: connected
              ? '#00e6a0'
              : '#68747f',
            borderColor: connected
              ? 'rgba(0,230,160,.25)'
              : '#273039',
          }}
        >
          <span
            style={{
              ...styles.liveDot,
              background: connected
                ? '#00e6a0'
                : '#56616b',
              boxShadow: connected
                ? '0 0 9px #00e6a0'
                : 'none',
            }}
          />

          {connected ? 'LIVE' : 'OFFLINE'}
        </div>
      </div>

      <div style={styles.predictionBox}>

        <div style={styles.smallLabel}>
          PREDICTION
        </div>

        <div style={styles.prediction}>
          {displayPrediction}
        </div>

        <div style={styles.confidenceRow}>
          <span>Confidence</span>

          <strong>
            {confidence > 0
              ? `${confidence.toFixed(0)}%`
              : 'ANALYZING'}
          </strong>
        </div>

        <div style={styles.progressBackground}>
          <div
            style={{
              ...styles.progress,
              width: `${confidence}%`,
            }}
          />
        </div>

      </div>

      <div style={styles.recentTitle}>
        RECENT DIGITS
      </div>

      <div style={styles.digitsContainer}>
        {digits.length === 0 ? (
          <span style={styles.waiting}>
            Waiting for live ticks...
          </span>
        ) : (
          digits.slice(-20).map((digit, index, array) => (
            <div
              key={`${index}-${digit}`}
              style={{
                ...styles.digit,
                ...(index === array.length - 1
                  ? styles.latestDigit
                  : {}),
              }}
            >
              {digit}
            </div>
          ))
        )}
      </div>

      <div style={styles.executionRow}>
        <div style={styles.executionText}>
          <span style={styles.executionDot} />
          LIVE EXECUTION WINDOW
        </div>

        <button
          type="button"
          style={styles.tradeButton}
          disabled
          title="Trading will be connected after prediction testing"
        >
          TRADE
        </button>
      </div>

    </div>
  );
}

export default function Dashboard() {
  const [selectedSymbol, setSelectedSymbol] =
    useState('R_10');

  const [ticks, setTicks] = useState([]);

  const [connected, setConnected] =
    useState(false);

  const [connectionStatus, setConnectionStatus] =
    useState('CONNECTING');

  const [lastPrice, setLastPrice] =
    useState(null);

  const [lastDigit, setLastDigit] =
    useState(null);

  const [error, setError] =
    useState('');

  /*
   * LIVE DERIV STREAM
   */
  useEffect(() => {
    setTicks([]);
    setLastPrice(null);
    setLastDigit(null);
    setConnected(false);
    setConnectionStatus('CONNECTING');
    setError('');

    const url =
      `/api/ticks/stream/${selectedSymbol}`;

    console.log(
      'Connecting to tick stream:',
      url
    );

    const source =
      new EventSource(url);

    source.onopen = () => {
      console.log(
        'Tick stream connected:',
        selectedSymbol
      );

      setConnected(true);
      setConnectionStatus('LIVE');
      setError('');
    };

    source.onmessage = (event) => {
      try {
        const data =
          JSON.parse(event.data);

        const value =
          getTickValue(data);

        const digit =
          getLastDigit(value);

        if (digit === null) {
          return;
        }

        setLastPrice(value);
        setLastDigit(digit);

        setTicks(previous => {
          const next = [
            ...previous,
            value,
          ];

          return next.slice(
            -MAX_TICKS
          );
        });

        setConnected(true);
        setConnectionStatus('LIVE');

      } catch (err) {
        console.error(
          'Tick parsing error:',
          err
        );
      }
    };

    source.onerror = () => {
      console.error(
        'Tick stream connection error'
      );

      setConnected(false);
      setConnectionStatus(
        'RECONNECTING'
      );
    };

    return () => {
      source.close();
    };

  }, [selectedSymbol]);

  /*
   * EXTRACT RECENT DIGITS
   */
  const recentDigits = useMemo(() => {
    return ticks
      .map(getLastDigit)
      .filter(
        digit =>
          digit !== null &&
          Number.isFinite(digit)
      );
  }, [ticks]);

  /*
   * DIGIT MATCH PREDICTION
   */
  const digitPrediction = useMemo(() => {
    if (ticks.length < 10) {
      return normalisePrediction(
        null,
        'MATCHES'
      );
    }

    try {
      const result =
        analyzeDigitMatch(ticks);

      return normalisePrediction(
        result,
        'MATCHES'
      );

    } catch (err) {
      console.error(
        'Digit Match error:',
        err
      );

      return normalisePrediction(
        null,
        'MATCHES'
      );
    }
  }, [ticks]);

  /*
   * EVEN / ODD PREDICTION
   */
  const evenOddPrediction = useMemo(() => {
    if (ticks.length < 10) {
      return normalisePrediction(
        null,
        'EVEN / ODD'
      );
    }

    try {
      const result =
        analyzeEvenOdd(ticks);

      return normalisePrediction(
        result,
        'EVEN / ODD'
      );

    } catch (err) {
      console.error(
        'Even/Odd error:',
        err
      );

      return normalisePrediction(
        null,
        'EVEN / ODD'
      );
    }
  }, [ticks]);

  /*
   * OVER / UNDER PREDICTION
   */
  const overUnderPrediction = useMemo(() => {
    if (ticks.length < 10) {
      return normalisePrediction(
        null,
        'OVER / UNDER'
      );
    }

    try {
      const result =
        analyzeOverUnder(ticks);

      return normalisePrediction(
        result,
        'OVER / UNDER'
      );

    } catch (err) {
      console.error(
        'Over/Under error:',
        err
      );

      return normalisePrediction(
        null,
        'OVER / UNDER'
      );
    }
  }, [ticks]);

  const activeMarket =
    SYMBOLS.find(
      item =>
        item.symbol === selectedSymbol
    );

  return (
    <div style={styles.page}>

      {/* HEADER */}

      <header style={styles.header}>

        <div style={styles.brand}>
          <div style={styles.logo}>
            DH
          </div>

          <div>
            <h1 style={styles.brandName}>
              DigiHackerTool
            </h1>

            <div style={styles.brandSubtitle}>
              LIVE DIGIT PREDICTION ENGINE
            </div>
          </div>
        </div>

        <div
          style={{
            ...styles.connection,
            borderColor: connected
              ? 'rgba(0,230,160,.3)'
              : '#273039',
            color: connected
              ? '#00e6a0'
              : '#68747f',
          }}
        >
          <span
            style={{
              ...styles.connectionDot,
              background: connected
                ? '#00e6a0'
                : '#56616b',
              boxShadow: connected
                ? '0 0 9px #00e6a0'
                : 'none',
            }}
          />

          {connectionStatus}
        </div>

      </header>

      {/* ERROR */}

      {error && (
        <div style={styles.errorBox}>
          {error}
        </div>
      )}

      {/* MARKET SELECTOR */}

      <section style={styles.section}>

        <div style={styles.sectionHeading}>
          <span>MARKETS</span>
          <small>
            SELECT VOLATILITY INDEX
          </small>
        </div>

        <div style={styles.marketGrid}>

          {SYMBOLS.map(market => (
            <button
              key={market.symbol}
              type="button"
              onClick={() =>
                setSelectedSymbol(
                  market.symbol
                )
              }
              style={{
                ...styles.marketButton,
                ...(selectedSymbol ===
                market.symbol
                  ? styles.marketSelected
                  : {}),
              }}
            >
              <strong>
                {market.name}
              </strong>

              <span>
                {market.symbol}
              </span>
            </button>
          ))}

        </div>

      </section>

      {/* ACTIVE MARKET */}

      <section style={styles.activeMarket}>

        <div>
          <div style={styles.activeLabel}>
            ACTIVE MARKET
          </div>

          <h2 style={styles.activeName}>
            {activeMarket?.name}
          </h2>
        </div>

        <div style={styles.marketInfo}>
          <span>LAST PRICE</span>
          <strong>
            {lastPrice !== null
              ? lastPrice
              : '—'}
          </strong>
        </div>

        <div style={styles.marketInfo}>
          <span>LAST DIGIT</span>
          <strong style={styles.greenText}>
            {lastDigit !== null
              ? lastDigit
              : '—'}
          </strong>
        </div>

        <div style={styles.marketInfo}>
          <span>TICKS ANALYZED</span>
          <strong>
            {ticks.length}
          </strong>
        </div>

      </section>

      {/* PREDICTION CARDS */}

      <section style={styles.cards}>

        <PredictionCard
          title="DIGIT MATCH"
          subtitle="EXACT DIGIT ANALYSIS"
          prediction={
            digitPrediction.prediction !==
            null
              ? `MATCHES ${digitPrediction.prediction}`
              : null
          }
          confidence={
            digitPrediction.confidence
          }
          digits={recentDigits}
          connected={connected}
        />

        <PredictionCard
          title="EVEN / ODD"
          subtitle="PARITY ANALYSIS"
          prediction={
            evenOddPrediction.prediction
          }
          confidence={
            evenOddPrediction.confidence
          }
          digits={recentDigits}
          connected={connected}
        />

        <PredictionCard
          title="OVER / UNDER"
          subtitle="DIGIT RANGE ANALYSIS"
          prediction={
            overUnderPrediction.prediction
          }
          confidence={
            overUnderPrediction.confidence
          }
          digits={recentDigits}
          connected={connected}
        />

      </section>

      {/* ENGINE STATUS */}

      <section style={styles.enginePanel}>

        <div>
          <div style={styles.engineLabel}>
            PREDICTION ENGINE
          </div>

          <h2 style={styles.engineTitle}>
            Real-Time Analysis
          </h2>
        </div>

        <div style={styles.engineStatus}>

          <div style={styles.statusItem}>
            <span
              style={{
                ...styles.statusDot,
                background:
                  ticks.length >= 10
                    ? '#00e6a0'
                    : '#e7a83e',
              }}
            />

            <span>
              {ticks.length >= 10
                ? 'ANALYSIS ACTIVE'
                : 'COLLECTING TICKS'}
            </span>
          </div>

          <div style={styles.statusItem}>
            <span
              style={{
                ...styles.statusDot,
                background: connected
                  ? '#00e6a0'
                  : '#e05252',
              }}
            />

            <span>
              {connected
                ? 'DERIV STREAM CONNECTED'
                : 'STREAM DISCONNECTED'}
            </span>
          </div>

        </div>

      </section>

      {/* FOOTER */}

      <footer style={styles.footer}>

        <div>
          <span
            style={styles.footerDot}
          />

          LIVE DERIV TICK STREAM
        </div>

        <div>
          DigiHackerTool Prediction Engine
        </div>

      </footer>

    </div>
  );
}


/*
 * INLINE STYLES
 */

const styles = {
  page: {
    minHeight: '100vh',
    background:
      'radial-gradient(circle at 85% 0%, rgba(0,230,160,.08), transparent 35%), #070b10',
    color: '#f4f7fa',
    padding: '18px',
    fontFamily:
      'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },

  header: {
    maxWidth: '1450px',
    margin: '0 auto 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '15px',
  },

  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },

  logo: {
    width: '46px',
    height: '46px',
    borderRadius: '13px',
    display: 'grid',
    placeItems: 'center',
    background:
      'linear-gradient(135deg,#00e6a0,#00a879)',
    color: '#03100c',
    fontWeight: 950,
    fontSize: '14px',
    boxShadow:
      '0 0 25px rgba(0,230,160,.18)',
  },

  brandName: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 850,
  },

  brandSubtitle: {
    marginTop: '3px',
    color: '#65727d',
    fontSize: '8px',
    fontWeight: 800,
    letterSpacing: '1.7px',
  },

  connection: {
    padding: '8px 12px',
    border: '1px solid',
    borderRadius: '999px',
    background: '#0c1218',
    fontSize: '9px',
    fontWeight: 850,
    letterSpacing: '1px',
    display: 'flex',
    alignItems: 'center',
  },

  connectionDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    marginRight: '7px',
  },

  errorBox: {
    maxWidth: '1450px',
    margin: '0 auto 12px',
    padding: '11px 13px',
    borderRadius: '10px',
    background: 'rgba(224,82,82,.08)',
    border: '1px solid rgba(224,82,82,.25)',
    color: '#ef8888',
    fontSize: '10px',
  },

  section: {
    maxWidth: '1450px',
    margin: '0 auto 13px',
  },

  sectionHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    marginBottom: '8px',
  },

  sectionHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    marginBottom: '8px',
    color: '#dce4e9',
    fontSize: '9px',
    fontWeight: 900,
    letterSpacing: '1.5px',
  },

  marketGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(5, minmax(0,1fr))',
    gap: '7px',
  },

  marketButton: {
    border: '1px solid #1e2831',
    borderRadius: '11px',
    background: '#0c1218',
    color: '#8d99a4',
    padding: '11px',
    cursor: 'pointer',
    textAlign: 'left',
  },

  marketSelected: {
    borderColor:
      'rgba(0,230,160,.55)',
    background:
      'linear-gradient(135deg,rgba(0,230,160,.12),rgba(0,230,160,.025))',
    color: '#ffffff',
  },

  activeMarket: {
    maxWidth: '1450px',
    margin: '0 auto 13px',
    padding: '15px',
    border: '1px solid #1d2730',
    borderRadius: '14px',
    background: '#0b1117',
    display: 'flex',
    alignItems: 'center',
    gap: '25px',
  },

  activeLabel: {
    color: '#586570',
    fontSize: '7px',
    fontWeight: 900,
    letterSpacing: '1.4px',
  },

  activeName: {
    margin: '4px 0 0',
    fontSize: '17px',
  },

  marketInfo: {
    marginLeft: 'auto',
    textAlign: 'right',
  },

  greenText: {
    color: '#00e6a0',
  },

  cards: {
    maxWidth: '1450px',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns:
      'repeat(3, minmax(0,1fr))',
    gap: '11px',
  },

  card: {
    padding: '15px',
    border: '1px solid #202a33',
    borderRadius: '15px',
    background:
      'linear-gradient(160deg,#10171e,#0a1016)',
    boxShadow:
      '0 12px 35px rgba(0,0,0,.22)',
  },

  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  cardTitle: {
    fontSize: '11px',
    fontWeight: 900,
    letterSpacing: '.8px',
  },

  cardSubtitle: {
    marginTop: '4px',
    color: '#5d6975',
    fontSize: '7px',
    fontWeight: 700,
    letterSpacing: '1px',
  },

  liveBadge: {
    padding: '5px 8px',
    border: '1px solid',
    borderRadius: '999px',
    background: '#12191f',
    fontSize: '7px',
    fontWeight: 900,
    letterSpacing: '1px',
  },

  liveDot: {
    display: 'inline-block',
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    marginRight: '5px',
  },

  predictionBox: {
    marginTop: '17px',
    padding: '17px',
    borderRadius: '11px',
    background: '#080e13',
    border: '1px solid #182129',
    textAlign: 'center',
  },

  smallLabel: {
    color: '#56636e',
    fontSize: '7px',
    fontWeight: 900,
    letterSpacing: '1.5px',
  },

  prediction: {
    minHeight: '55px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    color: '#00e6a0',
    fontSize: '24px',
    fontWeight: 950,
    textShadow:
      '0 0 18px rgba(0,230,160,.15)',
  },

  confidenceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    color: '#65717c',
    fontSize: '8px',
    fontWeight: 700,
  },

  progressBackground: {
    height: '4px',
    marginTop: '8px',
    borderRadius: '10px',
    background: '#182129',
    overflow: 'hidden',
  },

  progress: {
    height: '100%',
    background: '#00e6a0',
    borderRadius: '10px',
    transition: 'width .3s ease',
  },

  recentTitle: {
    marginTop: '15px',
    marginBottom: '7px',
    color: '#56636e',
    fontSize: '7px',
    fontWeight: 900,
    letterSpacing: '1.3px',
  },

  digitsContainer: {
    display: 'flex',
    gap: '4px',
    overflow: 'hidden',
    minHeight: '24px',
  },

  digit: {
    minWidth: '23px',
    height: '23px',
    display: 'grid',
    placeItems: 'center',
    borderRadius: '6px',
    background: '#141c23',
    color: '#a4afb8',
    fontSize: '9px',
    fontWeight: 800,
  },

  latestDigit: {
    background:
      'rgba(0,230,160,.13)',
    color: '#00e6a0',
    border:
      '1px solid rgba(0,230,160,.25)',
  },

  waiting: {
    color: '#4d5963',
    fontSize: '9px',
  },

  executionRow: {
    marginTop: '15px',
    paddingTop: '12px',
    borderTop: '1px solid #1a232c',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  executionText: {
    color: '#697681',
    fontSize: '7px',
    fontWeight: 900,
    letterSpacing: '.8px',
  },

  executionDot: {
    display: 'inline-block',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#00e6a0',
    boxShadow:
      '0 0 8px #00e6a0',
    marginRight: '6px',
  },

  tradeButton: {
    border: 0,
    borderRadius: '7px',
    padding: '7px 12px',
    background: '#00e6a0',
    color: '#04120d',
    fontSize: '7px',
    fontWeight: 950,
    opacity: .35,
    cursor: 'not-allowed',
  },

  enginePanel: {
    maxWidth: '1450px',
    margin: '13px auto 0',
    padding: '15px',
    border: '1px solid #202a33',
    borderRadius: '14px',
    background: '#0b1117',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  engineLabel: {
    color: '#586570',
    fontSize: '7px',
    fontWeight: 900,
    letterSpacing: '1.5px',
  },

  engineTitle: {
    margin: '4px 0 0',
    fontSize: '14px',
  },

  engineStatus: {
    display: 'flex',
    gap: '18px',
  },

  statusItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: '#6c7882',
    fontSize: '7px',
    fontWeight: 850,
    letterSpacing: '.6px',
  },

  statusDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
  },

  footer: {
    maxWidth: '1450px',
    margin: '13px auto 0',
    padding: '11px 2px',
    display: 'flex',
    justifyContent: 'space-between',
    color: '#46525c',
    fontSize: '7px',
    fontWeight: 800,
    letterSpacing: '.8px',
  },

  footerDot: {
    display: 'inline-block',
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    background: '#00e6a0',
    marginRight: '5px',
  },
};
