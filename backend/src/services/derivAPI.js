import WebSocket from 'ws';

class DerivAPI {
  constructor(appId) {
    // Kept for compatibility with the rest of the backend.
    // Public market-data WebSocket does not require the App ID.
    this.appId = appId;

    this.ws = null;
    this.requestId = 0;

    // req_id -> callback
    this.callbacks = new Map();

    // req_id -> Deriv subscription ID
    this.subscriptions = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      /*
       * PUBLIC DERIV MARKET-DATA WEBSOCKET
       *
       * No App ID
       * No OAuth
       * No account authentication
       *
       * Used only for public market data / tick streams.
       */
      const wsUrl =
        'wss://ws.binaryws.com/websockets/v3';

      console.log('========================================');
      console.log('Connecting to Deriv public market data');
      console.log(wsUrl);
      console.log('========================================');

      this.ws = new WebSocket(wsUrl);

      let settled = false;

      // ---------------------------------------------
      // CONNECTION OPEN
      // ---------------------------------------------

      this.ws.on('open', () => {
        console.log(
          '✅ DERIV PUBLIC WEBSOCKET CONNECTED'
        );

        if (!settled) {
          settled = true;
          resolve();
        }
      });

      // ---------------------------------------------
      // MESSAGES
      // ---------------------------------------------

      this.ws.on('message', (data) => {
        try {
          const response = JSON.parse(
            data.toString()
          );

          console.log(
            'DERIV MESSAGE:',
            response.msg_type || 'unknown',
            response.req_id || ''
          );

          // -----------------------------------------
          // DERIV ERROR
          // -----------------------------------------

          if (response.error) {
            console.error(
              '❌ DERIV API ERROR:',
              JSON.stringify(response.error)
            );

            const reqId = response.req_id;

            if (
              reqId &&
              this.callbacks.has(reqId)
            ) {
              const callback =
                this.callbacks.get(reqId);

              callback(response);

              /*
               * Keep subscription callback only if
               * this was already a live subscription.
               */
              if (
                !response.subscription
              ) {
                this.callbacks.delete(reqId);
              }
            }

            return;
          }

          // -----------------------------------------
          // TICK MESSAGE
          // -----------------------------------------

          if (response.msg_type === 'tick') {
            const reqId = response.req_id;

            // Save Deriv subscription ID
            if (
              reqId &&
              response.subscription &&
              response.subscription.id
            ) {
              const subscriptionId =
                response.subscription.id;

              this.subscriptions.set(
                reqId,
                subscriptionId
              );

              console.log(
                `📡 Subscription active: ${subscriptionId}`
              );
            }

            // Send tick to subscriber
            if (
              reqId &&
              this.callbacks.has(reqId)
            ) {
              const callback =
                this.callbacks.get(reqId);

              callback(response);
            }

            return;
          }

          // -----------------------------------------
          // NORMAL DERIV RESPONSE
          // -----------------------------------------

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

            // Save subscription ID
            if (
              response.subscription &&
              response.subscription.id
            ) {
              this.subscriptions.set(
                response.req_id,
                response.subscription.id
              );
            }

            callback(response);

            /*
             * Non-streaming requests are removed
             * after receiving their response.
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
            error?.message || String(error)
          );
        }
      });

      // ---------------------------------------------
      // WEBSOCKET ERROR
      // ---------------------------------------------

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

      // ---------------------------------------------
      // WEBSOCKET CLOSED
      // ---------------------------------------------

      this.ws.on('close', (code, reason) => {
        console.log(
          '❌ DERIV WEBSOCKET CLOSED:',
          code,
          reason?.toString() || ''
        );

        this.ws = null;
      });
    });
  }

  // -----------------------------------------------
  // SEND REQUEST
  // -----------------------------------------------

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

      const fullRequest = {
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
        this.ws.send(
          JSON.stringify(fullRequest)
        );
      } catch (error) {
        this.callbacks.delete(reqId);
        reject(error);
      }
    });
  }

  // -----------------------------------------------
  // AUTHORIZE
  // -----------------------------------------------

  async authorize(token) {
    return this.send({
      authorize: token
    });
  }

  // -----------------------------------------------
  // BALANCE
  // -----------------------------------------------

  async getAccountBalance(token) {
    await this.authorize(token);

    return this.send({
      balance: 1,
      account: 'all'
    });
  }

  // -----------------------------------------------
  // ACCOUNT LIST
  // -----------------------------------------------

  async getAccountList(token) {
    await this.authorize(token);

    return this.send({
      account_list: 1
    });
  }

  // -----------------------------------------------
  // SUBSCRIBE TO TICKS
  // -----------------------------------------------

  subscribeTicks(symbol, callback) {
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      throw new Error(
        'Deriv WebSocket is not connected'
      );
    }

    const reqId = ++this.requestId;

    console.log(
      '========================================'
    );

    console.log(
      `📡 SUBSCRIBING TO DERIV TICKS: ${symbol}`
    );

    console.log(
      `📡 REQUEST ID: ${reqId}`
    );

    console.log(
      '========================================'
    );

    /*
     * This is the standard Deriv tick
     * subscription request.
     */
    const request = {
      ticks: symbol,
      subscribe: 1,
      req_id: reqId
    };

    // Store callback before sending request
    this.callbacks.set(
      reqId,
      callback
    );

    try {
      this.ws.send(
        JSON.stringify(request)
      );

      console.log(
        `✅ Tick subscription request sent: ${symbol}`
      );

    } catch (error) {
      this.callbacks.delete(reqId);

      console.error(
        '❌ Failed to send tick request:',
        error?.message || String(error)
      );

      throw error;
    }

    return reqId;
  }

  // -----------------------------------------------
  // UNSUBSCRIBE
  // -----------------------------------------------

  unsubscribe(reqId) {
    const subscriptionId =
      this.subscriptions.get(reqId);

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
          `🛑 DERIV SUBSCRIPTION FORGOTTEN: ${subscriptionId}`
        );

      } catch (error) {
        console.error(
          '❌ Unsubscribe error:',
          error?.message || String(error)
        );
      }
    }

    this.callbacks.delete(reqId);
    this.subscriptions.delete(reqId);
  }

  // -----------------------------------------------
  // DISCONNECT
  // -----------------------------------------------

  disconnect() {
    if (this.ws) {
      console.log(
        'Closing Deriv public WebSocket...'
      );

      try {
        this.ws.close();
      } catch (error) {
        console.error(
          '❌ WebSocket close error:',
          error?.message || String(error)
        );
      }

      this.ws = null;
    }

    this.callbacks.clear();
    this.subscriptions.clear();
  }
}

export default DerivAPI;
