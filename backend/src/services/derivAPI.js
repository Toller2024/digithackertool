import WebSocket from 'ws';

class DerivAPI {
  constructor(appId = null) {
    this.appId = appId;

    // Deriv public market-data WebSocket.
    // No OAuth token is required for public ticks.
    this.wsUrl =
      'wss://api.derivws.com/trading/v1/options/ws/public';

    this.ws = null;

    this.requestId = 0;

    // requestId -> callback
    this.callbacks = new Map();

    // requestId -> Deriv subscription id
    this.subscriptions = new Map();

    this.connected = false;
  }

  /*
   * CONNECT
   */
  connect() {
    return new Promise((resolve, reject) => {
      console.log('');
      console.log('==========================================');
      console.log('📡 DERIV WEBSOCKET CONNECTING');
      console.log('==========================================');
      console.log('URL:', this.wsUrl);
      console.log('');

      // Clean up an old connection.
      if (this.ws) {
        try {
          this.ws.removeAllListeners();
          this.ws.close();
        } catch (_) {}

        this.ws = null;
      }

      let settled = false;

      try {
        this.ws = new WebSocket(this.wsUrl);
      } catch (error) {
        console.error(
          '❌ DERIV WEBSOCKET CREATE ERROR:',
          error?.message || String(error)
        );

        reject(error);
        return;
      }

      /*
       * Connection timeout.
       *
       * If Deriv never completes the WebSocket handshake,
       * don't leave the SSE request hanging forever.
       */
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;

          console.error(
            '❌ DERIV WEBSOCKET CONNECTION TIMEOUT'
          );

          try {
            this.ws.close();
          } catch (_) {}

          reject(
            new Error(
              'Deriv WebSocket connection timeout'
            )
          );
        }
      }, 15000);

      /*
       * OPEN
       */
      this.ws.on('open', () => {
        clearTimeout(timeout);

        this.connected = true;

        console.log('');
        console.log('==========================================');
        console.log('✅ DERIV WEBSOCKET CONNECTED');
        console.log('==========================================');
        console.log('');

        if (!settled) {
          settled = true;
          resolve();
        }
      });

      /*
       * MESSAGE
       */
      this.ws.on('message', (rawData) => {
        let response;

        try {
          response = JSON.parse(
            rawData.toString()
          );
        } catch (error) {
          console.error(
            '❌ DERIV JSON PARSE ERROR:',
            error?.message || String(error)
          );

          return;
        }

        /*
         * Log important messages.
         *
         * This is intentionally verbose while we are
         * diagnosing the Render tick stream.
         */
        console.log(
          '📨 DERIV MESSAGE:',
          JSON.stringify(response)
        );

        /*
         * DERIV API ERROR
         */
        if (response.error) {
          console.error('');
          console.error(
            '=========================================='
          );
          console.error(
            '❌ DERIV API ERROR'
          );
          console.error(
            '=========================================='
          );
          console.error(
            JSON.stringify(response.error)
          );
          console.error('');

          const reqId = response.req_id;

          if (
            reqId &&
            this.callbacks.has(reqId)
          ) {
            const callback =
              this.callbacks.get(reqId);

            try {
              callback(response);
            } catch (error) {
              console.error(
                '❌ CALLBACK ERROR:',
                error?.message || String(error)
              );
            }
          }

          return;
        }

        /*
         * TICK MESSAGE
         */
        if (
          response.msg_type === 'tick' &&
          response.tick
        ) {
          const tick = response.tick;

          console.log('');
          console.log(
            '📈 DERIV TICK:',
            tick.symbol,
            tick.quote
          );

          console.log(
            '⏱️ EPOCH:',
            tick.epoch
          );

          /*
           * Save subscription ID.
           *
           * The first tick normally contains the
           * subscription information.
           */
          if (
            response.req_id &&
            response.subscription?.id
          ) {
            this.subscriptions.set(
              response.req_id,
              response.subscription.id
            );

            console.log(
              '🔗 SUBSCRIPTION ID:',
              response.subscription.id
            );
          }

          /*
           * First try request ID.
           */
          if (
            response.req_id &&
            this.callbacks.has(
              response.req_id
            )
          ) {
            const callback =
              this.callbacks.get(
                response.req_id
              );

            try {
              callback(response);
            } catch (error) {
              console.error(
                '❌ TICK CALLBACK ERROR:',
                error?.message || String(error)
              );
            }

            return;
          }

          /*
           * Streaming ticks may not contain req_id.
           *
           * In that case identify the callback by
           * the Deriv subscription ID.
           */
          const subscriptionId =
            response.subscription?.id;

          if (subscriptionId) {
            for (
              const [
                requestId,
                callback
              ] of this.callbacks.entries()
            ) {
              const savedSubscription =
                this.subscriptions.get(
                  requestId
                );

              if (
                savedSubscription ===
                subscriptionId
              ) {
                try {
                  callback(response);
                } catch (error) {
                  console.error(
                    '❌ STREAM CALLBACK ERROR:',
                    error?.message ||
                      String(error)
                  );
                }

                break;
              }
            }
          }

          return;
        }

        /*
         * Other responses.
         */
        if (
          response.req_id &&
          this.callbacks.has(
            response.req_id
          )
        ) {
          const reqId =
            response.req_id;

          /*
           * Save subscription ID when
           * Deriv sends one.
           */
          if (
            response.subscription?.id
          ) {
            this.subscriptions.set(
              reqId,
              response.subscription.id
            );

            console.log(
              `🔗 SAVED SUBSCRIPTION ${reqId}:`,
              response.subscription.id
            );
          }

          const callback =
            this.callbacks.get(reqId);

          try {
            callback(response);
          } catch (error) {
            console.error(
              '❌ RESPONSE CALLBACK ERROR:',
              error?.message ||
                String(error)
            );
          }
        }
      });

      /*
       * ERROR
       */
      this.ws.on('error', (error) => {
        clearTimeout(timeout);

        this.connected = false;

        console.error('');
        console.error(
          '=========================================='
        );
        console.error(
          '❌ DERIV WEBSOCKET ERROR'
        );
        console.error(
          '=========================================='
        );
        console.error(
          'Message:',
          error?.message || String(error)
        );
        console.error(
          'Code:',
          error?.code || 'none'
        );
        console.error('');

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

      /*
       * CLOSE
       */
      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout);

        this.connected = false;

        console.log('');
        console.log(
          '🔌 DERIV WEBSOCKET CLOSED'
        );
        console.log(
          'Code:',
          code
        );
        console.log(
          'Reason:',
          reason?.toString() || ''
        );
        console.log('');
      });
    });
  }

  /*
   * SUBSCRIBE TO TICKS
   */
  subscribeTicks(symbol, callback) {
    if (!this.ws) {
      throw new Error(
        'Deriv WebSocket is not connected'
      );
    }

    if (
      this.ws.readyState !==
      WebSocket.OPEN
    ) {
      throw new Error(
        'Deriv WebSocket is not open'
      );
    }

    if (!symbol) {
      throw new Error(
        'Deriv symbol is required'
      );
    }

    if (
      typeof callback !== 'function'
    ) {
      throw new Error(
        'Tick callback function is required'
      );
    }

    const reqId =
      ++this.requestId;

    const request = {
      ticks: symbol,
      subscribe: 1,
      req_id: reqId
    };

    console.log('');
    console.log(
      '=========================================='
    );
    console.log(
      '📡 SUBSCRIBING TO DERIV TICKS'
    );
    console.log(
      '=========================================='
    );
    console.log(
      'Symbol:',
      symbol
    );
    console.log(
      'Request ID:',
      reqId
    );
    console.log(
      'Request:',
      JSON.stringify(request)
    );
    console.log('');

    /*
     * Keep the callback alive because this
     * is a continuous subscription.
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

  /*
   * UNSUBSCRIBE
   */
  unsubscribe(reqId) {
    if (!reqId) {
      return;
    }

    const subscriptionId =
      this.subscriptions.get(reqId);

    if (
      !subscriptionId
    ) {
      console.log(
        `⚠️ NO SUBSCRIPTION ID FOR REQUEST ${reqId}`
      );

      this.callbacks.delete(
        reqId
      );

      this.subscriptions.delete(
        reqId
      );

      return;
    }

    if (
      !this.ws ||
      this.ws.readyState !==
        WebSocket.OPEN
    ) {
      this.callbacks.delete(
        reqId
      );

      this.subscriptions.delete(
        reqId
      );

      return;
    }

    const forgetRequest = {
      forget: subscriptionId,
      req_id: ++this.requestId
    };

    console.log(
      '📤 DERIV UNSUBSCRIBE:',
      JSON.stringify(
        forgetRequest
      )
    );

    try {
      this.ws.send(
        JSON.stringify(
          forgetRequest
        )
      );
    } catch (error) {
      console.error(
        '❌ DERIV UNSUBSCRIBE ERROR:',
        error?.message ||
          String(error)
      );
    }

    this.callbacks.delete(
      reqId
    );

    this.subscriptions.delete(
      reqId
    );
  }

  /*
   * DISCONNECT
   */
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
          error?.message ||
            String(error)
        );
      }

      this.ws = null;
    }
  }

  /*
   * Kept for compatibility with existing
   * backend code.
   *
   * Public tick data does not require OAuth.
   */
  async authorize() {
    console.log(
      'ℹ️ PUBLIC DERIV TICK STREAM: OAuth authorization is not required'
    );

    return {
      msg_type: 'authorize',
      authorized: true
    };
  }

  /*
   * These methods are deliberately not used
   * by the public tick stream.
   */
  async getAccountBalance() {
    throw new Error(
      'Account balance requires an authenticated Deriv connection'
    );
  }

  async getAccountList() {
    throw new Error(
      'Account list requires an authenticated Deriv connection'
    );
  }

  /*
   * Send a generic request.
   *
   * Kept for compatibility with other backend code.
   */
  send(request) {
    return new Promise(
      (resolve, reject) => {
        if (
          !this.ws ||
          this.ws.readyState !==
            WebSocket.OPEN
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

        const callback = (
          response
        ) => {
          if (response.error) {
            reject(
              response.error
            );
          } else {
            resolve(
              response
            );
          }

          /*
           * Generic requests are normally
           * one-time requests.
           */
          if (
            response.msg_type !==
            'tick'
          ) {
            this.callbacks.delete(
              reqId
            );
          }
        };

        this.callbacks.set(
          reqId,
          callback
        );

        try {
          console.log(
            '📤 DERIV SEND:',
            JSON.stringify(
              requestWithId
            )
          );

          this.ws.send(
            JSON.stringify(
              requestWithId
            )
          );
        } catch (error) {
          this.callbacks.delete(
            reqId
          );

          reject(error);
        }
      }
    );
  }
}

export default DerivAPI;
