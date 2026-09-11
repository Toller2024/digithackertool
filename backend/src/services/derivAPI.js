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
      const wsUrl =
        'wss://api.derivws.com/trading/v1/options/ws/public';

      console.log('Connecting to Deriv:', wsUrl);

      this.ws = new WebSocket(wsUrl);

      let settled = false;

      this.ws.on('open', () => {
        console.log('✅ Connected to Deriv WebSocket');

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

          // Handle tick subscription messages
          if (response.msg_type === 'tick') {
            const reqId = response.req_id;

            if (reqId && this.callbacks.has(reqId)) {
              const callback = this.callbacks.get(reqId);

              // Save the real Deriv subscription ID
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

          // Handle normal request responses
          if (
            response.req_id &&
            this.callbacks.has(response.req_id)
          ) {
            const callback =
              this.callbacks.get(response.req_id);

            // Save subscription ID if supplied
            if (response.subscription?.id) {
              this.subscriptions.set(
                response.req_id,
                response.subscription.id
              );
            }

            callback(response);

            // Remove one-time callbacks
            if (response.msg_type !== 'tick') {
              this.callbacks.delete(response.req_id);
            }
          }

          // Always report Deriv errors
          if (response.error) {
            console.error(
              '❌ Deriv API error:',
              response.error
            );
          }
        } catch (err) {
          console.error(
            '❌ WebSocket message error:',
            err?.message || String(err)
          );
        }
      });

      this.ws.on('error', (err) => {
        console.error(
          '❌ WebSocket error:',
          err?.message || String(err)
        );

        console.error(
          '❌ WebSocket error code:',
          err?.code || 'none'
        );

        if (!settled) {
          settled = true;

          reject(
            new Error(
              err?.message ||
                'WebSocket connection failed'
            )
          );
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(
          'Deriv WebSocket connection closed:',
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
          new Error('WebSocket not connected')
        );
      }

      const reqId = ++this.requestId;

      request.req_id = reqId;

      this.callbacks.set(reqId, (response) => {
        if (response.error) {
          reject(response.error);
        } else {
          resolve(response);
        }
      });

      try {
        this.ws.send(JSON.stringify(request));
      } catch (err) {
        this.callbacks.delete(reqId);
        reject(err);
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

    const request = {
      ticks: symbol,
      subscribe: 1,
      req_id: reqId
    };

    console.log(
      `📡 Subscribing to ticks: ${symbol}, req_id: ${reqId}`
    );

    this.callbacks.set(reqId, callback);

    try {
      this.ws.send(
        JSON.stringify(request)
      );
    } catch (err) {
      this.callbacks.delete(reqId);
      throw err;
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
      this.ws.send(
        JSON.stringify({
          forget: subscriptionId
        })
      );

      console.log(
        `🛑 Unsubscribed: ${subscriptionId}`
      );
    }
  }

  disconnect() {
    if (this.ws) {
      console.log(
        'Closing Deriv WebSocket'
      );

      this.ws.close();
      this.ws = null;
    }
  }
}

export default DerivAPI;
