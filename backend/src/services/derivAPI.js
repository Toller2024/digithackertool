import WebSocket from 'ws';

class DerivAPI {
  constructor(appId) {
    this.appId = appId;
    this.ws = null;
    this.requestId = 0;
    this.callbacks = new Map();
    this.subscriptions = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (!this.appId) {
        return reject(
          new Error('DERIV_APP_ID is missing')
        );
      }

      const wsUrl =
        `wss://ws.derivws.com/websockets/v3?app_id=${this.appId}`;

      console.log('=================================');
      console.log('Connecting to Deriv WebSocket');
      console.log(wsUrl);
      console.log('=================================');

      this.ws = new WebSocket(wsUrl);

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
          const response = JSON.parse(
            data.toString()
          );

          console.log(
            'DERIV:',
            response.msg_type || 'unknown',
            response.req_id || ''
          );

          // -----------------------------------------
          // DERIV ERROR
          // -----------------------------------------

          if (response.error) {
            console.error(
              '❌ DERIV ERROR:',
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

              this.callbacks.delete(reqId);
            }

            return;
          }

          // -----------------------------------------
          // TICK
          // -----------------------------------------

          if (response.msg_type === 'tick') {
            const reqId = response.req_id;

            // Save subscription ID
            if (
              reqId &&
              response.subscription &&
              response.subscription.id
            ) {
              this.subscriptions.set(
                reqId,
                response.subscription.id
              );
            }

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
          // OTHER RESPONSE
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

            this.callbacks.delete(
              response.req_id
            );
          }

        } catch (error) {
          console.error(
            '❌ DERIV MESSAGE ERROR:',
            error.message
          );
        }
      });

      this.ws.on('error', (error) => {
        console.error(
          '❌ DERIV WEBSOCKET ERROR:',
          error.message
        );

        if (!settled) {
          settled = true;
          reject(error);
        }
      });

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
        'Deriv WebSocket is not connected'
      );
    }

    const reqId = ++this.requestId;

    console.log(
      `📡 SUBSCRIBING TO ${symbol}`
    );

    console.log(
      `📡 REQUEST ID: ${reqId}`
    );

    const request = {
      ticks: symbol,
      subscribe: 1,
      req_id: reqId
    };

    this.callbacks.set(
      reqId,
      callback
    );

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
          `🛑 UNSUBSCRIBED: ${subscriptionId}`
        );
      } catch (error) {
        console.error(
          'Unsubscribe error:',
          error.message
        );
      }
    }

    this.callbacks.delete(reqId);
    this.subscriptions.delete(reqId);
  }

  disconnect() {
    if (this.ws) {
      console.log(
        'Closing Deriv WebSocket'
      );

      try {
        this.ws.close();
      } catch (error) {
        console.error(
          'Close error:',
          error.message
        );
      }

      this.ws = null;
    }

    this.callbacks.clear();
    this.subscriptions.clear();
  }
}

export default DerivAPI;
