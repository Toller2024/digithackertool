import express from 'express';
import DerivAPI from '../services/derivAPI.js';

const router = express.Router();

const activeConnections = new Map();

router.get('/symbols', (req, res) => {
  const symbols = [
    { symbol: 'R_10', name: 'Volatility 10 Index' },
    { symbol: 'R_25', name: 'Volatility 25 Index' },
    { symbol: 'R_50', name: 'Volatility 50 Index' },
    { symbol: 'R_75', name: 'Volatility 75 Index' },
    { symbol: 'R_100', name: 'Volatility 100 Index' },
    { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index' },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index' }
  ];

  res.json(symbols);
});

router.get('/stream/:symbol', async (req, res) => {
  const { symbol } = req.params;

  console.log(`🌐 SSE CLIENT CONNECTED: ${symbol}`);

  // SSE headers
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Allow Vercel frontend
  const origin = req.headers.origin;

  if (
    origin === 'https://digitalhackertool.vercel.app' ||
    origin === 'https://www.digitalhackertool.vercel.app' ||
    (origin &&
      origin.startsWith('https://') &&
      origin.endsWith('.vercel.app'))
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  // Send headers immediately
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  // Initial SSE message
  res.write(': connected\n\n');

  let api = null;
  let heartbeat = null;

  try {
    api = new DerivAPI(process.env.DERIV_APP_ID);

    await api.connect();

    console.log(`✅ DERIV CONNECTED FOR SSE: ${symbol}`);

    const reqId = api.subscribeTicks(symbol, (response) => {
      if (!response || !response.tick) {
        return;
      }

      const tick = response.tick;

      console.log(
        `📊 SSE TICK ${symbol}: ${tick.quote}`
      );

      try {
        res.write(
          `data: ${JSON.stringify(tick)}\n\n`
        );
      } catch (error) {
        console.error(
          '❌ SSE WRITE ERROR:',
          error?.message || String(error)
        );
      }
    });

    activeConnections.set(res, {
      api,
      reqId
    });

    // Keep the browser connection alive.
    heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch (error) {
        console.error(
          '❌ SSE HEARTBEAT ERROR:',
          error?.message || String(error)
        );

        clearInterval(heartbeat);
        heartbeat = null;
      }
    }, 10000);

    req.on('close', () => {
      console.log(`🔴 SSE CLIENT DISCONNECTED: ${symbol}`);

      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }

      const connection = activeConnections.get(res);

      if (connection) {
        try {
          connection.api.unsubscribe(
            connection.reqId
          );
        } catch (error) {
          console.error(
            '❌ UNSUBSCRIBE ERROR:',
            error?.message || String(error)
          );
        }

        try {
          connection.api.disconnect();
        } catch (error) {
          console.error(
            '❌ DISCONNECT ERROR:',
            error?.message || String(error)
          );
        }

        activeConnections.delete(res);
      }
    });

  } catch (error) {
    console.error(
      '❌ TICK STREAM ERROR:',
      error?.message || String(error)
    );

    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    if (api) {
      try {
        api.disconnect();
      } catch (disconnectError) {
        console.error(
          '❌ DERIV DISCONNECT ERROR:',
          disconnectError?.message ||
            String(disconnectError)
        );
      }
    }

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to start tick stream'
      });
    } else {
      try {
        res.write(
          `event: error\ndata: ${JSON.stringify({
            error: 'Failed to start tick stream'
          })}\n\n`
        );
        res.end();
      } catch (writeError) {
        console.error(
          '❌ SSE ERROR RESPONSE FAILED:',
          writeError?.message ||
            String(writeError)
        );
      }
    }
  }
});

export default router;
