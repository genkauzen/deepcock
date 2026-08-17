const axios = require('axios');

class CaptchaSolver {
  constructor(apiKey, service = '2captcha', timeout = 120000) {
    this.apiKey = apiKey;
    this.service = service;
    this.timeout = timeout;
    this.baseUrls = {
      '2captcha': 'https://2captcha.com',
      'capsolver': 'https://api.capsolver.com',
      'anti-captcha': 'https://api.anti-captcha.com'
    };
  }

  async solveRecaptchaV2(siteKey, pageUrl, proxy = null) {
    const taskData = {
      clientKey: this.apiKey,
      task: {
        type: proxy ? 'RecaptchaV2Task' : 'RecaptchaV2TaskProxyless',
        websiteURL: pageUrl,
        websiteKey: siteKey
      }
    };
    if (proxy) {
      taskData.task.proxy = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
      taskData.task.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    }
    try {
      const createRes = await axios.post(
        `${this.baseUrls[this.service]}/createTask`,
        taskData,
        { timeout: 10000 }
      );
      if (createRes.data.errorId) {
        throw new Error(`Ошибка API: ${createRes.data.errorDescription}`);
      }
      const taskId = createRes.data.taskId;
      return await this.pollResult(taskId);
    } catch (e) {
      console.error(`[Капча] Ошибка: ${e.message}`);
      throw e;
    }
  }

  async solveHCaptcha(siteKey, pageUrl, proxy = null) {
    const taskData = {
      clientKey: this.apiKey,
      task: {
        type: proxy ? 'HCaptchaTask' : 'HCaptchaTaskProxyless',
        websiteURL: pageUrl,
        websiteKey: siteKey
      }
    };
    if (proxy) {
      taskData.task.proxy = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
    }
    const createRes = await axios.post(
      `${this.baseUrls[this.service]}/createTask`,
      taskData,
      { timeout: 10000 }
    );
    if (createRes.data.errorId) {
      throw new Error(createRes.data.errorDescription);
    }
    return await this.pollResult(createRes.data.taskId);
  }

  async pollResult(taskId) {
    const start = Date.now();
    while (Date.now() - start < this.timeout) {
      await this.delay(3000);
      const res = await axios.post(`${this.baseUrls[this.service]}/getTaskResult`, {
        clientKey: this.apiKey,
        taskId: taskId
      });
      if (res.data.status === 'ready') {
        return res.data.solution.gRecaptchaResponse || res.data.solution.token;
      }
      if (res.data.errorId) {
        throw new Error(`Ошибка получения результата: ${res.data.errorDescription}`);
      }
    }
    throw new Error('Таймаут ожидания капчи');
  }

  delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = { CaptchaSolver };