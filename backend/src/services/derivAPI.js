import WebSocket from 'ws';

class DerivAPI {
  constructor(appId = null) {
    // Public market-data WebSocket.
    // No App ID or OAuth token is required for public ticks.
    this.wsUrl =
      'wss://api.derivws.com/trading/v1/options/ws/public';

    this.appId = appId;
    this.ws = null;
    this.requestId = 0;

    this.callbacks = new Map();
    this.subscriptions = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      console.log('====================================');
      console.log('📡 DERIV PUBLIC WEBSOCKET');
      console.log('Connecting to:', this.wsUrl);
      console.log('====================================');

      this.ws = new WebSocket(this.wsUrl);

      let settled = false;

      this.ws.on('open', () => {
        console.log('✅ DERIV WEBSOCKET CONNECTED');

        if (!settled) {
          settled = true;
          resolve();
        }
      });

      this.ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());

          console.log(
            console.log(
  '📨 DERIV FULL MESSAGE:',
  JSON.stringify(response)
);
          

          // Report API errors clearly
          if (response.error) {
            console.error(
              '❌ DERIV API ERROR:',
              JSON.stringify(response.error)
            );
          }

          /*
           * Tick subscription response
           */
          if (response.msg_type === 'tick') {
            const reqId = response.req_id;

            if (reqId && this.callbacks.has(reqId)) {
              const callback = this.callbacks.get(reqId);

              // Save Deriv subscription ID
              if (response.subscription?.id) {
                this.subscriptions.set(
                  reqId,
                  response.subscription.id
                );
              }

              callback(response);
            }

            return;
          }

          /*
           * Normal request response
           */
          if (
            response.req_id &&
            this.callbacks.has(response.req_id)
          ) {
            const callback =
              this.callbacks.get(response.req_id);

            // Save subscription ID if provided
            if (response.subscription?.id) {
              this.subscriptions.set(
                response.req_id,
                response.subscription.id
              );
            }

            callback(response);

            // Remove one-time callback
            if (response.msg_type !== 'tick') {
              this.callbacks.delete(response.req_id);
            }
          }
        } catch (error) {
          console.error(
            '❌ DERIV MESSAGE PARSE ERROR:',
            error?.message || String(error)
          );
        }
      });

      this.ws.on('error', (error) => {
        console.error(
          '❌ DERIV WEBSOCKET ERROR:',
          error?.message || String(error)
        );

        console.error(
          '❌ DERIV WEBSOCKET ERROR CODE:',
          error?.code || 'none'
        );

        if (!settled) {
          settled = true;
          reject(
            new Error(
              error?.message ||
                'Deriv WebSocket connection failed'
            )
          );
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(
          '🔌 DERIV WEBSOCKET CLOSED:',
          code,
          reason?.toString() || ''
        );
      });
    });
  }

  send(request) {
    return new Promise((resolve, reject) => {
      if (
        !this.ws ||
        this.ws.readyState !== WebSocket.OPEN
      ) {
        return reject(
          new Error('Deriv WebSocket is not connected')
        );
      }

      const reqId = ++this.requestId;

      const requestWithId = {
        ...request,
        req_id: reqId
      };

      this.callbacks.set(reqId, (response) => {
        if (response.error) {
          reject(response.error);
        } else {
          resolve(response);
        }
      });

      try {
        this.ws.send(
          JSON.stringify(requestWithId)
        );
      } catch (error) {
        this.callbacks.delete(reqId);
        reject(error);
      }
    });
  }

  async authorize(token) {
    /*
     * Public tick streaming does not require authorization.
     *
     * This method is kept for compatibility with the
     * existing application code.
     */
    if (!token) {
      return {
        authorized: false,
        public: true
      };
    }

    return this.send({
      authorize: token
    });
  }

  async getAccountBalance(token) {
    if (!token) {
      throw new Error(
        'Authentication token required for account balance'
      );
    }

    await this.authorize(token);

    return this.send({
      balance: 1,
      account: 'all'
    });
  }

  async getAccountList(token) {
    if (!token) {
      throw new Error(
        'Authentication token required for account list'
      );
    }

    await this.authorize(token);

    return this.send({
      account_list: 1
    });
  }

  subscribeTicks(symbol, callback) {
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      throw new Error(
        'Deriv WebSocket is not connected'
      );
    }

    if (!symbol) {
      throw new Error(
        'A Deriv symbol is required'
      );
    }

    const reqId = ++this.requestId;

    const request = {
      ticks: symbol,
      subscribe: 1,
      req_id: reqId
    };

    console.log(
      `📡 SUBSCRIBING TO DERIV TICKS: ${symbol}`
    );

    console.log(
      '📤 DERIV REQUEST:',
      JSON.stringify(request)
    );

    this.callbacks.set(reqId, callback);

    try {
      this.ws.send(
        JSON.stringify(request)
      );
    } catch (error) {
      this.callbacks.delete(reqId);
      throw error;
    }

    return reqId;
  }

  unsubscribe(reqId) {
    const subscriptionId =
      this.subscriptions.get(reqId);

    this.callbacks.delete(reqId);
    this.subscriptions.delete(reqId);

    if (
      subscriptionId &&
      this.ws &&
      this.ws.readyState === WebSocket.OPEN
    ) {
      try {
        this.ws.send(
          JSON.stringify({
            forget: subscriptionId
          })
        );

        console.log(
          `🛑 DERIV UNSUBSCRIBED: ${subscriptionId}`
        );
      } catch (error) {
        console.error(
          '❌ DERIV UNSUBSCRIBE ERROR:',
          error?.message || String(error)
        );
      }
    }
  }

  disconnect() {
    if (this.ws) {
      console.log(
        '🔌 CLOSING DERIV WEBSOCKET'
      );

      try {
        this.ws.close();
      } catch (error) {
        console.error(
          '❌ DERIV CLOSE ERROR:',
          error?.message || String(error)
        );
      }

      this.ws = null;
    }
  }
}

export default DerivAPI;
