import WebSocket from 'ws';

class DerivAPI {
  constructor(appId) {
    this.appId = appId;
    this.ws = null;
    this.requestId = 0;

    // Request callbacks
    this.callbacks = new Map();

    // req_id -> subscription.id
    this.subscriptions = new Map();

    // subscription.id -> callback
    this.subscriptionCallbacks = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const wsUrl =
        'wss://api.derivws.com/trading/v1/options/ws/public';

      console.log('Connecting to Deriv public WebSocket...');

      this.ws = new WebSocket(wsUrl);

      let settled = false;

      this.ws.on('open', () => {
        console.log('✅ Connected to Deriv public WebSocket');

        if (!settled) {
          settled = true;
          resolve();
        }
      });

      this.ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());

          console.log(
            'Deriv message:',
            response.msg_type || 'unknown'
          );

          // ------------------------------------------------
          // ERROR RESPONSE
          // ------------------------------------------------

          if (response.error) {
            console.error(
              '❌ Deriv API error:',
              JSON.stringify(response.error)
            );

            const reqId = response.req_id;

            if (reqId && this.callbacks.has(reqId)) {
              const callback = this.callbacks.get(reqId);

              callback(response);

              this.callbacks.delete(reqId);
            }

            return;
          }

          // ------------------------------------------------
          // TICK RESPONSE
          // ------------------------------------------------

          if (response.msg_type === 'tick') {
            const reqId = response.req_id;

            // Save subscription ID
            if (
              reqId &&
              response.subscription?.id
            ) {
              const subscriptionId =
                response.subscription.id;

              this.subscriptions.set(
                reqId,
                subscriptionId
              );

              const callback =
                this.callbacks.get(reqId);

              if (callback) {
                this.subscriptionCallbacks.set(
                  subscriptionId,
                  callback
                );
              }
            }

            // First tick / subscription response
            if (
              reqId &&
              this.callbacks.has(reqId)
            ) {
              const callback =
                this.callbacks.get(reqId);

              callback(response);
            }

            // Subsequent streaming ticks
            if (
              response.subscription?.id
            ) {
              const subscriptionId =
                response.subscription.id;

              const callback =
                this.subscriptionCallbacks.get(
                  subscriptionId
                );

              if (callback) {
                callback(response);
              }
            }

            return;
          }

          // ------------------------------------------------
          // NORMAL RESPONSE
          // ------------------------------------------------

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

            this.callbacks.delete(
              response.req_id
            );
          }

        } catch (error) {
          console.error(
            '❌ Failed to process Deriv message:',
            error?.message || String(error)
          );
        }
      });

      this.ws.on('error', (error) => {
        console.error(
          '❌ Deriv WebSocket error:',
          error?.message || String(error)
        );

        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(
          'Deriv WebSocket closed:',
          code,
          reason?.toString() || ''
        );

        this.ws = null;
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
          new Error('WebSocket not connected')
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
    return this.send({
      authorize: token
    });
  }

  async getAccountBalance(token) {
    await this.authorize(token);

    return this.send({
      balance: 1,
      account: 'all'
    });
  }

  async getAccountList(token) {
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
        'WebSocket not connected'
      );
    }

    const reqId = ++this.requestId;

    console.log(
      `📡 Subscribing to live ticks: ${symbol} | req_id=${reqId}`
    );

    this.callbacks.set(reqId, callback);

    const request = {
      ticks: symbol,
      subscribe: 1,
      req_id: reqId
    };

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

    if (subscriptionId) {
      console.log(
        `🛑 Forgetting Deriv subscription: ${subscriptionId}`
      );

      if (
        this.ws &&
        this.ws.readyState === WebSocket.OPEN
      ) {
        try {
          this.ws.send(
            JSON.stringify({
              forget: subscriptionId,
              req_id: ++this.requestId
            })
          );
        } catch (error) {
          console.error(
            'Forget subscription error:',
            error
          );
        }
      }

      this.subscriptionCallbacks.delete(
        subscriptionId
      );

      this.subscriptions.delete(reqId);
    }

    this.callbacks.delete(reqId);
  }

  disconnect() {
    if (this.ws) {
      console.log(
        'Closing Deriv WebSocket...'
      );

      try {
        this.ws.close();
      } catch (error) {
        console.error(
          'WebSocket close error:',
          error
        );
      }

      this.ws = null;
    }

    this.callbacks.clear();
    this.subscriptions.clear();
    this.subscriptionCallbacks.clear();
  }
}

export default DerivAPI;
