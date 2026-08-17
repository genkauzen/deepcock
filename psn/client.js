const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { faker } = require('@faker-js/faker');
const axios = require('axios');
const qs = require('querystring');

class PSNRegistrator {
  constructor(proxyManager, captchaSolver, db, concurrency = 2) {
    this.proxyManager = proxyManager;
    this.captchaSolver = captchaSolver;
    this.db = db;
    this.concurrency = concurrency;
    this.isRunning = false;
  }

  async register(count, delay, onProgress) {
    this.isRunning = true;
    const results = { success: 0, failed: 0, accounts: [] };

    const queue = Array.from({ length: count }, (_, i) => i);
    const workers = [];
    for (let w = 0; w < Math.min(this.concurrency, count); w++) {
      workers.push(this.worker(queue, results, delay, onProgress, count));
    }
    await Promise.all(workers);

    this.isRunning = false;
    return results;
  }

  async worker(queue, results, delay, onProgress, total) {
    while (this.isRunning && queue.length > 0) {
      const index = queue.shift();
      if (index === undefined) break;

      try {
        const proxy = this.proxyManager.getProxy();
        const proxyArg = `--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`;

        // Создание Outlook аккаунта
        const outlook = await this.createOutlook(proxy, proxyArg);

        // Регистрация PSN
        const psn = await this.registerPSN(outlook, proxy, proxyArg);

        // Сохранение
        await this.db.savePsnAccount({
          email: psn.email,
          password: psn.password,
          outlookPassword: outlook.password,
          proxy: `${proxy.host}:${proxy.port}`,
          accessToken: psn.accessToken || '',
          refreshToken: psn.refreshToken || ''
        });

        results.success++;
        results.accounts.push(psn);

        if (onProgress) {
          onProgress({
            current: total - queue.length,
            total,
            success: results.success,
            error: results.failed,
            status: `Создан PSN: ${psn.email}`
          });
        }

        await new Promise(r => setTimeout(r, delay || 5000));

      } catch (error) {
        results.failed++;
        console.error(`[PSN] Ошибка: ${error.message}`);
        if (onProgress) {
          onProgress({
            current: total - queue.length,
            total,
            success: results.success,
            error: results.failed,
            status: `Ошибка: ${error.message}`
          });
        }
      }
    }
  }

  async createOutlook(proxy, proxyArg) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', proxyArg]
    });

    try {
      const page = await browser.newPage();
      await page.authenticate({
        username: proxy.username || '',
        password: proxy.password || ''
      });

      const firstName = faker.person.firstName();
      const lastName = faker.person.lastName();
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Date.now()}@outlook.com`;
      const password = faker.internet.password({ length: 14 });

      await page.goto('https://signup.live.com/', { waitUntil: 'networkidle2' });

      await page.waitForSelector('#firstName', { timeout: 15000 });
      await page.type('#firstName', firstName);
      await page.type('#lastName', lastName);
      await page.type('#memberName', email);
      await page.type('#password', password);
      await page.type('#passwordAgain', password);

      // Попытка отправки формы
      await page.click('#signupButton');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

      await browser.close();
      return { email, password };

    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  async registerPSN(outlook, proxy, proxyArg) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', proxyArg]
    });

    try {
      const page = await browser.newPage();
      await page.authenticate({
        username: proxy.username || '',
        password: proxy.password || ''
      });

      const authUrl = 'https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/authorize?' + qs.stringify({
        client_id: '09515159-7237-4370-9b40-3806e67c0891',
        redirect_uri: 'https://www.playstation.com/redirect',
        scope: 'psn:account.email psn:account.profile',
        response_type: 'code'
      });

      await page.goto(authUrl, { waitUntil: 'networkidle2' });

      await page.waitForSelector('#signin_input', { timeout: 15000 });
      await page.type('#signin_input', outlook.email);
      await page.type('#password_input', outlook.password);

      // Капча (если есть)
      const siteKey = await page.evaluate(() => {
        const el = document.querySelector('[data-sitekey]');
        return el ? el.dataset.sitekey : null;
      });
      if (siteKey) {
        const token = await this.captchaSolver.solveRecaptchaV2(siteKey, authUrl, proxy);
        await page.evaluate(`document.getElementById('g-recaptcha-response').innerHTML = "${token}";`);
      }

      await page.click('#signin_button');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

      const url = page.url();
      const code = new URL(url).searchParams.get('code');

      await browser.close();

      if (!code) {
        throw new Error('Не удалось получить код OAuth');
      }

      // Обмен кода на токен
      const tokenRes = await axios.post(
        'https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/token',
        qs.stringify({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: 'https://www.playstation.com/redirect',
          client_id: '09515159-7237-4370-9b40-3806e67c0891'
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );

      return {
        email: outlook.email,
        password: outlook.password,
        psnId: tokenRes.data.user_id || 'unknown',
        accessToken: tokenRes.data.access_token,
        refreshToken: tokenRes.data.refresh_token || ''
      };

    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  async stop() {
    this.isRunning = false;
  }
}

module.exports = { PSNRegistrator };