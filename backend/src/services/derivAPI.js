import WebSocket from 'ws';

class DerivAPI {
  constructor(appId) {
    this.appId = appId;
    this.ws = null;
    this.requestId = 0;
    this.callbacks = new Map();
  }

  connect() {
  return new Promise((resolve, reject) => {
    const wsUrl = 'wss://api.derivws.com/trading/v1/options/ws/public';
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('✅ Connected to Deriv WebSocket');
      resolve();
    });

    this.ws.on('message', (data) => {
      const response = JSON.parse(data.toString());

      if (response.req_id && this.callbacks.has(response.req_id)) {
        const callback = this.callbacks.get(response.req_id);
        callback(response);
        this.callbacks.delete(response.req_id);
      }
    });

    this.ws.on('error', (err) => {
      console.error('❌ WebSocket error message:', err?.message || String(err));
      console.error('❌ WebSocket error code:', err?.code || 'none');

      reject(
        new Error(err?.message || 'WebSocket connection failed')
      );
    });
  });
}

send(request) {
});
});
    });
  }

  send(request) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket not connected'));
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

      this.ws.send(JSON.stringify(request));
    });
  }

  async authorize(token) {
    return this.send({ authorize: token });
  }

  async getAccountBalance(token) {
    await this.authorize(token);
    return this.send({ balance: 1, account: 'all' });
  }

  async getAccountList(token) {
    await this.authorize(token);
    return this.send({ account_list: 1 });
  }

  subscribeTicks(symbol, callback) {
    const reqId = ++this.requestId;
    const request = {
      ticks: symbol,
      subscribe: 1,
      req_id: reqId
    };

    this.callbacks.set(reqId, callback);
    this.ws.send(JSON.stringify(request));
    
    return reqId;
  }

  unsubscribe(reqId) {
    this.callbacks.delete(reqId);
    this.send({ forget: reqId });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

export default DerivAPI;
