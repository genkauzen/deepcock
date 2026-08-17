const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

class ProxyManager {
  constructor() {
    this.proxies = [];
    this.blacklist = new Set();
    this.usageCount = new Map();
    this.currentIndex = 0;
  }

  loadProxies(proxyList) {
    this.proxies = proxyList.map(line => {
      const parts = line.trim().split(':');
      if (parts.length === 2) {
        return { host: parts[0], port: parseInt(parts[1]), protocol: 'http', username: null, password: null };
      } else if (parts.length === 4) {
        return { host: parts[0], port: parseInt(parts[1]), protocol: 'http', username: parts[2], password: parts[3] };
      }
      return null;
    }).filter(p => p !== null);

    this.proxies.forEach(p => {
      this.usageCount.set(`${p.host}:${p.port}`, 0);
    });

    return this.proxies;
  }

  getProxy() {
    const available = this.proxies.filter(p => !this.blacklist.has(`${p.host}:${p.port}`));
    if (available.length === 0) {
      throw new Error('Нет доступных прокси');
    }
    const selected = available[this.currentIndex % available.length];
    this.currentIndex++;
    const key = `${selected.host}:${selected.port}`;
    this.usageCount.set(key, (this.usageCount.get(key) || 0) + 1);
    return selected;
  }

  getAgent(proxy) {
    const url = `${proxy.protocol}://${proxy.username ? proxy.username + ':' + proxy.password + '@' : ''}${proxy.host}:${proxy.port}`;
    if (proxy.protocol === 'socks5' || proxy.protocol === 'socks4') {
      return new SocksProxyAgent(url);
    }
    return new HttpsProxyAgent(url);
  }

  markFailed(proxy) {
    const key = `${proxy.host}:${proxy.port}`;
    this.blacklist.add(key);
    this.proxies = this.proxies.filter(p => !this.blacklist.has(`${p.host}:${p.port}`));
    console.log(`[Прокси] Забанен: ${key}`);
  }

  async checkProxy(proxy) {
    try {
      const agent = this.getAgent(proxy);
      const start = Date.now();
      await axios.get('https://api.ipify.org?format=json', {
        httpsAgent: agent,
        timeout: 10000
      });
      return Date.now() - start < 5000;
    } catch {
      return false;
    }
  }

  async warmup() {
    const checks = this.proxies.map(p => this.checkProxy(p));
    const results = await Promise.all(checks);
    this.proxies = this.proxies.filter((p, i) => results[i]);
    console.log(`[Прокси] Готово: ${this.proxies.length} из ${results.length}`);
  }

  getStats() {
    return {
      total: this.proxies.length,
      blacklisted: this.blacklist.size,
      usage: Object.fromEntries(this.usageCount)
    };
  }
}

module.exports = { ProxyManager };