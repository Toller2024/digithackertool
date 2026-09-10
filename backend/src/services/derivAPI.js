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

      this.ws = new WebSocket(wsUrl);

      let settled = false;

      this.ws.on('open', () => {
        console.log('Connected to Deriv WebSocket');

        if (!settled) {
          settled = true;
          resolve();
        }
      });

      this.ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());

          if (
            response.req_id &&
            this.callbacks.has(response.req_id)
          ) {
            const callback = this.callbacks.get(response.req_id);

            // Save Deriv's real subscription ID
            if (response.subscription?.id) {
              this.subscriptions.set(
                response.req_id,
                response.subscription.id
              );
            }

            callback(response);

            // Keep callbacks alive for continuous tick streams.
            // Remove callbacks for normal one-time requests.
            if (response.msg_type !== 'tick') {
              this.callbacks.delete(response.req_id);
            }
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
          '❌ WebSocket error message:',
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
              err?.message || 'WebSocket connection failed'
            )
          );
        }
      });

      this.ws.on('close', () => {
        console.log('Deriv WebSocket connection closed');
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
    return this.send({ authorize: token });
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
    const reqId = ++this.requestId;

    const request = {
      ticks: symbol,
      subscribe: 1,
      req_id: reqId
    };

    this.callbacks.set(reqId, callback);

    try {
      this.ws.send(JSON.stringify(request));
    } catch (err) {
      this.callbacks.delete(reqId);
      throw err;
    }

    return reqId;
  }

  unsubscribe(reqId) {
    this.callbacks.delete(reqId);

    // Deriv requires the actual subscription ID,
    // not our internal request ID.
    const subscriptionId =
      this.subscriptions.get(reqId);

    this.subscriptions.delete(reqId);

    if (
      subscriptionId &&
      this.ws &&
      this.ws.readyState === WebSocket.OPEN
    ) {
      this.send({
        forget: subscriptionId
      }).catch((err) => {
        console.error(
          '❌ WebSocket unsubscribe error:',
          err?.message || String(err)
        );
      });
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export default DerivAPI;
