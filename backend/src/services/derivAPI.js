import WebSocket from 'ws';

class DerivAPI {
  constructor(appId = null) {
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

          // FULL RESPONSE LOG FOR DEBUGGING
          console.log(
            '📨 DERIV FULL MESSAGE:',
            JSON.stringify(response)
          );

          // Show Deriv errors clearly
          if (response.error) {
            console.error(
              '❌ DERIV API ERROR:',
              JSON.stringify(response.error)
            );
          }

          /*
           * TICK MESSAGE
           *
           * Keep subscription callbacks alive because
           * multiple ticks are expected from one subscription.
           */
          if (response.msg_type === 'tick') {
            const reqId = response.req_id;

            if (reqId && this.callbacks.has(reqId)) {
              const callback = this.callbacks.get(reqId);

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
           * Other responses such as:
           * authorize
           * balance
           * forget
           * subscription confirmation
           * errors
           */
          if (
            response.req_id &&
            this.callbacks.has(response.req_id)
          ) {
            const callback =
              this.callbacks.get(response.req_id);

            if (response.subscription?.id) {
              this.subscriptions.set(
                response.req_id,
                response.subscription.id
              );
            }

            callback(response);

            /*
             * Normal request callbacks are one-time.
             * Tick subscriptions are kept alive.
             */
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
          new Error(
            'Deriv WebSocket is not connected'
          )
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
        console.log(
          '📤 DERIV SEND:',
          JSON.stringify(requestWithId)
        );

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
     * The public WebSocket does not require
     * authorization for public market data.
     *
     * This method is kept for compatibility with
     * the rest of the backend.
     */
    if (!token) {
      throw new Error('Authorization token is required');
    }

    return this.send({
      authorize: token
    });
  }

  async getAccountBalance(token) {
    if (!token) {
      throw new Error('Authorization token is required');
    }

    return this.send({
      authorize: token
    }).then(() => {
      return this.send({
        balance: 1
      });
    });
  }

  async getAccountList(token) {
    if (!token) {
      throw new Error('Authorization token is required');
    }

    return this.send({
      authorize: token
    }).then(() => {
      return this.send({
        account_list: 1
      });
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

    if (typeof callback !== 'function') {
      throw new Error(
        'A tick callback function is required'
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
      '📤 DERIV TICK REQUEST:',
      JSON.stringify(request)
    );

    /*
     * IMPORTANT:
     * Keep this callback in the Map because
     * Deriv will send many tick messages.
     */
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
    if (!reqId) {
      return;
    }

    const subscriptionId =
      this.subscriptions.get(reqId);

    if (!subscriptionId) {
      console.log(
        `⚠️ No subscription ID found for request ${reqId}`
      );

      this.callbacks.delete(reqId);
      return;
    }

    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      this.callbacks.delete(reqId);
      this.subscriptions.delete(reqId);
      return;
    }

    const forgetRequest = {
      forget: subscriptionId,
      req_id: ++this.requestId
    };

    console.log(
      '📤 DERIV UNSUBSCRIBE:',
      JSON.stringify(forgetRequest)
    );

    try {
      this.ws.send(
        JSON.stringify(forgetRequest)
      );
    } catch (error) {
      console.error(
        '❌ DERIV UNSUBSCRIBE ERROR:',
        error?.message || String(error)
      );
    }

    this.callbacks.delete(reqId);
    this.subscriptions.delete(reqId);
  }

  disconnect() {
    console.log(
      '🔌 DISCONNECTING FROM DERIV'
    );

    /*
     * Clear callbacks and subscriptions.
     */
    this.callbacks.clear();
    this.subscriptions.clear();

    if (this.ws) {
      try {
        if (
          this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING
        ) {
          this.ws.close();
        }
      } catch (error) {
        console.error(
          '❌ DERIV DISCONNECT ERROR:',
          error?.message || String(error)
        );
      }

      this.ws = null;
    }
  }
}

export default DerivAPI;
