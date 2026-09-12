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

    this.connected = false;
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

        this.connected = true;

        if (!settled) {
          settled = true;
          resolve();
        }
      });

      this.ws.on('message', (data) => {
        try {
          const response = JSON.parse(
            data.toString()
          );

          console.log(
            '📨 DERIV MESSAGE:',
            JSON.stringify(response)
          );

          /*
           * Handle Deriv errors.
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
                this.callbacks.get(
                  response.req_id
                );

              callback(response);
            }

            return;
          }

          /*
           * TICK STREAM
           */
          if (
            response.msg_type === 'tick' &&
            response.tick
          ) {
            const tick = response.tick;

            console.log(
              '📈 DERIV TICK:',
              tick.symbol,
              tick.quote
            );

            /*
             * Save subscription ID.
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
             * Find the callback using req_id.
             */
            if (
              response.req_id &&
              this.callbacks.has(response.req_id)
            ) {
              const callback =
                this.callbacks.get(
                  response.req_id
                );

              callback(response);

              /*
               * IMPORTANT:
               * Do NOT delete the callback.
               *
               * Tick subscriptions are continuous.
               */
              return;
            }

            /*
             * Some streaming messages may not
             * contain req_id.
             *
             * Match using subscription ID.
             */
            const subscriptionId =
              response.subscription?.id;

            if (subscriptionId) {
              for (const [
                requestId,
                callback
              ] of this.callbacks.entries()) {
                const savedSubscription =
                  this.subscriptions.get(
                    requestId
                  );

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
           * Other responses.
           */
          if (
            response.req_id &&
            this.callbacks.has(response.req_id)
          ) {
            const callback =
              this.callbacks.get(
                response.req_id
              );

            /*
             * Save subscription ID if supplied.
             */
            if (
              response.subscription?.id
            ) {
              this.subscriptions.set(
                response.req_id,
                response.subscription.id
              );
            }

            callback(response);

            /*
             * Non-streaming requests are
             * one-time callbacks.
             */
            if (
              response.msg_type !== 'tick'
            ) {
              this.callbacks.delete(
                response.req_id
              );
            }
          }
        } catch (error) {
          console.error(
            '❌ DERIV MESSAGE PARSE ERROR:',
            error?.message ||
              String(error)
          );
        }
      });

      this.ws.on('error', (error) => {
        console.error(
          '❌ DERIV WEBSOCKET ERROR:',
          error?.message ||
            String(error)
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

        this.callbacks.set(
          reqId,
          (response) => {
            if (response.error) {
              reject(response.error);
            } else {
              resolve(response);
            }
          }
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

  async authorize(token) {
    if (!token) {
      throw new Error(
        'Authorization token is required'
      );
    }

    return this.send({
      authorize: token
    });
  }

  async getAccountBalance(token) {
    if (!token) {
      throw new Error(
        'Authorization token is required'
      );
    }

    await this.send({
      authorize: token
    });

    return this.send({
      balance: 1
    });
  }

  async getAccountList(token) {
    if (!token) {
      throw new Error(
        'Authorization token is required'
      );
    }

    await this.send({
      authorize: token
    });

    return this.send({
      account_list: 1
    });
  }

  subscribeTicks(symbol, callback) {
    if (
      !this.ws ||
      this.ws.readyState !==
        WebSocket.OPEN
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
      typeof callback !==
      'function'
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

    console.log(
      `📡 SUBSCRIBING TO DERIV TICKS: ${symbol}`
    );

    console.log(
      '📤 DERIV TICK REQUEST:',
      JSON.stringify(request)
    );

    /*
     * Keep callback alive for the
     * entire subscription.
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
      this.callbacks.delete(
        reqId
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
      this.subscriptions.get(
        reqId
      );

    if (!subscriptionId) {
      console.log(
        `⚠️ No subscription ID for request ${reqId}`
      );

      this.callbacks.delete(
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
}

export default DerivAPI
