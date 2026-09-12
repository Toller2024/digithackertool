import WebSocket from 'ws';

class DerivAPI {
  constructor(appId = null) {
    this.appId = appId;

    // Deriv public market-data WebSocket.
    // No OAuth token is required for tick streams.
    this.wsUrl =
      'wss://api.derivws.com/trading/v1/options/ws/public';

    this.ws = null;
    this.requestId = 0;

    this.callbacks = new Map();
    this.subscriptions = new Map();

    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      console.log('====================================');
      console.log('📡 DERIV TICK WEBSOCKET');
      console.log('Connecting to:', this.wsUrl);
      console.log('====================================');

      if (this.ws) {
        try {
          this.ws.close();
        } catch (_) {}
      }

      this.ws = new WebSocket(this.wsUrl);

      let settled = false;

      this.ws.on('open', () => {
        console.log('====================================');
        console.log('✅ DERIV WEBSOCKET CONNECTED');
        console.log('====================================');

        this.connected = true;

        if (!settled) {
          settled = true;
          resolve();
        }
      });

      this.ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());

          /*
           * Always show the raw Deriv response while debugging.
           */
          console.log(
            '📨 DERIV MESSAGE:',
            JSON.stringify(response)
          );

          /*
           * Deriv API error.
           */
          if (response.error) {
            console.error(
              '❌ DERIV API ERROR:',
              JSON.stringify(response.error)
            );

            if (
              response.req_id &&
              this.callbacks.has(response.req_id)
            ) {
              const callback =
                this.callbacks.get(response.req_id);

              callback(response);
            }

            return;
          }

          /*
           * Tick response.
           */
          if (
            response.msg_type === 'tick' &&
            response.tick
          ) {
            const tick = response.tick;

            console.log('====================================');
            console.log(
              '📈 DERIV TICK:',
              tick.symbol,
              tick.quote
            );
            console.log(
              '⏱️ DERIV EPOCH:',
              tick.epoch
            );
            console.log('====================================');

            /*
             * Save the Deriv subscription ID.
             */
            if (
              response.req_id &&
              response.subscription?.id
            ) {
              this.subscriptions.set(
                response.req_id,
                response.subscription.id
              );
            }

            /*
             * First try request ID.
             */
            if (
              response.req_id &&
              this.callbacks.has(response.req_id)
            ) {
              const callback =
                this.callbacks.get(response.req_id);

              callback(response);

              return;
            }

            /*
             * If the streaming tick does not contain
             * req_id, match by subscription ID.
             */
            const subscriptionId =
              response.subscription?.id;

            if (subscriptionId) {
              for (const [
                requestId,
                callback
              ] of this.callbacks.entries()) {
                const savedSubscription =
                  this.subscriptions.get(requestId);

                if (
                  savedSubscription ===
                  subscriptionId
                ) {
                  callback(response);
                  break;
                }
              }
            }

            return;
          }

          /*
           * Other Deriv responses.
           */
          if (
            response.req_id &&
            this.callbacks.has(response.req_id)
          ) {
            const callback =
              this.callbacks.get(response.req_id);

            /*
             * Save subscription ID.
             */
            if (response.subscription?.id) {
              this.subscriptions.set(
                response.req_id,
                response.subscription.id
              );
            }

            callback(response);
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
          '❌ DERIV ERROR CODE:',
          error?.code || 'none'
        );

        this.connected = false;

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
        this.connected = false;

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
        reject(
          new Error(
            'Deriv WebSocket is not connected'
          )
        );

        return;
      }

      const reqId =
        ++this.requestId;

      const requestWithId = {
        ...request,
        req_id: reqId
      };

      const callback = (response) => {
        if (response.error) {
          reject(response.error);
        } else {
          resolve(response);
        }

        /*
         * Normal requests are one-time requests.
         */
        if (response.msg_type !== 'tick') {
          this.callbacks.delete(reqId);
        }
      };

      this.callbacks.set(
        reqId,
        callback
      );

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

  /*
   * IMPORTANT:
   *
   * The public market-data WebSocket does NOT need
   * OAuth authorization for ticks.
   *
   * This method is retained so existing backend
   * code does not immediately break if it calls it.
   */
  async authorize(token) {
    console.log(
      'ℹ️ DERIV PUBLIC TICK STREAM: authorization not required'
    );

    return {
      msg_type: 'authorize',
      authorized: true,
      public_market_data: true
    };
  }

  /*
   * These account methods are intentionally not used
   * by the public tick connection.
   *
   * The new Deriv API uses authenticated WebSocket URLs
   * generated through the OTP workflow for account data.
   */
  async getAccountBalance() {
    throw new Error(
      'Account balance requires an authenticated Deriv WebSocket. Public tick connection cannot access account balance.'
    );
  }

  async getAccountList() {
    throw new Error(
      'Account list requires authenticated Deriv API access. Public tick connection cannot access account accounts.'
    );
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

    if (
      typeof callback !== 'function'
    ) {
      throw new Error(
        'A tick callback function is required'
      );
    }

    const reqId =
      ++this.requestId;

    const request = {
      ticks: symbol,
      subscribe: 1,
      req_id: reqId
    };

    console.log('====================================');
    console.log(
      `📡 SUBSCRIBING TO DERIV TICKS: ${symbol}`
    );
    console.log(
      '📤 DERIV TICK REQUEST:',
      JSON.stringify(request)
    );
    console.log('====================================');

    /*
     * Keep callback alive because this is
     * a continuous subscription.
     */
    this.callbacks.set(
      reqId,
      callback
    );

    try {
      this.ws.send(
        JSON.stringify(request)
      );

      console.log(
        `✅ TICK SUBSCRIPTION REQUEST SENT: ${symbol}`
      );
    } catch (error) {
      this.callbacks.delete(reqId);

      console.error(
        '❌ FAILED TO SEND TICK REQUEST:',
        error?.message || String(error)
      );

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
        `⚠️ No subscription ID for request ${reqId}`
      );

      this.callbacks.delete(reqId);
      this.subscriptions.delete(reqId);

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

    this.connected = false;

    this.callbacks.clear();
    this.subscriptions.clear();

    if (this.ws) {
      try {
        if (
          this.ws.readyState ===
            WebSocket.OPEN ||
          this.ws.readyState ===
            WebSocket.CONNECTING
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
